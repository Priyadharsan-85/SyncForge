import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createClient } from 'redis'
import { io } from 'socket.io-client'
import * as Y from 'yjs'

const serverDirectory = fileURLToPath(new URL('../', import.meta.url))

async function findOpenPort() {
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const { port } = probe.address()
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitForServer(child, url) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Collaboration server exited before becoming ready.')
    }
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error('Collaboration server did not become ready in time.')
}

async function connect(url) {
  const socket = io(url, { transports: ['websocket'], reconnection: false })
  await Promise.race([
    once(socket, 'connect'),
    once(socket, 'connect_error').then(([error]) => Promise.reject(error)),
  ])
  return socket
}

function joinRoom(socket, roomId, name) {
  return new Promise((resolve, reject) => {
    socket.emit('room:join', { roomId, name }, (response) => {
      if (response.ok) resolve(response)
      else reject(new Error(response.error))
    })
  })
}

function bindDocument(socket, doc, roomId) {
  doc.on('update', (update, origin) => {
    if (origin !== socket) socket.emit('document:update', { roomId, update })
  })
  socket.on('document:update', (update) => Y.applyUpdate(doc, update, socket))
}

test('two clients converge after concurrent edits', { timeout: 20_000 }, async (t) => {
  const port = await findOpenPort()
  const url = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDirectory,
    env: { ...process.env, PORT: String(port), REDIS_URL: '' },
    stdio: 'ignore',
  })
  const sockets = []

  t.after(() => {
    for (const socket of sockets) socket.disconnect()
    child.kill()
  })

  await waitForServer(child, url)
  const readiness = await fetch(`${url}/ready`)
  assert.equal(readiness.status, 200)
  assert.deepEqual(await readiness.json(), { status: 'ok', persistence: 'memory' })

  const roomId = `test-${Date.now()}`
  const firstSocket = await connect(url)
  const secondSocket = await connect(url)
  sockets.push(firstSocket, secondSocket)

  const firstDoc = new Y.Doc()
  const secondDoc = new Y.Doc()
  t.after(() => {
    firstDoc.destroy()
    secondDoc.destroy()
  })
  const firstJoin = await joinRoom(firstSocket, roomId, 'Alex')
  const secondJoin = await joinRoom(secondSocket, roomId, 'Sam')
  Y.applyUpdate(firstDoc, firstJoin.state)
  Y.applyUpdate(secondDoc, secondJoin.state)
  bindDocument(firstSocket, firstDoc, roomId)
  bindDocument(secondSocket, secondDoc, roomId)

  const firstText = firstDoc.getText('code')
  const secondText = secondDoc.getText('code')
  firstText.insert(0, 'hello')
  await waitUntil(() => firstText.toString() === 'hello' && secondText.toString() === 'hello')

  firstText.insert(5, ' A')
  secondText.insert(5, ' B')
  await waitUntil(() =>
    firstText.toString() === secondText.toString() &&
    firstText.toString().includes(' A') &&
    firstText.toString().includes(' B'),
  )

  assert.equal(firstText.toString(), secondText.toString())

  const file = new Y.Map()
  const fileContent = new Y.Text()
  fileContent.insert(0, 'export const answer = 42')
  file.set('name', 'utils.ts')
  file.set('content', fileContent)
  firstDoc.getMap('files').set('utils.ts', file)

  await waitUntil(() => {
    const sharedFile = secondDoc.getMap('files').get('utils.ts')
    const sharedContent = sharedFile?.get('content')
    return sharedFile?.get('name') === 'utils.ts' &&
      sharedContent instanceof Y.Text &&
      sharedContent.toString() === 'export const answer = 42'
  })
})

test('production server refuses to start without Redis persistence', async () => {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDirectory,
    env: { ...process.env, NODE_ENV: 'production', PORT: '0', REDIS_URL: '' },
    stdio: 'ignore',
  })

  const [code] = await once(child, 'exit')
  assert.equal(code, 1)
})

test('Redis-backed workspace recovers after restarting the server', {
  skip: !process.env.REDIS_TEST_URL,
  timeout: 30_000,
}, async (t) => {
  const port = await findOpenPort()
  const url = `http://127.0.0.1:${port}`
  const roomId = `restart-${Date.now()}`
  let child
  let socket

  const startServer = async () => {
    child = spawn(process.execPath, ['src/index.js'], {
      cwd: serverDirectory,
      env: {
        ...process.env,
        PORT: String(port),
        REDIS_URL: process.env.REDIS_TEST_URL,
      },
      stdio: 'ignore',
    })
    await waitForServer(child, url)
  }
  const stopServer = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
  }
  t.after(async () => {
    socket?.disconnect()
    await stopServer()
  })

  await startServer()
  socket = await connect(url)
  const initialJoin = await joinRoom(socket, roomId, 'Alex')
  const firstDoc = new Y.Doc()
  Y.applyUpdate(firstDoc, initialJoin.state)
  firstDoc.getText('code').insert(0, 'survives restart')

  const redisClient = createClient({ url: process.env.REDIS_TEST_URL })
  await redisClient.connect()
  await redisClient.sendCommand(['CLIENT', 'PAUSE', '5000', 'ALL'])
  const readinessStart = Date.now()
  const stalledReadiness = await fetch(`${url}/ready`)
  assert.equal(stalledReadiness.status, 503)
  assert.deepEqual(await stalledReadiness.json(), {
    status: 'unavailable',
    persistence: 'redis',
  })
  assert.ok(Date.now() - readinessStart < 1_600)

  const failedUpdateStart = Date.now()
  const failedUpdate = await new Promise((resolve) => {
    socket.emit('document:update', {
      roomId,
      update: Y.encodeStateAsUpdate(firstDoc),
    }, resolve)
  })
  assert.deepEqual(failedUpdate, {
    ok: false,
    retryable: true,
    error: 'The document update could not be saved.',
  })
  assert.ok(Date.now() - failedUpdateStart < 4_500)
  await redisClient.quit()

  const updateResult = await new Promise((resolve) => {
    socket.emit('document:update', {
      roomId,
      update: Y.encodeStateAsUpdate(firstDoc),
    }, resolve)
  })
  assert.deepEqual(updateResult, { ok: true })
  firstDoc.destroy()

  socket.disconnect()
  socket = undefined
  await stopServer()
  await startServer()

  socket = await connect(url)
  const restoredJoin = await joinRoom(socket, roomId, 'Sam')
  const restoredDoc = new Y.Doc()
  Y.applyUpdate(restoredDoc, restoredJoin.state)
  assert.equal(restoredDoc.getText('code').toString(), 'survives restart')
  restoredDoc.destroy()
})

async function waitUntil(predicate) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail('Clients did not converge before the timeout.')
}
