import cors from 'cors'
import express from 'express'
import { createServer } from 'node:http'
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'
import { Server } from 'socket.io'
import * as Y from 'yjs'
import { appendRoomUpdate, restoreRoomDocument } from './redisStore.js'
import { cleanDisplayName, isValidRoomId } from './validation.js'

const PORT = Number(process.env.PORT ?? 3001)
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'
const REDIS_URL = process.env.REDIS_URL
const rooms = new Map()
const members = new Map()
const redisConnections = []

const app = express()
app.use(cors({ origin: CLIENT_ORIGIN }))
app.get('/health', (_request, response) => {
  response.json({ status: 'ok', collaboration: 'yjs' })
})
app.get('/ready', async (_request, response) => {
  if (!persistenceClient) {
    response.json({ status: 'ok', persistence: 'memory' })
    return
  }

  try {
    await persistenceClient.ping()
    response.json({ status: 'ok', persistence: 'redis' })
  } catch (error) {
    console.error('Readiness check failed:', error)
    response.status(503).json({ status: 'unavailable', persistence: 'redis' })
  }
})

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
  maxHttpBufferSize: 1_000_000,
})

let persistenceClient
let updatePublisher

async function getRoomDocument(roomId) {
  if (!rooms.has(roomId)) {
    const loading = (async () => {
      return persistenceClient
        ? restoreRoomDocument(persistenceClient, roomId)
        : new Y.Doc()
    })()
    rooms.set(roomId, loading)
  }
  const loading = rooms.get(roomId)
  try {
    return await loading
  } catch (error) {
    if (rooms.get(roomId) === loading) rooms.delete(roomId)
    throw error
  }
}

function getRoomMembers(roomId) {
  return [...(members.get(roomId)?.entries() ?? [])].map(([id, name]) => ({ id, name }))
}

function leaveCurrentRoom(socket) {
  const roomId = socket.data.roomId
  if (!roomId) return

  socket.leave(roomId)
  const roomMembers = members.get(roomId)
  roomMembers?.delete(socket.id)
  if (roomMembers?.size === 0) members.delete(roomId)
  socket.data.roomId = undefined
  io.to(roomId).emit('presence:update', getRoomMembers(roomId))
}

io.on('connection', (socket) => {
  socket.on('room:join', async (payload, acknowledge) => {
    const reply = typeof acknowledge === 'function' ? acknowledge : () => {}
    const roomId = typeof payload?.roomId === 'string' ? payload.roomId.trim() : ''
    const name = cleanDisplayName(payload?.name)

    if (!isValidRoomId(roomId)) {
      reply({ ok: false, error: 'Room IDs must be 3–48 letters, numbers, dashes or underscores.' })
      return
    }
    if (!name) {
      reply({ ok: false, error: 'A display name is required.' })
      return
    }

    try {
      leaveCurrentRoom(socket)
      const doc = await getRoomDocument(roomId)
      await socket.join(roomId)
      socket.data.roomId = roomId
      if (!members.has(roomId)) members.set(roomId, new Map())
      members.get(roomId).set(socket.id, name)
      reply({
        ok: true,
        state: Y.encodeStateAsUpdate(doc),
        members: getRoomMembers(roomId),
      })
      io.to(roomId).emit('presence:update', getRoomMembers(roomId))
    } catch (error) {
      console.error(`Could not join room ${roomId}:`, error)
      reply({ ok: false, error: 'The workspace could not be loaded. Please try again.' })
    }
  })

  socket.on('document:update', async (payload, acknowledge) => {
    const reply = typeof acknowledge === 'function' ? acknowledge : () => {}
    const roomId = socket.data.roomId
    if (!roomId || payload?.roomId !== roomId) {
      reply({ ok: false, error: 'Join the workspace before sending edits.' })
      return
    }
    const update = payload?.update
    if (!(update instanceof Uint8Array) || update.byteLength === 0 || update.byteLength > 1_000_000) {
      socket.emit('room:error', 'An invalid document update was rejected.')
      reply({ ok: false, error: 'The document update is invalid.' })
      return
    }

    let doc
    try {
      doc = await getRoomDocument(roomId)
      const validationDoc = new Y.Doc()
      try {
        Y.applyUpdate(validationDoc, update)
      } finally {
        validationDoc.destroy()
      }
      if (persistenceClient) await appendRoomUpdate(persistenceClient, roomId, update)
      Y.applyUpdate(doc, update)
      socket.to(roomId).emit('document:update', update)
    } catch (error) {
      console.error(`Could not persist or apply update for room ${roomId}:`, error)
      socket.emit('room:error', 'A document update could not be applied.')
      reply({ ok: false, error: 'The document update could not be saved.' })
      return
    }

    if (updatePublisher) {
      try {
        await updatePublisher.publish(
          'syncforge:document-updates',
          JSON.stringify({ roomId, update: Buffer.from(update).toString('base64') }),
        )
      } catch (error) {
        console.error(`Could not replicate update for room ${roomId}:`, error)
        socket.emit('room:error', 'Your edit was applied here, but could not be replicated to every server. Please retry.')
        reply({ ok: false, error: 'The edit was saved but could not be shared with every server.' })
        return
      }
    }
    reply({ ok: true })
  })

  socket.on('disconnect', () => leaveCurrentRoom(socket))
})

async function start() {
  if (process.env.NODE_ENV === 'production' && !REDIS_URL) {
    throw new Error('REDIS_URL is required in production for durable workspace storage.')
  }

  if (REDIS_URL) {
    persistenceClient = createClient({ url: REDIS_URL })
    redisConnections.push(persistenceClient)
    persistenceClient.on('error', (error) => console.error('Redis persistence error:', error))
    await persistenceClient.connect()

    const pubClient = persistenceClient.duplicate()
    const subClient = persistenceClient.duplicate()
    updatePublisher = persistenceClient.duplicate()
    const updateSubscriber = persistenceClient.duplicate()
    redisConnections.push(pubClient, subClient, updatePublisher, updateSubscriber)
    pubClient.on('error', (error) => console.error('Redis publisher error:', error))
    subClient.on('error', (error) => console.error('Redis subscriber error:', error))
    updatePublisher.on('error', (error) => console.error('Document update publisher error:', error))
    updateSubscriber.on('error', (error) => console.error('Document update subscriber error:', error))
    await Promise.all([
      pubClient.connect(),
      subClient.connect(),
      updatePublisher.connect(),
      updateSubscriber.connect(),
    ])
    io.adapter(createAdapter(pubClient, subClient))
    await updateSubscriber.subscribe('syncforge:document-updates', async (message) => {
      try {
        const { roomId, update: encodedUpdate } = JSON.parse(message)
        if (!isValidRoomId(roomId) || typeof encodedUpdate !== 'string') return
        const doc = await getRoomDocument(roomId)
        Y.applyUpdate(doc, Buffer.from(encodedUpdate, 'base64'))
      } catch (error) {
        console.error('Could not apply a Redis document update:', error)
      }
    })
  }

  httpServer.listen(PORT, () => {
    console.log(`SyncForge server listening on http://localhost:${PORT}`)
  })
}

start().catch((error) => {
  console.error('SyncForge server failed to start:', error)
  process.exitCode = 1
})

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  await new Promise((resolve) => io.close(resolve))
  await Promise.all(
    redisConnections.filter((client) => client.isOpen).map((client) => client.quit()),
  )
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
