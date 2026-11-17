import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createClient } from 'redis'
import { io } from 'socket.io-client'
import * as Y from 'yjs'
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth.js'

const serverDirectory = fileURLToPath(new URL('../', import.meta.url))
const clientOrigin = 'http://localhost:5173'
const sessionSecret = 'syncforge-integration-test-session-secret'

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

function sessionCookie(name) {
  const token = createSessionToken(
    { id: name, login: name.toLowerCase().replace(/\s+/g, '-'), name },
    sessionSecret,
  )
  return `${SESSION_COOKIE_NAME}=${token}`
}

async function connect(url, name = 'Test User') {
  const socket = io(url, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: {
      Origin: clientOrigin,
      Cookie: sessionCookie(name),
    },
  })
  await Promise.race([
    once(socket, 'connect'),
    once(socket, 'connect_error').then(([error]) => Promise.reject(error)),
  ])
  return socket
}

function joinRoom(socket, roomId, name) {
  return requestJoin(socket, roomId, name)
}

function requestJoin(socket, roomId, name, inviteToken) {
  return new Promise((resolve, reject) => {
    socket.emit('room:join', { roomId, name, inviteToken }, resolve)
  })
}

async function createWorkspace(url, name, workspaceName = 'Test workspace') {
  const response = await fetch(`${url}/api/workspaces`, {
    method: 'POST',
    headers: {
      Origin: clientOrigin,
      Cookie: sessionCookie(name),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: workspaceName }),
  })
  assert.equal(response.status, 201)
  return response.json()
}

async function createInvite(url, name, roomId) {
  const response = await fetch(`${url}/api/workspaces/${roomId}/invites`, {
    method: 'POST',
    headers: {
      Origin: clientOrigin,
      Cookie: sessionCookie(name),
    },
  })
  assert.equal(response.status, 201)
  const { inviteUrl } = await response.json()
  return new URL(inviteUrl).searchParams.get('invite')
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
    env: {
      ...process.env,
      PORT: String(port),
      REDIS_URL: '',
      CLIENT_ORIGIN: clientOrigin,
      SESSION_SECRET: sessionSecret,
      GITHUB_CLIENT_ID: 'test-github-client',
      GITHUB_CLIENT_SECRET: 'test-github-secret',
      GITHUB_CALLBACK_URL: `${clientOrigin}/auth/github/callback`,
    },
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
  const unauthenticatedResponse = await fetch(`${url}/auth/me`)
  assert.equal(unauthenticatedResponse.status, 401)
  const authenticatedResponse = await fetch(`${url}/auth/me`, {
    headers: { Cookie: sessionCookie('Alex') },
  })
  assert.deepEqual(await authenticatedResponse.json(), {
    id: 'Alex',
    login: 'alex',
    name: 'Alex',
  })
  const oauthStart = await fetch(
    `${url}/auth/github?returnTo=${encodeURIComponent('//attacker.example')}`,
    { redirect: 'manual' },
  )
  assert.equal(oauthStart.status, 302)
  const authorizeUrl = new URL(oauthStart.headers.get('location'))
  assert.equal(authorizeUrl.origin, 'https://github.com')
  assert.equal(authorizeUrl.searchParams.get('client_id'), 'test-github-client')
  const oauthStateCookie = oauthStart.headers.get('set-cookie')
  assert.ok(oauthStateCookie?.includes('HttpOnly'))
  const stateCookieValue = oauthStateCookie?.match(/syncforge_oauth_state=([^;]+)/)?.[1]
  assert.equal(stateCookieValue, `${authorizeUrl.searchParams.get('state')}.Lw`)
  const validOauthStart = await fetch(
    `${url}/auth/github?returnTo=${encodeURIComponent('/?room=invite-room')}`,
    { redirect: 'manual' },
  )
  const validAuthorizeUrl = new URL(validOauthStart.headers.get('location'))
  const validStateCookie = validOauthStart.headers.get('set-cookie')
  const deniedCallback = await fetch(
    `${url}/auth/github/callback?state=${encodeURIComponent(validAuthorizeUrl.searchParams.get('state'))}&error=access_denied`,
    {
      headers: { Cookie: validStateCookie.split(';')[0] },
      redirect: 'manual',
    },
  )
  assert.equal(deniedCallback.status, 302)
  const deniedDestination = new URL(deniedCallback.headers.get('location'))
  assert.equal(deniedDestination.searchParams.get('room'), 'invite-room')
  assert.equal(deniedDestination.searchParams.get('auth'), 'failed')
  const logoutResponse = await fetch(`${url}/auth/logout`, {
    method: 'POST',
    headers: { Origin: clientOrigin },
  })
  assert.equal(logoutResponse.status, 204)
  const invalidLogoutResponse = await fetch(`${url}/auth/logout`, {
    method: 'POST',
    headers: { Origin: 'https://attacker.example' },
  })
  assert.equal(invalidLogoutResponse.status, 403)
  const unauthenticatedSocket = io(url, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { Origin: clientOrigin },
  })
  const [authError] = await once(unauthenticatedSocket, 'connect_error')
  assert.match(authError.message, /Authentication required/)
  unauthenticatedSocket.disconnect()
  const wrongOriginSocket = io(url, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: {
      Origin: 'https://attacker.example',
      Cookie: sessionCookie('Alex'),
    },
  })
  const [originError] = await once(wrongOriginSocket, 'connect_error')
  assert.match(originError.message, /Invalid origin/)
  wrongOriginSocket.disconnect()

  const workspace = await createWorkspace(url, 'Alex', 'Collaboration test')
  const roomId = workspace.roomId
  const firstSocket = await connect(url, 'Alex')
  const secondSocket = await connect(url, 'Sam')
  sockets.push(firstSocket, secondSocket)

  const firstDoc = new Y.Doc()
  const secondDoc = new Y.Doc()
  t.after(() => {
    firstDoc.destroy()
    secondDoc.destroy()
  })
  const firstJoin = await joinRoom(firstSocket, roomId, 'Impersonator')
  const deniedJoin = await requestJoin(secondSocket, roomId, 'Sam')
  assert.equal(deniedJoin.ok, false)
  assert.match(deniedJoin.error, /do not have access/)
  const inviteToken = await createInvite(url, 'Alex', roomId)
  const secondJoin = await requestJoin(secondSocket, roomId, 'Sam', inviteToken)
  assert.equal(secondJoin.ok, true)
  const samDashboard = await fetch(`${url}/api/workspaces`, {
    headers: { Cookie: sessionCookie('Sam') },
  })
  assert.equal((await samDashboard.json())[0].roomId, roomId)
  const editorInvite = await fetch(`${url}/api/workspaces/${roomId}/invites`, {
    method: 'POST',
    headers: {
      Origin: clientOrigin,
      Cookie: sessionCookie('Sam'),
    },
  })
  assert.equal(editorInvite.status, 403)
  assert.deepEqual(firstJoin.members.map((member) => member.name), ['Alex'])
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

  const localImportResponse = await fetch(`${url}/api/workspaces/import/local`, {
    method: 'POST',
    headers: {
      Origin: clientOrigin,
      Cookie: sessionCookie('Alex'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Imported local project',
      files: [{ path: 'src/index.ts', content: 'export const imported = true' }],
    }),
  })
  assert.equal(localImportResponse.status, 201)
  const importedWorkspace = await localImportResponse.json()
  const importedSocket = await connect(url, 'Alex')
  sockets.push(importedSocket)
  const importedJoin = await joinRoom(importedSocket, importedWorkspace.roomId, 'Alex')
  const importedDoc = new Y.Doc()
  t.after(() => importedDoc.destroy())
  Y.applyUpdate(importedDoc, importedJoin.state)
  const importedFile = importedDoc.getMap('files').get('src/index.ts')
  assert.equal(importedFile.get('content').toString(), 'export const imported = true')
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
  let roomId
  let child
  let socket
  let joinRetrySocket
  let redisClient

  const startServer = async () => {
    child = spawn(process.execPath, ['src/index.js'], {
      cwd: serverDirectory,
      env: {
        ...process.env,
        PORT: String(port),
        REDIS_URL: process.env.REDIS_TEST_URL,
        REDIS_COMPACTION_THRESHOLD: '1',
        CLIENT_ORIGIN: clientOrigin,
        SESSION_SECRET: sessionSecret,
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
    joinRetrySocket?.disconnect()
    if (redisClient?.isOpen) await redisClient.quit()
    await stopServer()
  })

  await startServer()
  socket = await connect(url, 'Alex')
  const workspace = await createWorkspace(url, 'Alex', 'Restart test')
  roomId = workspace.roomId
  const initialJoin = await joinRoom(socket, roomId, 'Alex')
  const firstDoc = new Y.Doc()
  Y.applyUpdate(firstDoc, initialJoin.state)
  firstDoc.getText('code').insert(0, 'survives restart')

  redisClient = createClient({ url: process.env.REDIS_TEST_URL })
  await redisClient.connect()
  const retryWorkspace = await createWorkspace(url, 'Alex', 'Retry test')
  const retryRoomId = retryWorkspace.roomId
  const retryInvite = await createInvite(url, 'Alex', retryRoomId)
  await redisClient.sendCommand(['CLIENT', 'PAUSE', '9000', 'ALL'])
  const readinessStart = Date.now()
  const stalledReadiness = await fetch(`${url}/ready`)
  assert.equal(stalledReadiness.status, 503)
  assert.deepEqual(await stalledReadiness.json(), {
    status: 'unavailable',
    persistence: 'redis',
  })
  assert.ok(Date.now() - readinessStart < 1_600)

  joinRetrySocket = await connect(url, 'Sam')
  const failedJoin = await new Promise((resolve) => {
    joinRetrySocket.emit('room:join', {
      roomId: retryRoomId,
      name: 'Sam',
      inviteToken: retryInvite,
    }, resolve)
  })
  assert.equal(failedJoin.ok, false)
  assert.equal(failedJoin.retryable, true)

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

  await redisClient.ping()
  const recoveredJoin = await requestJoin(joinRetrySocket, retryRoomId, 'Sam', retryInvite)
  assert.equal(recoveredJoin.ok, true)

  const updateResult = await new Promise((resolve) => {
    socket.emit('document:update', {
      roomId,
      update: Y.encodeStateAsUpdate(firstDoc),
    }, resolve)
  })
  assert.deepEqual(updateResult, { ok: true })
  firstDoc.getText('code').insert(16, ' and compacted')
  const concurrentUpdateResult = await new Promise((resolve) => {
    socket.emit('document:update', {
      roomId,
      update: Y.encodeStateAsUpdate(firstDoc),
    }, resolve)
  })
  assert.deepEqual(concurrentUpdateResult, { ok: true })
  await waitUntilAsync(async () =>
    await redisClient.xLen(`syncforge:room:${roomId}:updates`) === 0 &&
    Boolean(await redisClient.get(`syncforge:room:${roomId}:checkpoint`)),
  )
  firstDoc.destroy()

  socket.disconnect()
  socket = undefined
  await stopServer()
  await startServer()

  socket = await connect(url, 'Alex')
  const restoredJoin = await joinRoom(socket, roomId, 'Alex')
  const restoredDoc = new Y.Doc()
  Y.applyUpdate(restoredDoc, restoredJoin.state)
  assert.equal(restoredDoc.getText('code').toString(), 'survives restart and compacted')
  restoredDoc.destroy()
  await redisClient.quit()
})

test('presence includes members connected to different server instances', {
  skip: !process.env.REDIS_TEST_URL,
  timeout: 30_000,
}, async (t) => {
  const firstPort = await findOpenPort()
  let secondPort = await findOpenPort()
  while (secondPort === firstPort) secondPort = await findOpenPort()
  const firstUrl = `http://127.0.0.1:${firstPort}`
  const secondUrl = `http://127.0.0.1:${secondPort}`
  const servers = [firstPort, secondPort].map((port) => spawn(process.execPath, ['src/index.js'], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      PORT: String(port),
      REDIS_URL: process.env.REDIS_TEST_URL,
      CLIENT_ORIGIN: clientOrigin,
      SESSION_SECRET: sessionSecret,
    },
    stdio: 'ignore',
  }))
  const sockets = []
  t.after(async () => {
    for (const socket of sockets) socket.disconnect()
    await Promise.all(servers.map(async (server) => {
      if (server.exitCode !== null || server.signalCode !== null) return
      const exited = once(server, 'exit')
      server.kill('SIGTERM')
      await exited
    }))
  })

  await Promise.all([
    waitForServer(servers[0], firstUrl),
    waitForServer(servers[1], secondUrl),
  ])
  const firstSocket = await connect(firstUrl, 'Alex')
  const secondSocket = await connect(secondUrl, 'Sam')
  sockets.push(firstSocket, secondSocket)
  const workspace = await createWorkspace(firstUrl, 'Alex', 'Presence test')
  const roomId = workspace.roomId
  const inviteToken = await createInvite(firstUrl, 'Alex', roomId)
  const firstPresenceUpdate = once(firstSocket, 'presence:update')
  const firstJoin = await joinRoom(firstSocket, roomId, 'Impersonator')
  assert.equal(firstJoin.ok, true)
  await firstPresenceUpdate
  const secondPresenceUpdate = once(firstSocket, 'presence:update')
  const secondJoin = await requestJoin(secondSocket, roomId, 'Sam', inviteToken)
  const [updatedMembers] = await secondPresenceUpdate

  assert.deepEqual(
    secondJoin.members.map((member) => member.name).sort(),
    ['Alex', 'Sam'],
  )
  assert.deepEqual(
    updatedMembers.map((member) => member.name).sort(),
    ['Alex', 'Sam'],
  )
})

async function waitUntil(predicate) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail('Clients did not converge before the timeout.')
}

async function waitUntilAsync(predicate) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail('Asynchronous condition was not met before the timeout.')
}
