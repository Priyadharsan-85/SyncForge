import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createBranch,
  createCommit,
  getBranch,
  getCommit,
  initWorkspaceBranches,
} from '../src/branchManager.js'
import {
  closePullRequest,
  createPullRequest,
  getPullRequest,
  getPullRequestDiff,
  listPullRequests,
  mergePullRequest,
} from '../src/pullRequestManager.js'

const testUser = {
  id: 'usr-pr-tester',
  name: 'PR Reviewer',
  login: 'reviewer',
}

test('createPullRequest validates branches and sets up open PR', async () => {
  const roomId = 'room-pr-1'
  await initWorkspaceBranches(null, roomId, testUser, { 'index.js': 'console.log("init")' })
  await createBranch(null, {
    roomId,
    branchName: 'feature/auth-pr',
    fromBranch: 'main',
    user: testUser,
  })

  const pr = await createPullRequest(null, {
    roomId,
    title: 'Add authentication feature',
    description: 'Implements login and token verification.',
    sourceBranch: 'feature/auth-pr',
    targetBranch: 'main',
    author: testUser,
  })

  assert.equal(pr.number, 1)
  assert.equal(pr.status, 'open')
  assert.equal(pr.title, 'Add authentication feature')

  const fetched = await getPullRequest(null, roomId, 1)
  assert.deepEqual(fetched, pr)

  const list = await listPullRequests(null, roomId)
  assert.equal(list.length, 1)
  assert.equal(list[0].number, 1)
})

test('getPullRequestDiff computes file changes between feature and target', async () => {
  const roomId = 'room-pr-2'
  const main = await initWorkspaceBranches(null, roomId, testUser, { 'app.js': 'const v = 1' })
  await createBranch(null, {
    roomId,
    branchName: 'feature/update-v',
    fromBranch: 'main',
    user: testUser,
  })

  // Commit on feature branch
  await createCommit(null, {
    roomId,
    branchName: 'feature/update-v',
    message: 'Bump version',
    author: testUser,
    tree: { 'app.js': 'const v = 2', 'newfile.js': 'export const ok = true' },
    expectedParentCommitId: main.headCommitId,
  })

  const pr = await createPullRequest(null, {
    roomId,
    title: 'Bump version to 2',
    sourceBranch: 'feature/update-v',
    targetBranch: 'main',
    author: testUser,
  })

  const diffResult = await getPullRequestDiff(null, roomId, pr.number)
  assert.equal(diffResult.canMergeCleanly, true)
  assert.equal(diffResult.totalFilesChanged, 2)
  assert.ok(diffResult.files.some((f) => f.filePath === 'app.js' && f.type === 'modified'))
  assert.ok(diffResult.files.some((f) => f.filePath === 'newfile.js' && f.type === 'added'))
})

test('mergePullRequest updates target branch and changes PR status to merged', async () => {
  const roomId = 'room-pr-3'
  const main = await initWorkspaceBranches(null, roomId, testUser, { 'lib.js': 'export default 1' })
  await createBranch(null, {
    roomId,
    branchName: 'feature/lib-v2',
    fromBranch: 'main',
    user: testUser,
  })

  await createCommit(null, {
    roomId,
    branchName: 'feature/lib-v2',
    message: 'Update lib',
    author: testUser,
    tree: { 'lib.js': 'export default 2' },
    expectedParentCommitId: main.headCommitId,
  })

  const pr = await createPullRequest(null, {
    roomId,
    title: 'Upgrade lib',
    sourceBranch: 'feature/lib-v2',
    targetBranch: 'main',
    author: testUser,
  })

  const mergeResult = await mergePullRequest(null, {
    roomId,
    prNumber: pr.number,
    user: testUser,
  })

  assert.equal(mergeResult.ok, true)
  assert.equal(mergeResult.pr.status, 'merged')

  const updatedMain = await getBranch(null, roomId, 'main')
  const headCommit = await getCommit(null, roomId, updatedMain.headCommitId)
  assert.equal(headCommit.tree['lib.js'], 'export default 2')
})

test('closePullRequest sets status to closed and prevents future merge', async () => {
  const roomId = 'room-pr-4'
  await initWorkspaceBranches(null, roomId, testUser, { 'a.js': '1' })
  await createBranch(null, {
    roomId,
    branchName: 'feature/abandoned',
    fromBranch: 'main',
    user: testUser,
  })

  const pr = await createPullRequest(null, {
    roomId,
    title: 'Abandoned PR',
    sourceBranch: 'feature/abandoned',
    targetBranch: 'main',
    author: testUser,
  })

  const closed = await closePullRequest(null, {
    roomId,
    prNumber: pr.number,
    user: testUser,
  })
  assert.equal(closed.status, 'closed')

  await assert.rejects(
    async () => {
      await mergePullRequest(null, {
        roomId,
        prNumber: pr.number,
        user: testUser,
      })
    },
    (err) => {
      assert.equal(err.status, 409)
      assert.ok(err.message.includes('already closed'))
      return true
    },
  )
})

test('mergePullRequest rejects merge when conflicting edits exist between branches', async () => {
  const roomId = 'room-pr-5'
  const main = await initWorkspaceBranches(null, roomId, testUser, { 'file.js': 'original line' })

  // Feature branch changes file.js
  await createBranch(null, {
    roomId,
    branchName: 'feature/branch-a',
    fromBranch: 'main',
    user: testUser,
  })
  await createCommit(null, {
    roomId,
    branchName: 'feature/branch-a',
    message: 'Edit from A',
    author: testUser,
    tree: { 'file.js': 'line from branch A' },
    expectedParentCommitId: main.headCommitId,
  })

  // Main branch concurrently changes the same line in file.js
  await createCommit(null, {
    roomId,
    branchName: 'main',
    message: 'Edit from main',
    author: testUser,
    tree: { 'file.js': 'line from main branch' },
    expectedParentCommitId: main.headCommitId,
  })

  const pr = await createPullRequest(null, {
    roomId,
    title: 'Conflicting PR',
    sourceBranch: 'feature/branch-a',
    targetBranch: 'main',
    author: testUser,
  })

  const diffResult = await getPullRequestDiff(null, roomId, pr.number)
  assert.equal(diffResult.canMergeCleanly, false)

  await assert.rejects(
    async () => {
      await mergePullRequest(null, {
        roomId,
        prNumber: pr.number,
        user: testUser,
      })
    },
    (err) => {
      assert.equal(err.status, 409)
      assert.ok(err.message.includes('Merge conflict detected'))
      return true
    },
  )
})

