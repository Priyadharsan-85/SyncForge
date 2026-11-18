/**
 * Additional edge-case tests for workspace sync (branch to live document).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'
import { applyTreeToLiveDocument, WorkspaceSyncError } from '../src/workspaceSync.js'

function makeDoc(files = {}) {
  const doc = new Y.Doc()
  const filesMap = doc.getMap('files')
  for (const [name, content] of Object.entries(files)) {
    const record = new Y.Map()
    const ytext = new Y.Text()
    if (content) ytext.insert(0, content)
    record.set('name', name)
    record.set('content', ytext)
    filesMap.set(name, record)
  }
  return doc
}

test('applyTreeToLiveDocument throws for null doc', () => {
  assert.throws(
    () => applyTreeToLiveDocument(null, {}),
    WorkspaceSyncError,
  )
})

test('applyTreeToLiveDocument throws for null tree', () => {
  const doc = makeDoc()
  assert.throws(
    () => applyTreeToLiveDocument(doc, null),
    WorkspaceSyncError,
  )
})

test('applyTreeToLiveDocument adds new files to an empty workspace', () => {
  const doc = makeDoc()
  const result = applyTreeToLiveDocument(doc, {
    'index.js': 'const x = 1',
    'style.css': 'body { margin: 0 }',
  })
  assert.deepEqual(result.added.sort(), ['index.js', 'style.css'])
  assert.deepEqual(result.updated, [])
  assert.deepEqual(result.removed, [])
})

test('applyTreeToLiveDocument updates existing file content', () => {
  const doc = makeDoc({ 'index.js': 'original content' })
  const result = applyTreeToLiveDocument(doc, { 'index.js': 'updated content' })
  assert.deepEqual(result.updated, ['index.js'])
  assert.deepEqual(result.added, [])

  const filesMap = doc.getMap('files')
  const record = filesMap.get('index.js')
  assert.equal(record?.get('content')?.toString(), 'updated content')
})

test('applyTreeToLiveDocument skips files with no content change', () => {
  const doc = makeDoc({ 'readme.md': '# Same' })
  const result = applyTreeToLiveDocument(doc, { 'readme.md': '# Same' })
  assert.deepEqual(result.updated, [])
  assert.deepEqual(result.added, [])
  assert.deepEqual(result.removed, [])
})

test('applyTreeToLiveDocument removes files not in the snapshot', () => {
  const doc = makeDoc({
    'keep.js': 'keep this',
    'delete.js': 'delete this',
  })
  const result = applyTreeToLiveDocument(doc, { 'keep.js': 'keep this' })
  assert.deepEqual(result.removed, ['delete.js'])
  assert.deepEqual(result.added, [])

  const filesMap = doc.getMap('files')
  assert.equal(filesMap.has('delete.js'), false)
  assert.equal(filesMap.has('keep.js'), true)
})

test('applyTreeToLiveDocument handles empty snapshot (removes all files)', () => {
  const doc = makeDoc({ 'a.js': 'content', 'b.js': 'content' })
  const result = applyTreeToLiveDocument(doc, {})
  assert.equal(result.removed.length, 2)
  assert.equal(doc.getMap('files').size, 0)
})

test('applyTreeToLiveDocument correctly handles mixed add/update/remove', () => {
  const doc = makeDoc({
    'keep.js': 'keep',
    'update.js': 'old content',
    'remove.js': 'will be removed',
  })
  const result = applyTreeToLiveDocument(doc, {
    'keep.js': 'keep',
    'update.js': 'new content',
    'new.js': 'brand new',
  })

  assert.deepEqual(result.added, ['new.js'])
  assert.deepEqual(result.updated, ['update.js'])
  assert.deepEqual(result.removed, ['remove.js'])
})
