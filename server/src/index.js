import cors from 'cors'
import express from 'express'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'
import { Server } from 'socket.io'
import * as Y from 'yjs'
import { GitHubImportError, importPublicGitHubRepository } from './githubImport.js'
import {
  createSessionToken,
  matchesSecret,
  OAUTH_STATE_COOKIE_NAME,
  readCookie,
  safeReturnPath,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  verifySessionToken,
} from './auth.js'
import {
  appendRoomUpdate,
  compactRoomIfNeeded,
  deleteRoomDocument,
  restoreRoomDocument,
  storeInitialRoomDocument,
  withRedisTimeout,
} from './redisStore.js'
import { createImportedDocument, validateImportedFiles } from './projectImport.js'
import { consumeRateLimit } from './rateLimit.js'
import { cleanDisplayName, isValidRoomId } from './validation.js'
import {
  createWorkspace,
  createWorkspaceInvite,
  deleteWorkspace,
  getWorkspace,
  getWorkspaceAccess,
  getWorkspaceMember,
  listUserWorkspaces,
  renameWorkspace,
} from './workspaceAccess.js'
import {
  createDraftPatch,
  discardDraftPatch,
  listUserDrafts,
  rebaseDraftPatch,
} from './aiAssistant.js'
import {
  createBranch,
  createCommit,
  deleteBranch,
  getBranch,
  getBranchCommits,
  getCommit,
  getCommitDiff,
  initWorkspaceBranches,
  listBranches,
} from './branchManager.js'
import {
  addPullRequestComment,
  closePullRequest,
  createPullRequest,
  getPullRequest,
  getPullRequestDiff,
  listPullRequestComments,
  listPullRequests,
  mergePullRequest,
} from './pullRequestManager.js'
import { applyTreeToLiveDocument, syncBranchToLiveWorkspace } from './workspaceSync.js'
import {
  exportBranchAsPatch,
  exportPullRequestAsPatch,
  getGitHubWorkflowStatus,
} from './githubWorkflow.js'
import { requestLogger } from './requestLogger.js'
import {
  adjustGauge,
  getMetrics,
  incrementCounter,
  observeHistogram,
  renderPrometheus,
  setGauge,
} from './metrics.js'


const PORT = Number(process.env.PORT ?? 3001)
const CLIENT_ORIGIN = new URL(process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').origin
const REDIS_URL = process.env.REDIS_URL
const SESSION_SECRET = process.env.SESSION_SECRET ?? ''
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL ??
  new URL('/auth/github/callback', CLIENT_ORIGIN).toString()
const READINESS_TIMEOUT_MS = 1_000
const ROOM_IDLE_TTL_MS = 60_000
const MAX_DOCUMENT_UPDATE_BYTES = 8 * 1024 * 1024
const REDIS_COMPACTION_THRESHOLD = Number(process.env.REDIS_COMPACTION_THRESHOLD ?? 500)
const rooms = new Map()
const localRoomMembers = new Map()
const roomEvictionTimers = new Map()
const compactingRooms = new Set()
const redisConnections = []

function createCookie(name, value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

function decodeReturnPath(encodedPath) {
  if (typeof encodedPath !== 'string') return '/'
  try {
    return safeReturnPath(Buffer.from(encodedPath, 'base64url').toString('utf8'))
  } catch {
    return '/'
  }
}

function authFailureUrl(returnPath, reason = 'failed') {
  const url = new URL(safeReturnPath(returnPath), CLIENT_ORIGIN)
  url.searchParams.set('auth', reason)
  return url.toString()
}

function getAuthenticatedUser(request, response, requireSameOrigin = false) {
  if (requireSameOrigin && request.get('origin') !== CLIENT_ORIGIN) {
    response.status(403).json({ error: 'Invalid request origin.' })
    return null
  }
  const user = verifySessionToken(
    readCookie(request.headers.cookie, SESSION_COOKIE_NAME),
    SESSION_SECRET,
  )
  if (!user) {
    response.status(401).json({ error: 'Authentication required.' })
    return null
  }
  return user
}

async function enforceRateLimit(response, userId, scope, limit) {
  try {
    const result = await consumeRateLimit(persistenceClient, {
      scope,
      actor: String(userId),
      limit,
      windowSeconds: 60 * 60,
    })
    if (result.allowed) return true
    incrementCounter('rateLimitRejections')
    response.set('Retry-After', String(result.retryAfterSeconds))
    response.status(429).json({ error: "You have reached this action's hourly limit. Try again later." })
    return false
  } catch (error) {
    console.error(`Could not check the ${scope} rate limit:`, error)
    response.status(503).json({ error: 'This action is temporarily unavailable. Try again shortly.' })
    return false
  }
}

function workspaceName(value, fallback) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 80)
    : fallback
}

async function createWorkspaceRecord({ owner, name, source, contributors = [], files }) {
  const roomId = randomUUID().replace(/-/g, '')
  const doc = files ? createImportedDocument(files) : null
  let documentStored = false
  let workspaceStored = false
  try {
    if (doc && persistenceClient) {
      await storeInitialRoomDocument(persistenceClient, roomId, doc)
      documentStored = true
    }
    const workspace = await createWorkspace(persistenceClient, {
      roomId,
      owner,
      name,
      source,
      contributors,
    })
    workspaceStored = true
    incrementCounter('roomsCreated')
    if (doc) {
      rooms.set(roomId, Promise.resolve(doc))
      documentStored = true
    }
    return workspace
  } catch (error) {
    if (workspaceStored) {
      await deleteWorkspace(persistenceClient, roomId).catch((cleanupError) => {
        console.error(`Could not clean up workspace ${roomId}:`, cleanupError)
      })
    }
    if (documentStored && persistenceClient) {
      await deleteRoomDocument(persistenceClient, roomId).catch((cleanupError) => {
        console.error(`Could not clean up document ${roomId}:`, cleanupError)
      })
    }
    if (doc && !rooms.has(roomId)) doc.destroy()
    throw error
  }
}

const app = express()

// Request logging
app.use(requestLogger)

// In-process metrics tracking
app.use((_request, response, next) => {
  incrementCounter('requestsTotal')
  const startedAt = process.hrtime.bigint()
  response.on('finish', () => {
    observeHistogram(
      'requestDurationSeconds',
      Number(process.hrtime.bigint() - startedAt) / 1e9,
    )
    if (response.statusCode >= 500) incrementCounter('requestErrors')
    else if (response.statusCode >= 400) incrementCounter('requestsClientError')
    setGauge('roomsResident', rooms.size)
  })
  next()
})

// Security headers
app.use((_request, response, next) => {
  response.set('X-Content-Type-Options', 'nosniff')
  response.set('X-Frame-Options', 'SAMEORIGIN')
  response.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (process.env.NODE_ENV === 'production') {
    response.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }
  next()
})

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }))
app.use(express.json({ limit: '13mb' }))

app.get('/auth/me', (request, response) => {
  const session = verifySessionToken(
    readCookie(request.headers.cookie, SESSION_COOKIE_NAME),
    SESSION_SECRET,
  )
  if (!session) {
    response.status(401).json({ error: 'Authentication required.' })
    return
  }
  response.json(session)
})
app.get('/auth/github', (request, response) => {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !SESSION_SECRET) {
    response.redirect(authFailureUrl(safeReturnPath(request.query.returnTo), 'unconfigured'))
    return
  }

  const state = randomUUID()
  const returnTo = safeReturnPath(request.query.returnTo)
  const stateCookie = `${state}.${Buffer.from(returnTo).toString('base64url')}`
  response.append(
    'Set-Cookie',
    createCookie(OAUTH_STATE_COOKIE_NAME, stateCookie, 600),
  )
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize')
  authorizeUrl.searchParams.set('client_id', GITHUB_CLIENT_ID)
  authorizeUrl.searchParams.set('redirect_uri', GITHUB_CALLBACK_URL)
  authorizeUrl.searchParams.set('scope', 'read:user')
  authorizeUrl.searchParams.set('state', state)
  response.redirect(authorizeUrl.toString())
})
app.get('/auth/github/callback', async (request, response) => {
  const stateCookie = readCookie(request.headers.cookie, OAUTH_STATE_COOKIE_NAME)
  const [expectedState, encodedReturnPath, extra] = (stateCookie ?? '').split('.')
  const returnTo = decodeReturnPath(encodedReturnPath)
  response.append('Set-Cookie', createCookie(OAUTH_STATE_COOKIE_NAME, '', 0))

  if (extra !== undefined || !matchesSecret(expectedState, request.query.state)) {
    response.redirect(authFailureUrl('/'))
    return
  }
  if (
    typeof request.query.code !== 'string' ||
    request.query.code.length > 2_048 ||
    !GITHUB_CLIENT_ID ||
    !GITHUB_CLIENT_SECRET ||
    !SESSION_SECRET
  ) {
    response.redirect(authFailureUrl(returnTo))
    return
  }

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SyncForge',
      },
      body: new URLSearchParams({
        client_id: GITHUB_CLIENT_ID ?? '',
        client_secret: GITHUB_CLIENT_SECRET ?? '',
        code: request.query.code,
        redirect_uri: GITHUB_CALLBACK_URL,
      }),
    })
    const tokenBody = await tokenResponse.json()
    if (!tokenResponse.ok || typeof tokenBody.access_token !== 'string') {
      throw new Error('GitHub did not issue an access token.')
    }

    const profileResponse = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${tokenBody.access_token}`,
        'User-Agent': 'SyncForge',
      },
    })
    const profile = await profileResponse.json()
    if (
      !profileResponse.ok ||
      (typeof profile.id !== 'number' && typeof profile.id !== 'string') ||
      typeof profile.login !== 'string'
    ) {
      throw new Error('GitHub returned an invalid profile.')
    }

    const login = profile.login.slice(0, 39)
    const displayName = cleanDisplayName(
      typeof profile.name === 'string' ? profile.name : login,
    ) || login
    const sessionToken = createSessionToken(
      { id: String(profile.id), login, name: displayName },
      SESSION_SECRET,
    )
    response.append(
      'Set-Cookie',
      createCookie(SESSION_COOKIE_NAME, sessionToken, SESSION_TTL_SECONDS),
    )
    response.redirect(new URL(returnTo, CLIENT_ORIGIN).toString())
  } catch (error) {
    console.error('GitHub sign-in failed:', error)
    response.redirect(authFailureUrl(returnTo))
  }
})
app.post('/auth/logout', (request, response) => {
  if (request.get('origin') !== CLIENT_ORIGIN) {
    response.status(403).json({ error: 'Invalid request origin.' })
    return
  }
  response.append('Set-Cookie', createCookie(SESSION_COOKIE_NAME, '', 0))
  response.status(204).end()
})
app.get('/api/workspaces', async (request, response) => {
  const user = getAuthenticatedUser(request, response)
  if (!user) return
  try {
    response.json(await listUserWorkspaces(persistenceClient, user.id))
  } catch (error) {
    console.error('Could not list workspaces:', error)
    response.status(503).json({ error: 'Could not load your workspaces. Try again.' })
  }
})
app.post('/api/workspaces', async (request, response) => {
  const user = getAuthenticatedUser(request, response, true)
  if (!user) return
  if (!await enforceRateLimit(response, user.id, 'workspace-create', 15)) return
  try {
    const workspace = await createWorkspaceRecord({
      owner: user,
      name: workspaceName(request.body?.name, 'Untitled workspace'),
      source: { type: 'blank' },
    })
    response.status(201).json(workspace)
  } catch (error) {
    console.error('Could not create workspace:', error)
    response.status(503).json({ error: 'Could not create the workspace. Try again.' })
  }
})
app.post('/api/workspaces/import/local', async (request, response) => {
  const user = getAuthenticatedUser(request, response, true)
  if (!user) return
  if (!await enforceRateLimit(response, user.id, 'project-import', 5)) return
  try {
    const files = validateImportedFiles(request.body?.files)
    const workspace = await createWorkspaceRecord({
      owner: user,
      name: workspaceName(request.body?.name, 'Imported project'),
      source: { type: 'local' },
      files,
    })
    response.status(201).json(workspace)
  } catch (error) {
    console.error('Could not import local project:', error)
    const status = Number.isInteger(error.status) ? error.status : 503
    response.status(status).json({
      error: status < 500 ? error.message : 'Could not import the project. Try again.',
    })
  }
})
app.post('/api/workspaces/import/github', async (request, response) => {
  const user = getAuthenticatedUser(request, response, true)
  if (!user) return
  if (!await enforceRateLimit(response, user.id, 'project-import', 5)) return
  try {
    const imported = await importPublicGitHubRepository(request.body?.url)
    const workspace = await createWorkspaceRecord({
      owner: user,
      name: imported.name,
      source: imported.source,
      contributors: imported.contributors,
      files: imported.files,
    })
    response.status(201).json(workspace)
  } catch (error) {
    console.error('Could not import GitHub repository:', error)
    const status = Number.isInteger(error.status) ? error.status : 503
    response.status(status).json({
      error: status < 500 ? error.message : 'Could not import the GitHub repository. Try again.',
    })
  }
})
app.post('/api/workspaces/:roomId/invites', async (request, response) => {
  const user = getAuthenticatedUser(request, response, true)
  if (!user) return
  if (!await enforceRateLimit(response, user.id, 'invite-create', 20)) return
  const { roomId } = request.params
  if (!isValidRoomId(roomId)) {
    response.status(400).json({ error: 'The workspace ID is invalid.' })
    return
  }
  try {
    const [workspace, member] = await Promise.all([
      getWorkspace(persistenceClient, roomId),
      getWorkspaceMember(persistenceClient, roomId, user.id),
    ])
    if (!workspace || !member) {
      response.status(404).json({ error: 'Workspace not found.' })
      return
    }
    if (member.role !== 'owner') {
      response.status(403).json({ error: 'Only the workspace owner can create invites.' })
      return
    }
    const token = await createWorkspaceInvite(persistenceClient, roomId)
    const inviteUrl = new URL('/', CLIENT_ORIGIN)
    inviteUrl.searchParams.set('room', roomId)
    inviteUrl.searchParams.set('invite', token)
    response.status(201).json({ inviteUrl: inviteUrl.toString() })
  } catch (error) {
    console.error(`Could not create invite for workspace ${roomId}:`, error)
    response.status(503).json({ error: 'Could not create an invite. Try again.' })
  }
})

// --- Workspace management endpoints ---
app.patch('/api/workspaces/:roomId', async (request, response) => {
  const user = getAuthenticatedUser(request, response, true)
  if (!user) return
  const { roomId } = request.params
  if (!isValidRoomId(roomId)) {
    response.status(400).json({ error: 'The workspace ID is invalid.' })
    return
  }
  try {
    const member = await getWorkspaceMember(persistenceClient, roomId, user.id)
    if (!member) {
      response.status(404).json({ error: 'Workspace not found.' })
      return
    }
    if (member.role !== 'owner') {
      response.status(403).json({ error: 'Only the workspace owner can rename it.' })
      return
    }
    const newName = workspaceName(request.body?.name, null)
    if (!newName) {
      response.status(400).json({ error: 'A non-empty name is required.' })
      return
    }
    await renameWorkspace(persistenceClient, roomId, newName)
    response.json({ ok: true, name: newName })
  } catch (error) {
    console.error(`Could not rename workspace ${roomId}:`, error)
    response.status(503).json({ error: 'Could not rename the workspace. Try again.' })
  }
})

app.delete('/api/workspaces/:roomId', async (request, response) => {
  const user = getAuthenticatedUser(request, response, true)
  if (!user) return
  const { roomId } = request.params
  if (!isValidRoomId(roomId)) {
    response.status(400).json({ error: 'The workspace ID is invalid.' })
    return
  }
  try {
    const [workspace, member] = await Promise.all([
      getWorkspace(persistenceClient, roomId),
      getWorkspaceMember(persistenceClient, roomId, user.id),
    ])
    if (!workspace || !member) {
      response.status(404).json({ error: 'Workspace not found.' })
      return
    }
    if (member.role !== 'owner') {
      response.status(403).json({ error: 'Only the workspace owner can delete it.' })
      return
    }
    await deleteWorkspace(persistenceClient, roomId)
    if (persistenceClient) {
      await deleteRoomDocument(persistenceClient, roomId).catch((err) => {
        console.error(`Could not delete document for workspace ${roomId}:`, err)
      })
    }
    // Evict any in-memory room
    const loading = rooms.get(roomId)
    if (loading) {
      rooms.delete(roomId)
      loading.then((doc) => doc.destroy()).catch(() => {})
    }
    io.to(roomId).emit('room:error', 'This workspace has been deleted by the owner.')
    response.status(204).end()
  } catch (error) {
    console.error(`Could not delete workspace ${roomId}:`, error)
    response.status(503).json({ error: 'Could not delete the workspace. Try again.' })
  }
})

async function checkWorkspaceMember(request, response, roomId, requireEdit = false) {
  const user = getAuthenticatedUser(request, response, requireEdit)
  if (!user) return null
  if (!isValidRoomId(roomId)) {
    response.status(400).json({ error: 'The workspace ID is invalid.' })
    return null
  }
  const member = await getWorkspaceMember(persistenceClient, roomId, user.id)
  if (!member) {
    response.status(403).json({ error: 'You do not have access to this workspace.' })
    return null
  }
  if (requireEdit && member.role !== 'owner' && member.role !== 'editor') {
    response.status(403).json({ error: 'You do not have edit access to this workspace.' })
    return null
  }
  return { user, member }
}

app.get('/api/workspaces/:roomId/stats', async (request, response) => {
  const { roomId } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, false)
  if (!auth) return

  try {
    const doc = await getRoomDocument(roomId)
    const files = doc.getMap('files')
    let filesCount = 0
    let totalSizeBytes = 0

    for (const [, record] of files.entries()) {
      if (record && typeof record.get === 'function') {
        filesCount++
        const content = record.get('content')
        if (content && typeof content.toString === 'function') {
          totalSizeBytes += Buffer.byteLength(content.toString(), 'utf8')
        }
      }
    }

    const [branches, pulls] = await Promise.all([
      listBranches(persistenceClient, roomId).catch(() => []),
      listPullRequests(persistenceClient, roomId).catch(() => []),
    ])

    const openPulls = pulls.filter((p) => p.status === 'open').length

    response.json({
      roomId,
      filesCount,
      totalSizeBytes,
      branchesCount: branches.length,
      pullRequestsCount: pulls.length,
      openPullRequestsCount: openPulls,
    })
  } catch (error) {
    console.error('Could not get workspace stats:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not get workspace stats.' })
  }
})

app.post('/api/workspaces/:roomId/fork', async (request, response) => {
  const { roomId } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, false)
  if (!auth) return
  if (!await enforceRateLimit(response, auth.user.id, 'workspace-create', 15)) return

  try {
    const sourceWorkspace = await getWorkspace(persistenceClient, roomId)
    const doc = await getRoomDocument(roomId)
    const sourceFiles = []
    for (const [, record] of doc.getMap('files').entries()) {
      const name = record.get('name')
      const content = record.get('content')
      if (typeof name === 'string' && content && typeof content.toString === 'function') {
        sourceFiles.push({ path: name, content: content.toString() })
      }
    }

    const forkName = workspaceName(
      request.body?.name,
      `Fork of ${sourceWorkspace?.name || 'workspace'}`,
    )

    const workspace = await createWorkspaceRecord({
      owner: auth.user,
      name: forkName,
      source: { type: 'fork', originalRoomId: roomId },
      files: sourceFiles.length > 0 ? sourceFiles : undefined,
    })

    response.status(201).json(workspace)
  } catch (error) {
    console.error(`Could not fork workspace ${roomId}:`, error)
    response.status(503).json({ error: 'Could not fork the workspace. Try again.' })
  }
})

// --- AI Assistant Draft Endpoints ---
app.post('/api/workspaces/:roomId/ai/draft', async (request, response) => {
  const { roomId } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, true)
  if (!auth) return
  if (!await enforceRateLimit(response, auth.user.id, 'ai-draft', 30)) return

  try {
    const { fileId, fileName, baseContent, prompt, actionType, customProposedCode } = request.body || {}
    const draft = createDraftPatch({
      roomId,
      user: auth.user,
      fileId,
      fileName,
      baseContent,
      prompt,
      actionType,
      customProposedCode,
    })
    response.status(201).json(draft)
  } catch (error) {
    console.error('Could not generate AI draft:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not generate AI draft.' })
  }
})

app.get('/api/workspaces/:roomId/ai/drafts', async (request, response) => {
  const { roomId } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, false)
  if (!auth) return

  try {
    const drafts = listUserDrafts(roomId, auth.user.id)
    response.json(drafts)
  } catch (error) {
    console.error('Could not list drafts:', error)
    response.status(500).json({ error: 'Could not list drafts.' })
  }
})

app.post('/api/workspaces/:roomId/ai/rebase', async (request, response) => {
  const { roomId } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, false)
  if (!auth) return

  try {
    const { draftId, liveContent } = request.body || {}
    const rebaseResult = rebaseDraftPatch(draftId, liveContent)
    response.json(rebaseResult)
  } catch (error) {
    console.error('Could not rebase draft:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not rebase draft.' })
  }
})

app.delete('/api/workspaces/:roomId/ai/drafts/:draftId', async (request, response) => {
  const { roomId, draftId } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, false)
  if (!auth) return

  discardDraftPatch(draftId)
  response.status(204).end()
})

// --- Branches & Snapshot Endpoints ---
app.get('/api/workspaces/:roomId/branches', async (request, response) => {
  const { roomId } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, false)
  if (!auth) return

  try {
    let branches = await listBranches(persistenceClient, roomId)
    if (branches.length === 0) {
      await initWorkspaceBranches(persistenceClient, roomId, auth.user)
      branches = await listBranches(persistenceClient, roomId)
    }
    response.json(branches)
  } catch (error) {
    console.error('Could not list branches:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not list branches.' })
  }
})

app.post('/api/workspaces/:roomId/branches', async (request, response) => {
  const { roomId } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, true)
  if (!auth) return

  try {
    const { branchName, fromBranch } = request.body || {}
    const branch = await createBranch(persistenceClient, {
      roomId,
      branchName,
      fromBranch: fromBranch || 'main',
      user: auth.user,
    })
    response.status(201).json(branch)
  } catch (error) {
    console.error('Could not create branch:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not create branch.' })
  }
})

app.delete('/api/workspaces/:roomId/branches/:branch', async (request, response) => {
  const { roomId, branch } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, true)
  if (!auth) return

  try {
    const result = await deleteBranch(persistenceClient, roomId, decodeURIComponent(branch))
    response.json(result)
  } catch (error) {
    console.error('Could not delete branch:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not delete branch.' })
  }
})

app.get('/api/workspaces/:roomId/branches/:branch/commits', async (request, response) => {
  const { roomId, branch } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, false)
  if (!auth) return

  try {
    const commits = await getBranchCommits(persistenceClient, roomId, decodeURIComponent(branch))
    response.json(commits)
  } catch (error) {
    console.error('Could not get branch commits:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not get branch commits.' })
  }
})

app.post('/api/workspaces/:roomId/branches/:branch/commits', async (request, response) => {
  const { roomId, branch } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, true)
  if (!auth) return

  try {
    const { message, tree, expectedParentCommitId } = request.body || {}
    const commit = await createCommit(persistenceClient, {
      roomId,
      branchName: decodeURIComponent(branch),
      message,
      author: auth.user,
      tree,
      expectedParentCommitId,
    })
    response.status(201).json(commit)
  } catch (error) {
    console.error('Could not commit to branch:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not commit snapshot.' })
  }
})

app.get('/api/workspaces/:roomId/commits/:commitId', async (request, response) => {
  const { roomId, commitId } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, false)
  if (!auth) return

  try {
    const commit = await getCommit(persistenceClient, roomId, commitId)
    if (!commit) {
      response.status(404).json({ error: 'Commit not found.' })
      return
    }
    response.json(commit)
  } catch (error) {
    console.error('Could not get commit:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not get commit.' })
  }
})

app.get('/api/workspaces/:roomId/commits/:commitId/diff', async (request, response) => {
  const { roomId, commitId } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, false)
  if (!auth) return

  try {
    const diff = await getCommitDiff(persistenceClient, roomId, commitId)
    response.json(diff)
  } catch (error) {
    console.error('Could not get commit diff:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not get commit diff.' })
  }
})

// --- Pull Request Endpoints ---
app.get('/api/workspaces/:roomId/pulls', async (request, response) => {
  const { roomId } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, false)
  if (!auth) return

  try {
    const prs = await listPullRequests(persistenceClient, roomId, request.query.status || null)
    response.json(prs)
  } catch (error) {
    console.error('Could not list PRs:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not list pull requests.' })
  }
})

app.post('/api/workspaces/:roomId/pulls', async (request, response) => {
  const { roomId } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, true)
  if (!auth) return

  try {
    const { title, description, sourceBranch, targetBranch } = request.body || {}
    const pr = await createPullRequest(persistenceClient, {
      roomId,
      title,
      description,
      sourceBranch,
      targetBranch: targetBranch || 'main',
      author: auth.user,
    })
    response.status(201).json(pr)
  } catch (error) {
    console.error('Could not create PR:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not create pull request.' })
  }
})

app.get('/api/workspaces/:roomId/pulls/:prNumber', async (request, response) => {
  const { roomId, prNumber } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, false)
  if (!auth) return

  try {
    const pr = await getPullRequest(persistenceClient, roomId, Number(prNumber))
    if (!pr) {
      response.status(404).json({ error: 'Pull request not found.' })
      return
    }
    response.json(pr)
  } catch (error) {
    console.error('Could not get PR:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not get pull request.' })
  }
})

app.get('/api/workspaces/:roomId/pulls/:prNumber/diff', async (request, response) => {
  const { roomId, prNumber } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, false)
  if (!auth) return

  try {
    const diff = await getPullRequestDiff(persistenceClient, roomId, Number(prNumber))
    response.json(diff)
  } catch (error) {
    console.error('Could not get PR diff:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not get pull request diff.' })
  }
})

app.post('/api/workspaces/:roomId/pulls/:prNumber/merge', async (request, response) => {
  const { roomId, prNumber } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, true)
  if (!auth) return

  try {
    const { commitMessage } = request.body || {}
    const result = await mergePullRequest(persistenceClient, {
      roomId,
      prNumber: Number(prNumber),
      user: auth.user,
      commitMessage,
    })
    response.json(result)
  } catch (error) {
    console.error('Could not merge PR:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not merge pull request.' })
  }
})

app.post('/api/workspaces/:roomId/pulls/:prNumber/close', async (request, response) => {
  const { roomId, prNumber } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, true)
  if (!auth) return

  try {
    const closedPr = await closePullRequest(persistenceClient, {
      roomId,
      prNumber: Number(prNumber),
      user: auth.user,
    })
    response.json(closedPr)
  } catch (error) {
    console.error('Could not close PR:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not close pull request.' })
  }
})

app.get('/api/workspaces/:roomId/pulls/:prNumber/comments', async (request, response) => {
  const { roomId, prNumber } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, false)
  if (!auth) return

  try {
    const comments = await listPullRequestComments(persistenceClient, roomId, Number(prNumber))
    response.json(comments)
  } catch (error) {
    console.error('Could not list PR comments:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not list comments.' })
  }
})

app.post('/api/workspaces/:roomId/pulls/:prNumber/comments', async (request, response) => {
  const { roomId, prNumber } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, true)
  if (!auth) return

  try {
    const { body } = request.body || {}
    const comment = await addPullRequestComment(persistenceClient, {
      roomId,
      prNumber: Number(prNumber),
      author: auth.user,
      body,
    })
    response.status(201).json(comment)
  } catch (error) {
    console.error('Could not add PR comment:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not add comment.' })
  }
})

// --- Live Workspace Branch Sync-Back ---
app.post('/api/workspaces/:roomId/branches/:branch/sync-live', async (request, response) => {
  const { roomId, branch } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, true)
  if (!auth) return

  try {
    const doc = await getRoomDocument(roomId)
    const syncStats = await syncBranchToLiveWorkspace(persistenceClient, {
      roomId,
      branchName: decodeURIComponent(branch),
      doc,
    })

    const update = Y.encodeStateAsUpdate(doc)
    if (persistenceClient) {
      await appendRoomUpdate(persistenceClient, roomId, update, REDIS_COMPACTION_THRESHOLD)
    }
    io.to(roomId).emit('document:update', update)

    response.json({ ok: true, sync: syncStats })
  } catch (error) {
    console.error('Could not sync branch to live workspace:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not sync branch to live workspace.' })
  }
})

// --- GitHub Workflow & Patch Export ---
app.get('/api/workspaces/:roomId/github/status', async (request, response) => {
  const user = getAuthenticatedUser(request, response)
  if (!user) return
  response.json(getGitHubWorkflowStatus(user))
})

app.post('/api/workspaces/:roomId/branches/:branch/export-patch', async (request, response) => {
  const { roomId, branch } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, false)
  if (!auth) return

  try {
    const patchResult = await exportBranchAsPatch(persistenceClient, roomId, decodeURIComponent(branch))
    response.json(patchResult)
  } catch (error) {
    console.error('Could not export branch patch:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not export branch patch.' })
  }
})

app.post('/api/workspaces/:roomId/pulls/:prNumber/export-patch', async (request, response) => {
  const { roomId, prNumber } = request.params
  const auth = await checkWorkspaceMember(request, response, roomId, false)
  if (!auth) return

  try {
    const patchResult = await exportPullRequestAsPatch(persistenceClient, roomId, Number(prNumber))
    response.json(patchResult)
  } catch (error) {
    console.error('Could not export PR patch:', error)
    response.status(error.status || 500).json({ error: error.message || 'Could not export pull request patch.' })
  }
})

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', collaboration: 'yjs' })
})
app.get('/ready', async (_request, response) => {
  if (!persistenceClient) {
    response.json({ status: 'ok', persistence: 'memory' })
    return
  }

  if (!persistenceClient.isReady) {
    response.status(503).json({ status: 'unavailable', persistence: 'redis' })
    return
  }

  let timeout
  try {
    await Promise.race([
      persistenceClient.ping(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Redis readiness probe timed out')),
          READINESS_TIMEOUT_MS,
        )
      }),
    ])
    response.json({ status: 'ok', persistence: 'redis' })
  } catch (error) {
    console.error('Readiness check failed:', error)
    response.status(503).json({ status: 'unavailable', persistence: 'redis' })
  } finally {
    clearTimeout(timeout)
  }
})

app.get('/metrics', (request, response) => {
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const metricsToken = process.env.METRICS_TOKEN
    if (!metricsToken || token !== metricsToken) {
      response.status(401).json({ error: 'Unauthorized.' })
      return
    }
  }

  setGauge('roomsResident', rooms.size)

  // Prometheus scrapers send `Accept: text/plain`; humans and dashboards can
  // ask for the same data as JSON, which stays the default.
  const wantsPrometheus =
    request.query.format === 'prometheus' ||
    (typeof request.get('accept') === 'string' && request.get('accept').includes('text/plain'))

  if (wantsPrometheus) {
    response.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
    response.send(renderPrometheus())
    return
  }
  response.json(getMetrics())
})

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN, credentials: true },
  maxHttpBufferSize: MAX_DOCUMENT_UPDATE_BYTES,
})

let persistenceClient
let updatePublisher

io.use((socket, next) => {
  const origin = socket.handshake.headers.origin
  if (origin !== CLIENT_ORIGIN) {
    next(new Error('Invalid origin.'))
    return
  }
  const user = verifySessionToken(
    readCookie(socket.handshake.headers.cookie, SESSION_COOKIE_NAME),
    SESSION_SECRET,
  )
  if (!user) {
    next(new Error('Authentication required.'))
    return
  }
  socket.data.user = user
  next()
})

function cancelRoomEviction(roomId) {
  const timer = roomEvictionTimers.get(roomId)
  if (timer) clearTimeout(timer)
  roomEvictionTimers.delete(roomId)
}

function scheduleRoomEviction(roomId) {
  if (!persistenceClient || localRoomMembers.has(roomId)) return
  cancelRoomEviction(roomId)
  const timer = setTimeout(() => {
    roomEvictionTimers.delete(roomId)
    if (localRoomMembers.has(roomId)) return
    const loading = rooms.get(roomId)
    if (!loading) return
    rooms.delete(roomId)
    loading.then((doc) => doc.destroy()).catch((error) => {
      console.error(`Could not evict idle room ${roomId}:`, error)
    })
  }, ROOM_IDLE_TTL_MS)
  roomEvictionTimers.set(roomId, timer)
}

function scheduleRoomCompaction(roomId) {
  if (!persistenceClient || compactingRooms.has(roomId)) return
  compactingRooms.add(roomId)
  compactRoomIfNeeded(persistenceClient, roomId, REDIS_COMPACTION_THRESHOLD)
    .catch((error) => console.error(`Could not compact room ${roomId}:`, error))
    .finally(async () => {
      compactingRooms.delete(roomId)
      try {
        const streamLength = await withRedisTimeout(
          persistenceClient.xLen(`syncforge:room:${roomId}:updates`),
          'Redis update count timed out',
        )
        if (streamLength >= REDIS_COMPACTION_THRESHOLD) scheduleRoomCompaction(roomId)
      } catch (error) {
        console.error(`Could not check compaction status for room ${roomId}:`, error)
      }
    })
}

async function getRoomDocument(roomId) {
  cancelRoomEviction(roomId)
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

async function getRoomMembers(roomId) {
  const sockets = await io.in(roomId).fetchSockets()
  return sockets.map((roomSocket) => ({
    id: roomSocket.id,
    name: roomSocket.data.displayName,
  }))
}

function publishRoomMembers(roomId) {
  getRoomMembers(roomId)
    .then((roomMembers) => io.to(roomId).emit('presence:update', roomMembers))
    .catch((error) => console.error(`Could not load presence for room ${roomId}:`, error))
}

function leaveCurrentRoom(socket) {
  const roomId = socket.data.roomId
  if (!roomId) return

  socket.leave(roomId)
  const roomMembers = localRoomMembers.get(roomId)
  roomMembers?.delete(socket.id)
  if (roomMembers?.size === 0) localRoomMembers.delete(roomId)
  socket.data.roomId = undefined
  socket.data.role = undefined
  socket.data.displayName = undefined
  publishRoomMembers(roomId)
  scheduleRoomEviction(roomId)
}

io.on('connection', (socket) => {
  incrementCounter('wsConnections')
  adjustGauge('wsConnectionsActive', 1)
  socket.on('room:join', async (payload, acknowledge) => {
    const reply = typeof acknowledge === 'function' ? acknowledge : () => {}
    const roomId = typeof payload?.roomId === 'string' ? payload.roomId.trim() : ''
    const name = socket.data.user.name

    if (!isValidRoomId(roomId)) {
      reply({ ok: false, error: 'Room IDs must be 3–48 letters, numbers, dashes or underscores.' })
      return
    }
    if (!name) {
      reply({ ok: false, error: 'A display name is required.' })
      return
    }

    try {
      const membership = await getWorkspaceAccess(
        persistenceClient,
        roomId,
        socket.data.user,
        payload?.inviteToken,
      )
      if (!membership) {
        reply({
          ok: false,
          error: 'You do not have access to this workspace. Ask its owner for an invite.',
        })
        return
      }
      leaveCurrentRoom(socket)
      const doc = await getRoomDocument(roomId)
      await socket.join(roomId)
      socket.data.roomId = roomId
      socket.data.role = membership.role
      socket.data.displayName = name
      if (!localRoomMembers.has(roomId)) localRoomMembers.set(roomId, new Set())
      localRoomMembers.get(roomId).add(socket.id)
      const roomMembers = await getRoomMembers(roomId)
      reply({
        ok: true,
        state: Y.encodeStateAsUpdate(doc),
        stateVector: Y.encodeStateVector(doc),
        role: membership.role,
        members: roomMembers,
      })
      io.to(roomId).emit('presence:update', roomMembers)
    } catch (error) {
      console.error(`Could not join room ${roomId}:`, error)
      reply({
        ok: false,
        retryable: Boolean(persistenceClient),
        error: 'The workspace could not be loaded. Please try again.',
      })
    }
  })

  socket.on('document:update', async (payload, acknowledge) => {
    const reply = typeof acknowledge === 'function' ? acknowledge : () => {}
    const roomId = socket.data.roomId
    if (!roomId || payload?.roomId !== roomId) {
      reply({ ok: false, error: 'Join the workspace before sending edits.' })
      return
    }
    if (socket.data.role !== 'owner' && socket.data.role !== 'editor') {
      reply({ ok: false, error: 'You do not have edit access to this workspace.' })
      return
    }
    const update = payload?.update
    if (
      !(update instanceof Uint8Array) ||
      update.byteLength === 0 ||
      update.byteLength > MAX_DOCUMENT_UPDATE_BYTES
    ) {
      socket.emit('room:error', 'An invalid document update was rejected.')
      reply({ ok: false, error: 'The document update is invalid.' })
      return
    }

    let doc
    let retryable = Boolean(persistenceClient)
    let shouldCompact = false
    try {
      doc = await getRoomDocument(roomId)
      retryable = false
      const validationDoc = new Y.Doc()
      try {
        Y.applyUpdate(validationDoc, update)
      } finally {
        validationDoc.destroy()
      }
      if (persistenceClient) {
        retryable = true
        shouldCompact = await appendRoomUpdate(
          persistenceClient,
          roomId,
          update,
          REDIS_COMPACTION_THRESHOLD,
        )
        retryable = false
      }
      Y.applyUpdate(doc, update)
      incrementCounter('documentUpdates')
      socket.to(roomId).emit('document:update', update)
    } catch (error) {
      incrementCounter('documentUpdateErrors')
      console.error(`Could not persist or apply update for room ${roomId}:`, error)
      socket.emit('room:error', 'A document update could not be applied.')
      reply({
        ok: false,
        retryable,
        error: 'The document update could not be saved.',
      })
      return
    }

    if (shouldCompact) scheduleRoomCompaction(roomId)

    if (updatePublisher) {
      try {
        await withRedisTimeout(
          updatePublisher.publish(
            'syncforge:document-updates',
            JSON.stringify({ roomId, update: Buffer.from(update).toString('base64') }),
          ),
          'Redis document update publish timed out',
        )
      } catch (error) {
        console.error(`Could not replicate update for room ${roomId}:`, error)
        socket.emit('room:error', 'Your edit was applied here, but could not be replicated to every server. Please retry.')
        reply({
          ok: false,
          retryable: true,
          error: 'The edit was saved but could not be shared with every server.',
        })
        return
      }
    }
    reply({ ok: true })
  })

  socket.on('disconnect', () => {
    incrementCounter('wsDisconnections')
    adjustGauge('wsConnectionsActive', -1)
    leaveCurrentRoom(socket)
  })
})

async function start() {
  if (process.env.NODE_ENV === 'production' && !REDIS_URL) {
    throw new Error('REDIS_URL is required in production for durable workspace storage.')
  }
  if (
    process.env.NODE_ENV === 'production' &&
    (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || SESSION_SECRET.length < 32)
  ) {
    throw new Error('GitHub OAuth credentials and a 32-character SESSION_SECRET are required in production.')
  }
  if (REDIS_URL && (!Number.isSafeInteger(REDIS_COMPACTION_THRESHOLD) || REDIS_COMPACTION_THRESHOLD < 1)) {
    throw new Error('REDIS_COMPACTION_THRESHOLD must be a positive safe integer.')
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
        scheduleRoomEviction(roomId)
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
  for (const timer of roomEvictionTimers.values()) clearTimeout(timer)
  roomEvictionTimers.clear()
  for (const loading of rooms.values()) {
    try {
      const doc = await loading
      doc.destroy()
    } catch (error) {
      console.error('Could not dispose of a workspace during shutdown:', error)
    }
  }
  rooms.clear()
  await Promise.all(
    redisConnections.filter((client) => client.isOpen).map((client) => client.quit()),
  )
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
