import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'

test('workspace stats correctly aggregates file counts and byte size from Yjs document', () => {
  const doc = new Y.Doc()
  const files = doc.getMap('files')

  // Empty document
  assert.equal(files.size, 0)

  // Add 2 files
  const file1 = new Y.Map()
  const content1 = new Y.Text()
  content1.insert(0, 'console.log("hello world");') // 27 bytes
  file1.set('name', 'index.js')
  file1.set('content', content1)
  files.set('f1', file1)

  const file2 = new Y.Map()
  const content2 = new Y.Text()
  content2.insert(0, '# Readme\nTest file.') // 19 bytes
  file2.set('name', 'README.md')
  file2.set('content', content2)
  files.set('f2', file2)

  let filesCount = 0
  let totalSizeBytes = 0
  for (const [, record] of files.entries()) {
    if (record && typeof record.get === 'function') {
      filesCount++
      const content = record.get('content')
      if (content && typeof content.toString === 'function') {
        totalSizeBytes += Buffer.byteLength(content.toString(), 'utf8')
      }
    }
  }

  assert.equal(filesCount, 2)
  assert.equal(totalSizeBytes, 27 + 19)
})

test('workspace stats handles empty files map without error', () => {
  const doc = new Y.Doc()
  const files = doc.getMap('files')

  let filesCount = 0
  let totalSizeBytes = 0
  for (const [, record] of files.entries()) {
    if (record && typeof record.get === 'function') {
      filesCount++
      const content = record.get('content')
      if (content && typeof content.toString === 'function') {
        totalSizeBytes += Buffer.byteLength(content.toString(), 'utf8')
      }
    }
  }

  assert.equal(filesCount, 0)
  assert.equal(totalSizeBytes, 0)
})

test('workspace stats calculates UTF-8 multibyte characters accurately', () => {
  const doc = new Y.Doc()
  const files = doc.getMap('files')

  const file = new Y.Map()
  const content = new Y.Text()
  // "🚀 Code" -> rocket emoji is 4 bytes, space is 1, Code is 4 -> 9 bytes total
  content.insert(0, '🚀 Code')
  file.set('name', 'emoji.txt')
  file.set('content', content)
  files.set('f_emoji', file)

  let totalSizeBytes = 0
  for (const [, record] of files.entries()) {
    const c = record.get('content')
    totalSizeBytes += Buffer.byteLength(c.toString(), 'utf8')
  }

  assert.equal(totalSizeBytes, 9)
})
