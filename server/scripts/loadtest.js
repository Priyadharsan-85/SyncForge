import { randomUUID } from 'node:crypto'
import { io } from 'socket.io-client'
import * as Y from 'yjs'

const serverUrl = process.env.LOAD_TEST_URL ?? 'http://localhost:3001'
const origin = process.env.LOAD_TEST_ORIGIN ?? 'http://localhost:5173'
const cookie = process.env.LOAD_TEST_COOKIE
const clientCount = Number(process.env.LOAD_TEST_CLIENTS ?? 100)
const roomPrefix = process.env.LOAD_TEST_ROOM_PREFIX ?? 'load'
const roomId = `${roomPrefix}-${randomUUID().slice(0, 8)}`
const timeoutMs = 15_000
const failures = { connection: 0, join: 0, update: 0 }
const clients = []
const updateLatencies = []

function assertConfiguration() {
  const parsedUrl = new URL(serverUrl)
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('LOAD_TEST_URL must use HTTP or HTTPS.')
  }
  if (typeof cookie !== 'string' || !cookie.startsWith('syncforge_session=')) {
    throw new Error('Set LOAD_TEST_COOKIE to a valid syncforge_session cookie.')
  }
  if (!Number.isInteger(clientCount) || clientCount < 1 || clientCount > 500) {
    throw new Error('LOAD_TEST_CLIENTS must be an integer from 1 to 500.')
  }
  if (!/^[a-zA-Z0-9_-]{1,39}$/.test(roomPrefix)) {
    throw new Error('LOAD_TEST_ROOM_PREFIX must contain 1–39 letters, numbers, dashes or underscores.')
  }
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Connection timed out.')), timeoutMs)
    const onConnect = () => finish()
    const onError = (error) => finish(error)
    function finish(error) {
      clearTimeout(timer)
      socket.off('connect', onConnect)
      socket.off('connect_error', onError)
      if (error) reject(error)
      else resolve()
    }
    socket.once('connect', onConnect)
    socket.once('connect_error', onError)
  })
}

function joinRoom(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Room join timed out.')), timeoutMs)
    socket.emit('room:join', { roomId }, (response) => {
      clearTimeout(timer)
      if (response?.ok) resolve(response)
      else reject(new Error(response?.error ?? 'Room join failed.'))
    })
  })
}

function percentile(samples, percentileValue) {
  if (samples.length === 0) return null
  const sorted = [...samples].sort((left, right) => left - right)
  return Number(sorted[Math.ceil(percentileValue * sorted.length) - 1].toFixed(2))
}

function allClientsConverged(markers) {
  const joinedClients = clients.filter((client) => client.joined)
  return joinedClients.length > 0 && joinedClients
    .every((client) => {
      const lines = new Set(client.doc.getText('load').toString().trim().split('\n'))
      return markers.every((marker) => lines.has(marker))
    })
}

async function waitForConvergence(markers) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (allClientsConverged(markers)) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return allClientsConverged(markers)
}

async function run() {
  assertConfiguration()
  const startedAt = performance.now()

  try {
    await Promise.all(Array.from({ length: clientCount }, async (_, index) => {
      const socket = io(serverUrl, {
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        timeout: timeoutMs,
        extraHeaders: { Origin: origin, Cookie: cookie },
      })
      const client = { socket, doc: new Y.Doc(), joined: false }
      clients.push(client)

      try {
        await waitForConnect(socket)
        const joined = await joinRoom(socket)
        Y.applyUpdate(client.doc, joined.state)
        client.joined = true
        client.doc.on('update', (update, updateOrigin) => {
          if (updateOrigin === socket) return
          const sentAt = performance.now()
          socket.emit('document:update', { roomId, update }, (response) => {
            updateLatencies.push(performance.now() - sentAt)
            if (!response?.ok) failures.update += 1
          })
        })
        socket.on('document:update', (update) => Y.applyUpdate(client.doc, update, socket))
        client.marker = `client-${index}`
      } catch {
        failures.connection += socket.connected ? 0 : 1
        if (socket.connected) failures.join += 1
      }
    }))

    const activeClients = clients.filter((client) => client.joined)
    const markers = activeClients.map((client) => client.marker)
    for (const client of activeClients) {
      client.doc.getText('load').insert(0, `${client.marker}\n`)
    }
    const converged = await waitForConvergence(markers)
    const result = {
      targetClients: clientCount,
      connectedClients: clients.length - failures.connection,
      joinedClients: activeClients.length,
      roomId,
      failures,
      editAcknowledgementLatencyMs: {
        samples: updateLatencies.length,
        p50: percentile(updateLatencies, 0.5),
        p95: percentile(updateLatencies, 0.95),
        p99: percentile(updateLatencies, 0.99),
      },
      converged,
      durationSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(2)),
    }
    console.log(JSON.stringify(result, null, 2))
    if (
      clients.length - failures.connection !== clientCount ||
      activeClients.length !== clientCount ||
      failures.join > 0 ||
      failures.update > 0 ||
      updateLatencies.length !== clientCount ||
      !converged
    ) {
      process.exitCode = 1
    }
  } finally {
    for (const client of clients) {
      client.socket.disconnect()
      client.doc.destroy()
    }
  }
}

run().catch((error) => {
  console.error(`Load test could not run: ${error.message}`)
  process.exitCode = 1
})
