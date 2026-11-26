import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import express from 'express'
import { errorHandler, notFoundHandler } from '../src/errorHandler.js'
import {
  API_PATH_PATTERN,
  CLIENT_CONTENT_SECURITY_POLICY,
  createStaticClientRouter,
  resolveClientDist,
} from '../src/staticClient.js'

function makeDist() {
  const dir = mkdtempSync(join(tmpdir(), 'syncforge-dist-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>SyncForge</title>')
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)')
  writeFileSync(join(dir, 'robots.txt'), 'User-agent: *')
  return dir
}

async function withStaticApp(run) {
  const dist = makeDist()
  const app = express()
  app.get('/api/ping', (_request, response) => response.json({ pong: true }))
  app.use(createStaticClientRouter(dist))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await run(base)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dist, { recursive: true, force: true })
  }
}

test('API_PATH_PATTERN matches server-owned prefixes only', () => {
  for (const path of ['/api', '/api/workspaces', '/auth/me', '/health', '/ready', '/metrics', '/socket.io/']) {
    assert.ok(API_PATH_PATTERN.test(path), path)
  }
  for (const path of ['/', '/workspace/abc', '/apis', '/healthy', '/assets/app.js']) {
    assert.ok(!API_PATH_PATTERN.test(path), path)
  }
})

test('resolveClientDist honours SERVE_CLIENT and CLIENT_DIST_DIR', () => {
  const dist = makeDist()
  try {
    assert.equal(resolveClientDist({ CLIENT_DIST_DIR: dist }), dist)
    assert.equal(resolveClientDist({ CLIENT_DIST_DIR: dist, SERVE_CLIENT: 'false' }), null)
    assert.equal(resolveClientDist({ CLIENT_DIST_DIR: join(dist, 'missing') }), null)
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})

test('serves index.html for client routes with the client CSP', async () => {
  await withStaticApp(async (base) => {
    const response = await fetch(`${base}/workspace/room-1`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/html/)
    assert.equal(response.headers.get('content-security-policy'), CLIENT_CONTENT_SECURITY_POLICY)
    assert.equal(response.headers.get('cache-control'), 'no-cache')
    assert.match(await response.text(), /SyncForge/)
  })
})

test('fingerprinted assets are cached immutably', async () => {
  await withStaticApp(async (base) => {
    const response = await fetch(`${base}/assets/app-abc123.js`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('cache-control'), /immutable/)
  })
})

test('missing assets 404 instead of falling back to index.html', async () => {
  await withStaticApp(async (base) => {
    const response = await fetch(`${base}/assets/missing.js`)
    assert.equal(response.status, 404)
  })
})

test('unknown API paths keep the JSON 404', async () => {
  await withStaticApp(async (base) => {
    const response = await fetch(`${base}/api/does-not-exist`)
    assert.equal(response.status, 404)
    assert.match(response.headers.get('content-type'), /application\/json/)
    const ping = await fetch(`${base}/api/ping`)
    assert.deepEqual(await ping.json(), { pong: true })
  })
})

test('non-GET requests to client routes are not answered with HTML', async () => {
  await withStaticApp(async (base) => {
    const response = await fetch(`${base}/workspace/room-1`, { method: 'POST' })
    assert.equal(response.status, 404)
  })
})

test('top-level public files are served directly', async () => {
  await withStaticApp(async (base) => {
    const response = await fetch(`${base}/robots.txt`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'User-agent: *')
  })
})
