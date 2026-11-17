import { createHash, randomUUID } from 'node:crypto'
import { withRedisTimeout } from './redisStore.js'

export class BranchManagerError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

// In-memory fallbacks when Redis is not configured
const memoryWorkspaceBranches = new Map() // roomId -> Map<branchName, BranchRecord>
const memoryWorkspaceCommits = new Map() // roomId -> Map<commitId, CommitRecord>

export function computeTreeHash(tree) {
  const sortedKeys = Object.keys(tree || {}).sort()
  const hasher = createHash('sha256')
  for (const key of sortedKeys) {
    hasher.update(`${key}:${tree[key]}\n`)
  }
  return hasher.digest('hex').slice(0, 16)
}

function branchKey(roomId, branchName) {
  return `syncforge:workspace:${roomId}:branch:${branchName}`
}

const branchesSetKey = (roomId) => `syncforge:workspace:${roomId}:branches`
const commitKey = (roomId, commitId) => `syncforge:workspace:${roomId}:commit:${commitId}`

const SERIALIZED_PUSH_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return -1 end
local branch = cjson.decode(current)
if ARGV[1] ~= '' and branch.headCommitId ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[2], ARGV[2])
branch.headCommitId = ARGV[3]
redis.call('SET', KEYS[1], cjson.encode(branch))
return 1
`

export function validateBranchName(name) {
  if (
    typeof name !== 'string' ||
    !/^[a-zA-Z0-9/_.-]{1,64}$/.test(name) ||
    name.startsWith('/') ||
    name.endsWith('/') ||
    name.includes('//')
  ) {
    throw new BranchManagerError('Branch name must be 1–64 letters, numbers, slashes, dashes, or dots.')
  }
}

/**
 * Initialize workspace branches. Creates 'main' branch pointing to initial commit if not already initialized.
 */
export async function initWorkspaceBranches(client, roomId, user, initialFiles = {}) {
  const existing = await getBranch(client, roomId, 'main')
  if (existing) return existing

  const initialTree = { ...initialFiles }
  const commitId = randomUUID().replace(/-/g, '')
  const initialCommit = {
    commitId,
    parentCommitId: null,
    message: 'Initial workspace snapshot',
    author: {
      id: String(user.id),
      name: user.name,
      login: user.login,
    },
    tree: initialTree,
    treeHash: computeTreeHash(initialTree),
    timestamp: new Date().toISOString(),
  }

  const branchRecord = {
    name: 'main',
    headCommitId: commitId,
    createdAt: new Date().toISOString(),
    creator: { id: String(user.id), name: user.name },
  }

  if (client) {
    await withRedisTimeout(
      client
        .multi()
        .sAdd(branchesSetKey(roomId), 'main')
        .set(branchKey(roomId, 'main'), JSON.stringify(branchRecord))
        .set(commitKey(roomId, commitId), JSON.stringify(initialCommit))
        .exec(),
      'Failed to initialize workspace branches in Redis',
    )
  } else {
    if (!memoryWorkspaceBranches.has(roomId)) {
      memoryWorkspaceBranches.set(roomId, new Map())
      memoryWorkspaceCommits.set(roomId, new Map())
    }
    memoryWorkspaceBranches.get(roomId).set('main', branchRecord)
    memoryWorkspaceCommits.get(roomId).set(commitId, initialCommit)
  }

  return branchRecord
}

/**
 * List all branches in a workspace.
 */
export async function listBranches(client, roomId) {
  if (client) {
    const branchNames = await withRedisTimeout(
      client.sMembers(branchesSetKey(roomId)),
      'Failed to list branches',
    )
    if (!branchNames || branchNames.length === 0) return []

    const records = await Promise.all(
      branchNames.map(async (name) => {
        const raw = await client.get(branchKey(roomId, name))
        return raw ? JSON.parse(raw) : null
      }),
    )
    return records.filter(Boolean)
  }

  const roomBranches = memoryWorkspaceBranches.get(roomId)
  if (!roomBranches) return []
  return [...roomBranches.values()]
}

/**
 * Retrieve a branch by name.
 */
export async function getBranch(client, roomId, branchName) {
  validateBranchName(branchName)
  if (client) {
    const raw = await withRedisTimeout(
      client.get(branchKey(roomId, branchName)),
      'Failed to get branch',
    )
    return raw ? JSON.parse(raw) : null
  }

  const roomBranches = memoryWorkspaceBranches.get(roomId)
  return roomBranches?.get(branchName) ?? null
}

/**
 * Retrieve a commit by commitId.
 */
export async function getCommit(client, roomId, commitId) {
  if (!commitId) return null
  if (client) {
    const raw = await withRedisTimeout(
      client.get(commitKey(roomId, commitId)),
      'Failed to get commit',
    )
    return raw ? JSON.parse(raw) : null
  }

  const roomCommits = memoryWorkspaceCommits.get(roomId)
  return roomCommits?.get(commitId) ?? null
}

/**
 * Create a new branch originating from an existing branch or commit.
 */
export async function createBranch(client, { roomId, branchName, fromBranch = 'main', user }) {
  validateBranchName(branchName)
  const existing = await getBranch(client, roomId, branchName)
  if (existing) {
    throw new BranchManagerError(`Branch "${branchName}" already exists.`, 409)
  }

  const sourceBranch = await getBranch(client, roomId, fromBranch)
  if (!sourceBranch) {
    throw new BranchManagerError(`Source branch "${fromBranch}" does not exist.`, 404)
  }

  const newBranch = {
    name: branchName,
    headCommitId: sourceBranch.headCommitId,
    createdAt: new Date().toISOString(),
    creator: { id: String(user.id), name: user.name },
  }

  if (client) {
    await withRedisTimeout(
      client
        .multi()
        .sAdd(branchesSetKey(roomId), branchName)
        .set(branchKey(roomId, branchName), JSON.stringify(newBranch))
        .exec(),
      'Failed to create branch in Redis',
    )
  } else {
    if (!memoryWorkspaceBranches.has(roomId)) {
      memoryWorkspaceBranches.set(roomId, new Map())
      memoryWorkspaceCommits.set(roomId, new Map())
    }
    memoryWorkspaceBranches.get(roomId).set(branchName, newBranch)
  }

  return newBranch
}

/**
 * Retrieve commit history for a branch starting from HEAD.
 */
export async function getBranchCommits(client, roomId, branchName, limit = 20) {
  const branch = await getBranch(client, roomId, branchName)
  if (!branch) return []

  const history = []
  let currentCommitId = branch.headCommitId
  let count = 0

  while (currentCommitId && count < limit) {
    const commit = await getCommit(client, roomId, currentCommitId)
    if (!commit) break
    history.push({
      commitId: commit.commitId,
      parentCommitId: commit.parentCommitId,
      message: commit.message,
      author: commit.author,
      treeHash: commit.treeHash,
      timestamp: commit.timestamp,
      fileCount: Object.keys(commit.tree || {}).length,
    })
    currentCommitId = commit.parentCommitId
    count++
  }

  return history
}

/**
 * Commit a snapshot to a branch with serialization and optimistic concurrency control.
 *
 * @param {import('redis').RedisClientType | null} client
 * @param {object} params
 * @param {string} params.roomId
 * @param {string} params.branchName
 * @param {string} params.message
 * @param {object} params.author
 * @param {Record<string, string>} params.tree
 * @param {string | null} [params.expectedParentCommitId]
 * @returns {Promise<object>} New commit record
 */
export async function createCommit(client, {
  roomId,
  branchName,
  message,
  author,
  tree,
  expectedParentCommitId = null,
}) {
  validateBranchName(branchName)
  if (!message || typeof message !== 'string') {
    throw new BranchManagerError('A commit message is required.')
  }
  if (!tree || typeof tree !== 'object') {
    throw new BranchManagerError('A valid file tree object is required.')
  }

  const commitId = randomUUID().replace(/-/g, '')
  const timestamp = new Date().toISOString()
  const treeHash = computeTreeHash(tree)

  const newCommit = {
    commitId,
    parentCommitId: expectedParentCommitId,
    message: message.trim().slice(0, 200),
    author: {
      id: String(author.id),
      name: author.name,
      login: author.login,
    },
    tree: { ...tree },
    treeHash,
    timestamp,
  }

  if (client) {
    const bKey = branchKey(roomId, branchName)
    const cKey = commitKey(roomId, commitId)
    const result = await withRedisTimeout(
      client.eval(SERIALIZED_PUSH_SCRIPT, {
        keys: [bKey, cKey],
        arguments: [expectedParentCommitId || '', JSON.stringify(newCommit), commitId],
      }),
      'Branch commit push timed out',
    )

    if (result === -1) {
      throw new BranchManagerError(`Branch "${branchName}" does not exist.`, 404)
    }
    if (result === 0) {
      throw new BranchManagerError(
        `Branch "${branchName}" has moved ahead. Fetch latest changes before committing.`,
        409,
      )
    }
  } else {
    const roomBranches = memoryWorkspaceBranches.get(roomId)
    const branch = roomBranches?.get(branchName)
    if (!branch) {
      throw new BranchManagerError(`Branch "${branchName}" does not exist.`, 404)
    }

    if (expectedParentCommitId && branch.headCommitId !== expectedParentCommitId) {
      throw new BranchManagerError(
        `Branch "${branchName}" has moved ahead. Fetch latest changes before committing.`,
        409,
      )
    }

    branch.headCommitId = commitId
    newCommit.parentCommitId = expectedParentCommitId ?? branch.headCommitId
    memoryWorkspaceCommits.get(roomId).set(commitId, newCommit)
  }

  return newCommit
}

