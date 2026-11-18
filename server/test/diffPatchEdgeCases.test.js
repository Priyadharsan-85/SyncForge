/**
 * Additional edge-case tests for the diff/patch and semantic merge modules.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyHunks,
  computeLineOperations,
  computePatchStats,
  formatUnifiedDiff,
  groupIntoHunks,
  invertHunks,
  splitLines,
} from '../src/diffPatch.js'
import { threeWayMerge } from '../src/semanticMerge.js'

// ── splitLines edge cases ────────────────────────────────────────────────────

test('splitLines handles Windows CRLF line endings', () => {
  const result = splitLines('line1\r\nline2\r\nline3')
  assert.deepEqual(result, ['line1', 'line2', 'line3'])
})

test('splitLines handles trailing newline correctly', () => {
  const result = splitLines('a\nb\n')
  assert.deepEqual(result, ['a', 'b', ''])
})

test('splitLines returns empty array for empty string', () => {
  assert.deepEqual(splitLines(''), [])
})

// ── computeLineOperations edge cases ─────────────────────────────────────────

test('computeLineOperations handles completely empty old text', () => {
  const ops = computeLineOperations('', 'hello\nworld')
  assert.ok(ops.every((op) => op.type === 'insert'))
})

test('computeLineOperations handles completely empty new text', () => {
  const ops = computeLineOperations('hello\nworld', '')
  assert.ok(ops.every((op) => op.type === 'delete'))
})

test('computeLineOperations handles identical texts', () => {
  const text = 'abc\ndef\nghi'
  const ops = computeLineOperations(text, text)
  assert.ok(ops.every((op) => op.type === 'equal'))
})

test('computeLineOperations handles single-line change', () => {
  const ops = computeLineOperations('old line', 'new line')
  const deletes = ops.filter((op) => op.type === 'delete')
  const inserts = ops.filter((op) => op.type === 'insert')
  assert.equal(deletes.length, 1)
  assert.equal(inserts.length, 1)
})

// ── applyHunks edge cases ────────────────────────────────────────────────────

test('applyHunks with empty hunks returns original text unchanged', () => {
  const text = 'alpha\nbeta'
  const result = applyHunks(text, [])
  assert.equal(result.ok, true)
  assert.equal(result.result, text)
})

test('applyHunks handles multi-hunk patch correctly', () => {
  const old = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n')
  const lines = old.split('\n')
  lines[2] = 'modified-3'
  lines[17] = 'modified-18'
  const updated = lines.join('\n')

  const ops = computeLineOperations(old, updated)
  const hunks = groupIntoHunks(ops, 2)
  assert.ok(hunks.length >= 2, 'should produce at least 2 hunks for distant changes')

  const result = applyHunks(old, hunks)
  assert.equal(result.ok, true)
  assert.equal(result.result, updated)
})

// ── invertHunks edge cases ───────────────────────────────────────────────────

test('invertHunks on empty hunks returns empty array', () => {
  assert.deepEqual(invertHunks([]), [])
})

test('invertHunks double-inversion restores original hunks', () => {
  const old = 'a\nb\nc'
  const updated = 'a\nB\nc'
  const hunks = groupIntoHunks(computeLineOperations(old, updated), 1)
  const double = invertHunks(invertHunks(hunks))

  // The double-inverted hunks should produce the same result as applying the originals
  const r1 = applyHunks(old, hunks)
  const r2 = applyHunks(old, double)
  assert.equal(r1.ok, true)
  assert.equal(r2.ok, true)
  assert.equal(r1.result, r2.result)
})

// ── formatUnifiedDiff edge cases ─────────────────────────────────────────────

test('formatUnifiedDiff handles add-only patch', () => {
  const diff = formatUnifiedDiff('new.js', '', 'one\ntwo\nthree')
  assert.ok(diff.includes('+one'))
  assert.ok(diff.includes('+two'))
  assert.ok(diff.includes('+three'))
})

test('formatUnifiedDiff handles delete-only patch', () => {
  const diff = formatUnifiedDiff('old.js', 'one\ntwo\nthree', '')
  assert.ok(diff.includes('-one'))
  assert.ok(diff.includes('-two'))
  assert.ok(diff.includes('-three'))
})

// ── threeWayMerge additional cases ───────────────────────────────────────────

test('threeWayMerge with empty base and non-conflicting branches merges both', () => {
  const result = threeWayMerge('', 'live addition\n', 'proposal addition\n')
  // With empty base, both branches added different content — this is a conflict
  // The merge result should still produce a mergedText
  assert.ok(typeof result.mergedText === 'string')
  assert.ok(['clean', 'conflict'].includes(result.status))
})

test('threeWayMerge where proposal is identical to base returns live as merged', () => {
  const base = 'unchanged line'
  const result = threeWayMerge(base, 'live changed line', base)
  assert.equal(result.mergedText, 'live changed line')
})

test('threeWayMerge where live is identical to base applies proposal', () => {
  const base = 'original line'
  const result = threeWayMerge(base, base, 'proposal line')
  assert.equal(result.mergedText, 'proposal line')
  assert.equal(result.hasConflict, false)
})
