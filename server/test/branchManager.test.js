import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeTreeHash,
  createBranch,
  createCommit,
  getBranch,
  getBranchCommits,
  getCommit,
  initWorkspaceBranches,
  listBranches,
  validateBranchName,
} from '../src/branchManager.js'

const testUser = {
  id: 'usr-1',
  name: 'Dev User',
  login: 'devuser',
}

test('validateBranchName accepts valid git branch names and rejects invalid names', () => {
  assert.doesNotThrow(() => validateBranchName('main'))
  assert.doesNotThrow(() => validateBranchName('feature/login-modal'))
  assert.doesNotThrow(() => validateBranchName('v1.0.0-beta'))

  assert.throws(() => validateBranchName(''), /Branch name must be/)
  assert.throws(() => validateBranchName('/main'), /Branch name must be/)
  assert.throws(() => validateBranchName('main/'), /Branch name must be/)
  assert.throws(() => validateBranchName('feature//bug'), /Branch name must be/)
  assert.throws(() => validateBranchName('invalid branch space'), /Branch name must be/)
})

test('computeTreeHash generates deterministic hash based on sorted file contents', () => {
  const tree1 = { 'b.js': 'content b', 'a.js': 'content a' }
  const tree2 = { 'a.js': 'content a', 'b.js': 'content b' }
  assert.equal(computeTreeHash(tree1), computeTreeHash(tree2))
})

test('initWorkspaceBranches creates main branch with initial commit and files', async () => {
  const roomId = 'room-branch-test-1'
  const files = { 'index.js': 'console.log("hello")' }

  const main = await initWorkspaceBranches(null, roomId, testUser, files)
  assert.equal(main.name, 'main')
  assert.ok(main.headCommitId)

  const commit = await getCommit(null, roomId, main.headCommitId)
  assert.ok(commit)
  assert.equal(commit.message, 'Initial workspace snapshot')
  assert.deepEqual(commit.tree, files)

  const branches = await listBranches(null, roomId)
  assert.equal(branches.length, 1)
  assert.equal(branches[0].name, 'main')
})

test('createBranch forks from main and shares head commit', async () => {
  const roomId = 'room-branch-test-2'
  await initWorkspaceBranches(null, roomId, testUser, { 'app.js': 'const x = 1' })

  const featureBranch = await createBranch(null, {
    roomId,
    branchName: 'feature/test-feature',
    fromBranch: 'main',
    user: testUser,
  })

  assert.equal(featureBranch.name, 'feature/test-feature')

  const main = await getBranch(null, roomId, 'main')
  assert.equal(featureBranch.headCommitId, main.headCommitId)

  const branches = await listBranches(null, roomId)
  assert.equal(branches.length, 2)
})

test('getBranchCommits returns linear history of commits', async () => {
  const roomId = 'room-branch-test-3'
  await initWorkspaceBranches(null, roomId, testUser, { 'main.js': 'init' })

  const history = await getBranchCommits(null, roomId, 'main')
  assert.equal(history.length, 1)
  assert.equal(history[0].message, 'Initial workspace snapshot')
})

test('createCommit advances branch HEAD when expected parent matches', async () => {
  const roomId = 'room-branch-test-4'
  const main = await initWorkspaceBranches(null, roomId, testUser, { 'index.js': 'v1' })

  const nextCommit = await createCommit(null, {
    roomId,
    branchName: 'main',
    message: 'Update index to v2',
    author: testUser,
    tree: { 'index.js': 'v2' },
    expectedParentCommitId: main.headCommitId,
  })

  assert.ok(nextCommit.commitId)
  const updatedMain = await getBranch(null, roomId, 'main')
  assert.equal(updatedMain.headCommitId, nextCommit.commitId)
})

test('createCommit rejects concurrent conflicting push to the same branch', async () => {
  const roomId = 'room-branch-test-5'
  const main = await initWorkspaceBranches(null, roomId, testUser, { 'index.js': 'initial' })
  const initialHead = main.headCommitId

  // Collaborator A pushes first
  const commitA = await createCommit(null, {
    roomId,
    branchName: 'main',
    message: 'Collaborator A change',
    author: { id: 'usr-a', name: 'Alice', login: 'alice' },
    tree: { 'index.js': 'alice code' },
    expectedParentCommitId: initialHead,
  })
  assert.ok(commitA.commitId)

  // Collaborator B attempts to push against stale initialHead
  await assert.rejects(
    async () => {
      await createCommit(null, {
        roomId,
        branchName: 'main',
        message: 'Collaborator B change',
        author: { id: 'usr-b', name: 'Bob', login: 'bob' },
        tree: { 'index.js': 'bob code' },
        expectedParentCommitId: initialHead, // Stale!
      })
    },
    (err) => {
      assert.equal(err.status, 409)
      assert.ok(err.message.includes('moved ahead'))
      return true
    },
  )
})

