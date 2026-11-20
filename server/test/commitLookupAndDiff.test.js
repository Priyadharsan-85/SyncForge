import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import {
  BranchManagerError,
  createCommit,
  getCommit,
  getCommitDiff,
  initWorkspaceBranches,
} from '../src/branchManager.js'

function newRoom() {
  return randomUUID().replace(/-/g, '')
}

const user = { id: 'commit-tester', login: 'committester', name: 'Commit Tester' }

test('getCommit returns null for non-existent commitId', async () => {
  const roomId = newRoom()
  const commit = await getCommit(null, roomId, 'non-existent-commit-id')
  assert.equal(commit, null)
})

test('getCommit retrieves commit by id with metadata and tree', async () => {
  const roomId = newRoom()
  const initialFiles = { 'index.js': 'console.log("hello");' }
  const main = await initWorkspaceBranches(null, roomId, user, initialFiles)

  const commit = await getCommit(null, roomId, main.headCommitId)
  assert.ok(commit)
  assert.equal(commit.commitId, main.headCommitId)
  assert.equal(commit.parentCommitId, null)
  assert.equal(commit.message, 'Initial workspace snapshot')
  assert.equal(commit.author.id, user.id)
  assert.deepEqual(commit.tree, initialFiles)
  assert.ok(typeof commit.treeHash === 'string')
})

test('getCommitDiff on initial commit reports all files as added', async () => {
  const roomId = newRoom()
  const initialFiles = {
    'index.js': 'console.log("init");',
    'README.md': '# Welcome\nDocumentation',
  }
  const main = await initWorkspaceBranches(null, roomId, user, initialFiles)

  const diff = await getCommitDiff(null, roomId, main.headCommitId)
  assert.equal(diff.commitId, main.headCommitId)
  assert.equal(diff.parentCommitId, null)
  assert.equal(diff.stats.filesChanged, 2)
  assert.ok(diff.stats.additions > 0)
  assert.equal(diff.stats.deletions, 0)

  const addedFiles = diff.fileDiffs.map((f) => f.filePath).sort()
  assert.deepEqual(addedFiles, ['README.md', 'index.js'])
  for (const f of diff.fileDiffs) {
    assert.equal(f.type, 'added')
    assert.ok(f.diff.length > 0)
  }
})

test('getCommitDiff correctly computes additions, modifications, and deletions between commits', async () => {
  const roomId = newRoom()
  const initialFiles = {
    'keep.js': 'const x = 1;',
    'modify.js': 'line1\nline2',
    'remove.js': 'deleted content',
  }
  const main = await initWorkspaceBranches(null, roomId, user, initialFiles)
  const initialCommitId = main.headCommitId

  const updatedTree = {
    'keep.js': 'const x = 1;',
    'modify.js': 'line1\nline2 modified\nline3 new',
    'newfile.js': 'newly added file',
  }

  const commit = await createCommit(null, {
    roomId,
    branchName: 'main',
    message: 'Second commit with changes',
    author: user,
    tree: updatedTree,
    expectedParentCommitId: initialCommitId,
  })

  const diff = await getCommitDiff(null, roomId, commit.commitId)
  assert.equal(diff.commitId, commit.commitId)
  assert.equal(diff.parentCommitId, initialCommitId)
  assert.equal(diff.stats.filesChanged, 3) // modify.js, remove.js, newfile.js (keep.js unchanged)

  const modifyDiff = diff.fileDiffs.find((f) => f.filePath === 'modify.js')
  assert.ok(modifyDiff)
  assert.equal(modifyDiff.type, 'modified')

  const removeDiff = diff.fileDiffs.find((f) => f.filePath === 'remove.js')
  assert.ok(removeDiff)
  assert.equal(removeDiff.type, 'deleted')

  const addDiff = diff.fileDiffs.find((f) => f.filePath === 'newfile.js')
  assert.ok(addDiff)
  assert.equal(addDiff.type, 'added')
})

test('getCommitDiff throws 404 for unknown commitId', async () => {
  const roomId = newRoom()
  await assert.rejects(
    () => getCommitDiff(null, roomId, 'unknown-id'),
    (err) => {
      assert.ok(err instanceof BranchManagerError)
      assert.equal(err.status, 404)
      return true
    },
  )
})
