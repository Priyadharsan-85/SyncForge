import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { requestLogger } from '../src/requestLogger.js'

function makeApp() {
  return async (req, res) => {
    requestLogger(req, res, () => {
      res.writeHead(req.url === '/error' ? 500 : 200, { 'Content-Type': 'application/json' })
      res.end('{}')
    })
  }
}

async function request(server, path) {
  const { port } = server.address()
  const res = await fetch(`http://127.0.0.1:${port}${path}`)
  return res.status
}

test('requestLogger attaches a request id and completes without throwing', async () => {
  const server = createServer(makeApp())
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const status = await request(server, '/api/test')
    assert.equal(status, 200)
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  }
})

test('requestLogger handles server error responses', async () => {
  const server = createServer(makeApp())
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const status = await request(server, '/error')
    assert.equal(status, 500)
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  }
})

test('requestLogger skips health routes in production', async () => {
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'

  const server = createServer(makeApp())
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  const logs = []
  const originalLog = console.log
  console.log = (...args) => logs.push(args)

  try {
    await request(server, '/health')
    // Allow finish event to fire
    await new Promise((resolve) => setTimeout(resolve, 50))
    const healthLogs = logs.filter((args) => {
      try { return JSON.parse(args[0])?.path === '/health' } catch { return false }
    })
    assert.equal(healthLogs.length, 0)
  } finally {
    console.log = originalLog
    process.env.NODE_ENV = original
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  }
})
