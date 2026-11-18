/**
 * Additional edge-case tests for pull request creation, diff, and lifecycle.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import {
  createBranch,
  createCommit,
  initWorkspaceBranches,
} from '../src/branchManager.js'
import {
  closePullRequest,
  createPullRequest,
  getPullRequest,
  getPullRequestDiff,
  listPullRequests,
  mergePullRequest,
  PullRequestError,
} from '../src/pullRequestManager.js'

function newRoom() {
  return randomUUID().replace(/-/g, '')
}

const user = { id: 'pr-edge-user', login: 'predgeuser', name: 'PR Edge User' }

async function setupWorkspaceWithFeature(roomId) {
  await initWorkspaceBranches(null, roomId, user, {
    'README.md': '# Initial\n',
    'index.js': 'console.log("initial")\n',
  })

  const main = await (await import('../src/branchManager.js')).getBranch(null, roomId, 'main')
  await createBranch(null, { roomId, branchName: 'feature/test', fromBranch: 'main', user })
  await createCommit(null, {
    roomId,
    branchName: 'feature/test',
    message: 'Add feature',
    author: user,
    tree: {
      'README.md': '# Initial\n',
      'index.js': 'console.log("initial")\n',
      'feature.js': 'export const feature = true\n',
    },
    expectedParentCommitId: main.headCommitId,
  })
}

test('createPullRequest rejects empty title', async () => {
  const roomId = newRoom()
  await setupWorkspaceWithFeature(roomId)
  await assert.rejects(
    () => createPullRequest(null, {
      roomId,
      title: '',
      sourceBranch: 'feature/test',
      targetBranch: 'main',
      author: user,
    }),
    PullRequestError,
  )
})

test('createPullRequest rejects same source and target branches', async () => {
  const roomId = newRoom()
  await setupWorkspaceWithFeature(roomId)
  await assert.rejects(
    () => createPullRequest(null, {
      roomId,
      title: 'Self merge',
      sourceBranch: 'main',
      targetBranch: 'main',
      author: user,
    }),
    PullRequestError,
  )
})

test('createPullRequest rejects when source branch does not exist', async () => {
  const roomId = newRoom()
  await initWorkspaceBranches(null, roomId, user)
  await assert.rejects(
    () => createPullRequest(null, {
      roomId,
      title: 'Valid title',
      sourceBranch: 'nonexistent',
      targetBranch: 'main',
      author: user,
    }),
    (err) => err instanceof PullRequestError && err.status === 404,
  )
})

test('listPullRequests filters by status', async () => {
  const roomId = newRoom()
  await setupWorkspaceWithFeature(roomId)

  const pr1 = await createPullRequest(null, {
    roomId,
    title: 'First PR',
    sourceBranch: 'feature/test',
    targetBranch: 'main',
    author: user,
  })

  await closePullRequest(null, { roomId, prNumber: pr1.number, user })

  // Create a second feature branch with a PR
  const main = await (await import('../src/branchManager.js')).getBranch(null, roomId, 'main')
  await createBranch(null, { roomId, branchName: 'feature/second', fromBranch: 'main', user })
  await createCommit(null, {
    roomId,
    branchName: 'feature/second',
    message: 'Second feature',
    author: user,
    tree: { 'second.js': 'const x = 2\n' },
    expectedParentCommitId: main.headCommitId,
  })
  await createPullRequest(null, {
    roomId,
    title: 'Second PR',
    sourceBranch: 'feature/second',
    targetBranch: 'main',
    author: user,
  })

  const open = await listPullRequests(null, roomId, 'open')
  const closed = await listPullRequests(null, roomId, 'closed')
  const all = await listPullRequests(null, roomId)

  assert.equal(open.length, 1)
  assert.equal(closed.length, 1)
  assert.equal(all.length, 2)
})

test('mergePullRequest rejects already-merged PR', async () => {
  const roomId = newRoom()
  await setupWorkspaceWithFeature(roomId)
  const pr = await createPullRequest(null, {
    roomId,
    title: 'Merge once',
    sourceBranch: 'feature/test',
    targetBranch: 'main',
    author: user,
  })
  await mergePullRequest(null, { roomId, prNumber: pr.number, user })
  await assert.rejects(
    () => mergePullRequest(null, { roomId, prNumber: pr.number, user }),
    (err) => err instanceof PullRequestError && err.status === 409,
  )
})

test('closePullRequest prevents subsequent close', async () => {
  const roomId = newRoom()
  await setupWorkspaceWithFeature(roomId)
  const pr = await createPullRequest(null, {
    roomId,
    title: 'Close once',
    sourceBranch: 'feature/test',
    targetBranch: 'main',
    author: user,
  })
  await closePullRequest(null, { roomId, prNumber: pr.number, user })
  await assert.rejects(
    () => closePullRequest(null, { roomId, prNumber: pr.number, user }),
    (err) => err instanceof PullRequestError && err.status === 409,
  )
})

test('getPullRequest returns null for non-existent PR number', async () => {
  const roomId = newRoom()
  await initWorkspaceBranches(null, roomId, user)
  const pr = await getPullRequest(null, roomId, 9999)
  assert.equal(pr, null)
})

test('getPullRequestDiff reports new files correctly', async () => {
  const roomId = newRoom()
  await setupWorkspaceWithFeature(roomId)
  const pr = await createPullRequest(null, {
    roomId,
    title: 'Add feature.js',
    sourceBranch: 'feature/test',
    targetBranch: 'main',
    author: user,
  })
  const diff = await getPullRequestDiff(null, roomId, pr.number)
  assert.ok(diff.files.length >= 1)
  const addedFile = diff.files.find((f) => f.type === 'added' && f.filePath === 'feature.js')
  assert.ok(addedFile, 'feature.js should appear as an added file')
  assert.equal(diff.canMergeCleanly, true)
})
