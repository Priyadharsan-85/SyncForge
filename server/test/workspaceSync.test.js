import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'
import {
  createBranch,
  createCommit,
  initWorkspaceBranches,
} from '../src/branchManager.js'
import {
  applyTreeToLiveDocument,
  syncBranchToLiveWorkspace,
} from '../src/workspaceSync.js'

test('applyTreeToLiveDocument updates existing files, creates new files, and deletes removed files', () => {
  const doc = new Y.Doc()
  const filesMap = doc.getMap('files')

  // Set up existing file in live doc
  const initialRecord = new Y.Map()
  const initialContent = new Y.Text()
  initialContent.insert(0, 'console.log("v1")')
  initialRecord.set('name', 'main.js')
  initialRecord.set('content', initialContent)
  filesMap.set('main.js', initialRecord)

  // Obsolete file that should be removed
  const deadRecord = new Y.Map()
  deadRecord.set('name', 'dead.js')
  deadRecord.set('content', new Y.Text())
  filesMap.set('dead.js', deadRecord)

  const newTree = {
    'main.js': 'console.log("v2 - updated")',
    'helper.js': 'export const help = true',
  }

  const result = applyTreeToLiveDocument(doc, newTree)
  assert.deepEqual(result.updated, ['main.js'])
  assert.deepEqual(result.added, ['helper.js'])
  assert.deepEqual(result.removed, ['dead.js'])

  const mainRecord = filesMap.get('main.js')
  assert.equal(mainRecord.get('content').toString(), 'console.log("v2 - updated")')

  const helperRecord = filesMap.get('helper.js')
  assert.equal(helperRecord.get('content').toString(), 'export const help = true')

  assert.equal(filesMap.has('dead.js'), false)
})

test('syncBranchToLiveWorkspace applies latest commit tree from branch', async () => {
  const roomId = 'room-sync-test-1'
  const user = { id: 'u1', name: 'SyncTester', login: 'synctester' }
  const doc = new Y.Doc()

  await initWorkspaceBranches(null, roomId, user, { 'index.js': 'initial' })
  await createBranch(null, {
    roomId,
    branchName: 'feature/new-feature',
    fromBranch: 'main',
    user,
  })

  // Commit on feature branch
  await createCommit(null, {
    roomId,
    branchName: 'feature/new-feature',
    message: 'Add feature file',
    author: user,
    tree: { 'index.js': 'initial', 'feature.js': 'feature code' },
  })

  // Live doc is still empty or initial
  const syncResult = await syncBranchToLiveWorkspace(null, {
    roomId,
    branchName: 'feature/new-feature',
    doc,
  })

  assert.equal(syncResult.branchName, 'feature/new-feature')
  assert.ok(syncResult.added.includes('feature.js'))
  assert.equal(doc.getMap('files').get('feature.js').get('content').toString(), 'feature code')
})
