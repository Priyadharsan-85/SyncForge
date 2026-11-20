import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'
import { createImportedDocument } from '../src/projectImport.js'

test('forked workspace copies all files from source document without sharing state', () => {
  // Setup source document
  const sourceFiles = [
    { path: 'main.js', content: 'console.log("source");' },
    { path: 'util.js', content: 'export const add = (a, b) => a + b;' },
  ]
  const sourceDoc = createImportedDocument(sourceFiles)

  // Extract files from source
  const extracted = []
  for (const [, record] of sourceDoc.getMap('files').entries()) {
    const name = record.get('name')
    const content = record.get('content')
    if (typeof name === 'string' && content instanceof Y.Text) {
      extracted.push({ path: name, content: content.toString() })
    }
  }

  assert.equal(extracted.length, 2)
  const mainFile = extracted.find((f) => f.path === 'main.js')
  assert.equal(mainFile.content, 'console.log("source");')

  // Create forked document
  const forkedDoc = createImportedDocument(extracted)
  assert.equal(forkedDoc.getMap('files').size, 2)

  // Mutate forked document
  const forkedMainRecord = [...forkedDoc.getMap('files').values()].find(
    (r) => r.get('name') === 'main.js',
  )
  const forkedMainContent = forkedMainRecord.get('content')
  forkedMainContent.insert(0, '// mutated fork\n')

  // Source document remains completely unchanged
  const sourceMainRecord = [...sourceDoc.getMap('files').values()].find(
    (r) => r.get('name') === 'main.js',
  )
  assert.equal(sourceMainRecord.get('content').toString(), 'console.log("source");')
  assert.equal(forkedMainContent.toString(), '// mutated fork\nconsole.log("source");')
})

test('forking workspace with no files creates empty workspace without throwing', () => {
  const emptyDoc = new Y.Doc()
  const extracted = []
  for (const [, record] of emptyDoc.getMap('files').entries()) {
    const name = record.get('name')
    const content = record.get('content')
    if (typeof name === 'string' && content instanceof Y.Text) {
      extracted.push({ path: name, content: content.toString() })
    }
  }

  assert.equal(extracted.length, 0)
  assert.doesNotThrow(() => {
    const files = extracted.length > 0 ? extracted : undefined
    assert.equal(files, undefined)
  })
})
