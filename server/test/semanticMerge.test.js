import assert from 'node:assert/strict'
import test from 'node:test'
import { threeWayMerge } from '../src/semanticMerge.js'

test('threeWayMerge applies proposal cleanly when live document has not changed', () => {
  const base = 'function add(a, b) {\n  return a + b\n}'
  const live = base
  const proposal = 'function add(a, b) {\n  // Add two numbers\n  return a + b\n}'

  const result = threeWayMerge(base, live, proposal)
  assert.equal(result.status, 'clean')
  assert.equal(result.hasConflict, false)
  assert.equal(result.mergedText, proposal)
  assert.equal(result.conflicts.length, 0)
})

test('threeWayMerge returns live if proposal matches live', () => {
  const base = 'line 1'
  const live = 'line 1 updated'
  const proposal = 'line 1 updated'

  const result = threeWayMerge(base, live, proposal)
  assert.equal(result.status, 'clean')
  assert.equal(result.hasConflict, false)
  assert.equal(result.mergedText, live)
})

test('threeWayMerge auto-merges non-overlapping concurrent edits', () => {
  const base = [
    '// Header',
    'function top() {',
    '  return 1',
    '}',
    '',
    'function bottom() {',
    '  return 2',
    '}',
  ].join('\n')

  // Collaborator edits top function live
  const live = [
    '// Header - modified live',
    'function top() {',
    '  return 100',
    '}',
    '',
    'function bottom() {',
    '  return 2',
    '}',
  ].join('\n')

  // AI proposal edits bottom function
  const proposal = [
    '// Header',
    'function top() {',
    '  return 1',
    '}',
    '',
    'function bottom() {',
    '  // bottom comment added by AI',
    '  return 200',
    '}',
  ].join('\n')

  const result = threeWayMerge(base, live, proposal)
  assert.equal(result.status, 'auto_merged')
  assert.equal(result.hasConflict, false)
  assert.ok(result.mergedText.includes('// Header - modified live'))
  assert.ok(result.mergedText.includes('return 100'))
  assert.ok(result.mergedText.includes('// bottom comment added by AI'))
  assert.ok(result.mergedText.includes('return 200'))
})

test('threeWayMerge detects semantic conflicts when live and proposal edit the same line', () => {
  const base = 'const API_URL = "http://localhost:3000"'
  // Live user changed URL to staging
  const live = 'const API_URL = "https://staging.syncforge.dev"'
  // AI proposed changing URL to production
  const proposal = 'const API_URL = "https://api.syncforge.dev"'

  const result = threeWayMerge(base, live, proposal)
  assert.equal(result.status, 'conflict')
  assert.equal(result.hasConflict, true)
  assert.equal(result.conflicts.length, 1)

  assert.ok(result.mergedText.includes('<<<<<<< LIVE (CURRENT WORKSPACE)'))
  assert.ok(result.mergedText.includes('https://staging.syncforge.dev'))
  assert.ok(result.mergedText.includes('======='))
  assert.ok(result.mergedText.includes('https://api.syncforge.dev'))
  assert.ok(result.mergedText.includes('>>>>>>> AI PROPOSAL'))
})
