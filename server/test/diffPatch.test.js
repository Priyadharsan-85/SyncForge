import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeLineOperations,
  formatUnifiedDiff,
  groupIntoHunks,
  splitLines,
} from '../src/diffPatch.js'

test('splitLines handles empty string, single line, and multiple newlines', () => {
  assert.deepEqual(splitLines(''), [])
  assert.deepEqual(splitLines('single'), ['single'])
  assert.deepEqual(splitLines('line1\nline2\r\nline3'), ['line1', 'line2', 'line3'])
})

test('computeLineOperations identifies additions, deletions, and unchanged lines', () => {
  const oldText = 'const a = 1\nconst b = 2\nconst c = 3'
  const newText = 'const a = 1\nconst b = 20\nconst c = 3\nconst d = 4'

  const ops = computeLineOperations(oldText, newText)
  assert.ok(ops.length > 0)

  const deletes = ops.filter((op) => op.type === 'delete')
  const inserts = ops.filter((op) => op.type === 'insert')
  const equals = ops.filter((op) => op.type === 'equal')

  assert.equal(deletes.length, 1)
  assert.equal(deletes[0].text, 'const b = 2')
  assert.equal(inserts.length, 2)
  assert.equal(inserts[0].text, 'const b = 20')
  assert.equal(inserts[1].text, 'const d = 4')
  assert.equal(equals.length, 2)
})

test('groupIntoHunks creates formatted hunks with context', () => {
  const oldText = ['1', '2', '3', '4', 'target_old', '5', '6', '7', '8'].join('\n')
  const newText = ['1', '2', '3', '4', 'target_new', '5', '6', '7', '8'].join('\n')

  const ops = computeLineOperations(oldText, newText)
  const hunks = groupIntoHunks(ops, 2)

  assert.equal(hunks.length, 1)
  const hunk = hunks[0]
  assert.equal(hunk.oldStart, 3)
  assert.equal(hunk.newStart, 3)
  assert.ok(hunk.lines.some((l) => l.type === 'delete' && l.text === 'target_old'))
  assert.ok(hunk.lines.some((l) => l.type === 'insert' && l.text === 'target_new'))
})

test('formatUnifiedDiff outputs valid unified diff format', () => {
  const oldText = 'hello\nworld'
  const newText = 'hello\nbrave\nnew\nworld'

  const diff = formatUnifiedDiff('index.js', oldText, newText)
  assert.ok(diff.startsWith('--- a/index.js\n+++ b/index.js\n'))
  assert.ok(diff.includes('@@ -1,2 +1,4 @@'))
  assert.ok(diff.includes('+brave'))
  assert.ok(diff.includes('+new'))
})

test('formatUnifiedDiff returns empty string if no changes', () => {
  const text = 'identical\ncode'
  assert.equal(formatUnifiedDiff('test.js', text, text), '')
})
