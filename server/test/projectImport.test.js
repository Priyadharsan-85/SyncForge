import assert from 'node:assert/strict'
import test from 'node:test'
import { createImportedDocument, validateImportedFiles } from '../src/projectImport.js'

test('import validation accepts nested UTF-8 text files and builds a Yjs document', () => {
  const files = [
    { path: 'src/index.ts', content: 'export const answer = 42' },
    { path: 'README.md', content: 'Hello, world!' },
  ]
  const doc = createImportedDocument(files)
  const imported = doc.getMap('files').get('src/index.ts')

  assert.equal(imported.get('name'), 'src/index.ts')
  assert.equal(imported.get('content').toString(), 'export const answer = 42')
  doc.destroy()
})

test('import validation rejects traversal, duplicate paths, and oversized files', () => {
  assert.throws(
    () => validateImportedFiles([{ path: '../secrets', content: 'no' }]),
    /unsafe file path/,
  )
  assert.throws(
    () => validateImportedFiles([
      { path: 'src/App.tsx', content: 'one' },
      { path: 'src/app.tsx', content: 'two' },
    ]),
    /duplicate file paths/,
  )
  assert.throws(
    () => validateImportedFiles([{ path: 'large.txt', content: 'x'.repeat(512 * 1024 + 1) }]),
    /512 KiB/,
  )
})
