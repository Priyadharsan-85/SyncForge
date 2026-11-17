import { randomUUID } from 'node:crypto'
import {
  createCommit,
  getBranch,
  getCommit,
} from './branchManager.js'
import { formatUnifiedDiff } from './diffPatch.js'
import { withRedisTimeout } from './redisStore.js'
import { threeWayMerge } from './semanticMerge.js'

export class PullRequestError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

// In-memory PR store fallback
const memoryPullRequests = new Map() // roomId -> Map<number, PRRecord>
const memoryPrCounters = new Map() // roomId -> number

function prKey(roomId, prNumber) {
  return `syncforge:workspace:${roomId}:pr:${prNumber}`
}

function prCounterKey(roomId) {
  return `syncforge:workspace:${roomId}:pr-counter`
}

function prListKey(roomId) {
  return `syncforge:workspace:${roomId}:prs`
}

/**
 * Create a new Pull Request.
 */
export async function createPullRequest(client, {
  roomId,
  title,
  description = '',
  sourceBranch,
  targetBranch = 'main',
  author,
}) {
  if (!title || typeof title !== 'string') {
    throw new PullRequestError('A pull request title is required.')
  }
  if (!sourceBranch || typeof sourceBranch !== 'string') {
    throw new PullRequestError('A source branch is required.')
  }
  if (sourceBranch === targetBranch) {
    throw new PullRequestError('Source and target branches must be different.')
  }

  const [source, target] = await Promise.all([
    getBranch(client, roomId, sourceBranch),
    getBranch(client, roomId, targetBranch),
  ])

  if (!source) throw new PullRequestError(`Source branch "${sourceBranch}" not found.`, 404)
  if (!target) throw new PullRequestError(`Target branch "${targetBranch}" not found.`, 404)

  let prNumber = 1
  if (client) {
    prNumber = await withRedisTimeout(
      client.incr(prCounterKey(roomId)),
      'PR counter increment timed out',
    )
  } else {
    const cur = memoryPrCounters.get(roomId) ?? 0
    prNumber = cur + 1
    memoryPrCounters.set(roomId, prNumber)
  }

  const pr = {
    prId: randomUUID().replace(/-/g, ''),
    number: prNumber,
    roomId,
    title: title.trim().slice(0, 120),
    description: (description || '').trim().slice(0, 2000),
    sourceBranch,
    targetBranch,
    author: {
      id: String(author.id),
      name: author.name,
      login: author.login,
    },
    status: 'open',
    createdAt: new Date().toISOString(),
  }

  if (client) {
    await withRedisTimeout(
      client
        .multi()
        .sAdd(prListKey(roomId), String(prNumber))
        .set(prKey(roomId, prNumber), JSON.stringify(pr))
        .exec(),
      'Failed to save PR in Redis',
    )
  } else {
    if (!memoryPullRequests.has(roomId)) {
      memoryPullRequests.set(roomId, new Map())
    }
    memoryPullRequests.get(roomId).set(prNumber, pr)
  }

  return pr
}

/**
 * List pull requests for a workspace.
 */
export async function listPullRequests(client, roomId, filterStatus = null) {
  let list = []
  if (client) {
    const prNumbers = await withRedisTimeout(
      client.sMembers(prListKey(roomId)),
      'Failed to list PRs from Redis',
    )
    if (!prNumbers || prNumbers.length === 0) return []

    const prs = await Promise.all(
      prNumbers.map(async (num) => {
        const raw = await client.get(prKey(roomId, num))
        return raw ? JSON.parse(raw) : null
      }),
    )
    list = prs.filter(Boolean)
  } else {
    const roomPrs = memoryPullRequests.get(roomId)
    list = roomPrs ? [...roomPrs.values()] : []
  }

  if (filterStatus) {
    list = list.filter((p) => p.status === filterStatus)
  }
  list.sort((a, b) => b.number - a.number)
  return list
}

/**
 * Retrieve a pull request by number.
 */
export async function getPullRequest(client, roomId, prNumber) {
  const num = Number(prNumber)
  if (!Number.isSafeInteger(num) || num < 1) {
    throw new PullRequestError('Invalid pull request number.')
  }

  if (client) {
    const raw = await withRedisTimeout(
      client.get(prKey(roomId, num)),
      'Failed to fetch PR from Redis',
    )
    return raw ? JSON.parse(raw) : null
  }

  return memoryPullRequests.get(roomId)?.get(num) ?? null
}

/**
 * Calculate the diff and conflict status between source and target branches of a PR.
 */
export async function getPullRequestDiff(client, roomId, prNumber) {
  const pr = await getPullRequest(client, roomId, prNumber)
  if (!pr) throw new PullRequestError('Pull request not found.', 404)

  const [sourceBranch, targetBranch] = await Promise.all([
    getBranch(client, roomId, pr.sourceBranch),
    getBranch(client, roomId, pr.targetBranch),
  ])

  if (!sourceBranch || !targetBranch) {
    throw new PullRequestError('One or more PR branches no longer exist.', 404)
  }

  const [sourceCommit, targetCommit] = await Promise.all([
    getCommit(client, roomId, sourceBranch.headCommitId),
    getCommit(client, roomId, targetBranch.headCommitId),
  ])

  const sourceTree = sourceCommit?.tree ?? {}
  const targetTree = targetCommit?.tree ?? {}

  const allFiles = new Set([...Object.keys(sourceTree), ...Object.keys(targetTree)])
  const fileDiffs = []
  let totalAdditions = 0
  let totalDeletions = 0
  let hasMergeConflict = false

  for (const filePath of allFiles) {
    const sourceContent = sourceTree[filePath]
    const targetContent = targetTree[filePath]

    if (sourceContent === targetContent) continue

    if (targetContent === undefined && sourceContent !== undefined) {
      // Added in source
      const diff = formatUnifiedDiff(filePath, '', sourceContent)
      fileDiffs.push({
        filePath,
        type: 'added',
        diff,
      })
      totalAdditions += sourceContent.split(/\r?\n/).length
    } else if (sourceContent === undefined && targetContent !== undefined) {
      // Deleted in source
      const diff = formatUnifiedDiff(filePath, targetContent, '')
      fileDiffs.push({
        filePath,
        type: 'deleted',
        diff,
      })
      totalDeletions += targetContent.split(/\r?\n/).length
    } else {
      // Modified in both or one
      const diff = formatUnifiedDiff(filePath, targetContent, sourceContent)
      const merge = threeWayMerge('', targetContent, sourceContent)
      if (merge.hasConflict) hasMergeConflict = true

      fileDiffs.push({
        filePath,
        type: 'modified',
        diff,
        conflict: merge.hasConflict,
      })
    }
  }

  return {
    prNumber: pr.number,
    sourceBranch: pr.sourceBranch,
    targetBranch: pr.targetBranch,
    files: fileDiffs,
    totalFilesChanged: fileDiffs.length,
    canMergeCleanly: !hasMergeConflict,
  }
}

/**
 * Merge a pull request with concurrency control.
 */
export async function mergePullRequest(client, { roomId, prNumber, user, commitMessage }) {
  const pr = await getPullRequest(client, roomId, prNumber)
  if (!pr) throw new PullRequestError('Pull request not found.', 404)
  if (pr.status !== 'open') {
    throw new PullRequestError(`Pull request is already ${pr.status}.`, 409)
  }

  const [sourceBranch, targetBranch] = await Promise.all([
    getBranch(client, roomId, pr.sourceBranch),
    getBranch(client, roomId, pr.targetBranch),
  ])

  if (!sourceBranch || !targetBranch) {
    throw new PullRequestError('One or more PR branches no longer exist.', 404)
  }

  const [sourceCommit, targetCommit] = await Promise.all([
    getCommit(client, roomId, sourceBranch.headCommitId),
    getCommit(client, roomId, targetBranch.headCommitId),
  ])

  const diffResult = await getPullRequestDiff(client, roomId, prNumber)
  if (!diffResult.canMergeCleanly) {
    throw new PullRequestError('Cannot merge pull request: Merge conflict detected between branches.', 409)
  }

  // Combine source changes onto target tree
  const mergedTree = { ...(targetCommit?.tree ?? {}), ...(sourceCommit?.tree ?? {}) }
  const message = commitMessage?.trim() || `Merge PR #${pr.number} from ${pr.sourceBranch} into ${pr.targetBranch}`

  // Serialized commit creation on targetBranch checking targetCommit.commitId
  const mergeCommit = await createCommit(client, {
    roomId,
    branchName: pr.targetBranch,
    message,
    author: user,
    tree: mergedTree,
    expectedParentCommitId: targetBranch.headCommitId,
  })

  // Update PR status
  pr.status = 'merged'
  pr.mergedAt = new Date().toISOString()
  pr.mergeCommitId = mergeCommit.commitId

  if (client) {
    await withRedisTimeout(
      client.set(prKey(roomId, pr.number), JSON.stringify(pr)),
      'Failed to update merged PR in Redis',
    )
  } else {
    memoryPullRequests.get(roomId).set(pr.number, pr)
  }

  return { ok: true, pr, mergeCommit }
}

/**
 * Close a pull request without merging.
 */
export async function closePullRequest(client, { roomId, prNumber, user }) {
  const pr = await getPullRequest(client, roomId, prNumber)
  if (!pr) throw new PullRequestError('Pull request not found.', 404)
  if (pr.status !== 'open') {
    throw new PullRequestError(`Pull request is already ${pr.status}.`, 409)
  }

  pr.status = 'closed'
  pr.closedAt = new Date().toISOString()
  pr.closedBy = { id: String(user.id), name: user.name }

  if (client) {
    await withRedisTimeout(
      client.set(prKey(roomId, pr.number), JSON.stringify(pr)),
      'Failed to update closed PR in Redis',
    )
  } else {
    memoryPullRequests.get(roomId).set(pr.number, pr)
  }

  return pr
}
