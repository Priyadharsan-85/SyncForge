/**
 * Additional edge-case tests for the branch manager module.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import {
  BranchManagerError,
  computeTreeHash,
  createBranch,
  createCommit,
  getBranch,
  getBranchCommits,
  initWorkspaceBranches,
  listBranches,
  validateBranchName,
} from '../src/branchManager.js'

function newRoom() {
  return randomUUID().replace(/-/g, '')
}

const user = { id: 'edge-user', login: 'edgeuser', name: 'Edge User' }

test('validateBranchName accepts complex valid branch names', () => {
  const valid = ['main', 'feature/my-branch', 'release-1.0', 'fix/issue_42', 'a/b/c']
  for (const name of valid) {
    assert.doesNotThrow(() => validateBranchName(name), `Should accept: ${name}`)
  }
})

test('validateBranchName rejects invalid branch names', () => {
  const invalid = ['', ' ', '/starts-with-slash', 'ends-with-slash/', 'double//slash', 'a'.repeat(65)]
  for (const name of invalid) {
    assert.throws(() => validateBranchName(name), BranchManagerError, `Should reject: "${name}"`)
  }
})

test('computeTreeHash produces the same hash for the same files in any order', () => {
  const tree1 = { 'src/index.js': 'console.log(1)', 'README.md': '# Test' }
  const tree2 = { 'README.md': '# Test', 'src/index.js': 'console.log(1)' }
  assert.equal(computeTreeHash(tree1), computeTreeHash(tree2))
})

test('computeTreeHash produces different hashes for different trees', () => {
  const a = { 'file.js': 'content-a' }
  const b = { 'file.js': 'content-b' }
  assert.notEqual(computeTreeHash(a), computeTreeHash(b))
})

test('computeTreeHash handles empty tree', () => {
  assert.equal(typeof computeTreeHash({}), 'string')
  assert.ok(computeTreeHash({}).length > 0)
})

test('createBranch rejects when branch already exists', async () => {
  const roomId = newRoom()
  await initWorkspaceBranches(null, roomId, user)
  await assert.rejects(
    () => createBranch(null, { roomId, branchName: 'main', fromBranch: 'main', user }),
    (err) => err instanceof BranchManagerError && err.status === 409,
  )
})

test('createBranch rejects when source branch does not exist', async () => {
  const roomId = newRoom()
  await initWorkspaceBranches(null, roomId, user)
  await assert.rejects(
    () => createBranch(null, { roomId, branchName: 'feature', fromBranch: 'nonexistent', user }),
    (err) => err instanceof BranchManagerError && err.status === 404,
  )
})

test('getBranch returns null for a non-existent branch', async () => {
  const roomId = newRoom()
  await initWorkspaceBranches(null, roomId, user)
  const branch = await getBranch(null, roomId, 'nonexistent')
  assert.equal(branch, null)
})

test('listBranches includes both main and feature branches', async () => {
  const roomId = newRoom()
  await initWorkspaceBranches(null, roomId, user)
  await createBranch(null, { roomId, branchName: 'feature/x', fromBranch: 'main', user })
  await createBranch(null, { roomId, branchName: 'feature/y', fromBranch: 'main', user })

  const branches = await listBranches(null, roomId)
  const names = branches.map((b) => b.name)
  assert.ok(names.includes('main'))
  assert.ok(names.includes('feature/x'))
  assert.ok(names.includes('feature/y'))
  assert.equal(branches.length, 3)
})

test('createCommit requires a non-empty message', async () => {
  const roomId = newRoom()
  await initWorkspaceBranches(null, roomId, user)
  await assert.rejects(
    () => createCommit(null, {
      roomId,
      branchName: 'main',
      message: '',
      author: user,
      tree: {},
    }),
    BranchManagerError,
  )
})

test('createCommit requires a valid tree object', async () => {
  const roomId = newRoom()
  await initWorkspaceBranches(null, roomId, user)
  await assert.rejects(
    () => createCommit(null, {
      roomId,
      branchName: 'main',
      message: 'valid message',
      author: user,
      tree: null,
    }),
    BranchManagerError,
  )
})

test('getBranchCommits returns empty array for a workspace with no history', async () => {
  const roomId = newRoom()
  // No branches initialized
  const commits = await getBranchCommits(null, roomId, 'main')
  assert.deepEqual(commits, [])
})

test('commit history is capped to the limit parameter', async () => {
  const roomId = newRoom()
  await initWorkspaceBranches(null, roomId, user)
  const main = await getBranch(null, roomId, 'main')

  let parentId = main.headCommitId
  for (let i = 0; i < 5; i++) {
    const commit = await createCommit(null, {
      roomId,
      branchName: 'main',
      message: `Commit ${i}`,
      author: user,
      tree: { 'file.js': `content-${i}` },
      expectedParentCommitId: parentId,
    })
    parentId = commit.commitId
  }

  const history3 = await getBranchCommits(null, roomId, 'main', 3)
  assert.equal(history3.length, 3)

  const historyAll = await getBranchCommits(null, roomId, 'main', 10)
  assert.equal(historyAll.length, 6) // initial + 5
})
