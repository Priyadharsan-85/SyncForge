import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeTreeHash,
  createBranch,
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
