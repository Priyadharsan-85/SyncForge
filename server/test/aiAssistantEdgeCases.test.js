/**
 * Additional edge-case tests for AI assistant draft generation and prompt handling.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AiAssistantError,
  checksum,
  createDraftPatch,
  discardDraftPatch,
  generateProposedCode,
  getDraftPatch,
  listUserDrafts,
} from '../src/aiAssistant.js'

const user = { id: 'ai-edge-user', login: 'aiedgeuser', name: 'AI Edge User' }
const roomId = 'testroomedgeai'

// ── checksum ─────────────────────────────────────────────────────────────────

test('checksum produces deterministic SHA-256 hex', () => {
  const a = checksum('hello world')
  const b = checksum('hello world')
  assert.equal(a, b)
  assert.equal(a.length, 64)
})

test('checksum handles empty string', () => {
  const c = checksum('')
  assert.equal(typeof c, 'string')
  assert.equal(c.length, 64)
})

test('checksum handles undefined gracefully', () => {
  const c = checksum(undefined)
  assert.equal(typeof c, 'string')
  assert.ok(c.length > 0)
})

// ── generateProposedCode ─────────────────────────────────────────────────────

test('generateProposedCode doc action adds JSDoc to functions', () => {
  const code = 'function add(a, b) {\n  return a + b\n}'
  const result = generateProposedCode(code, 'math.js', 'doc', '')
  assert.ok(result.includes('@param'))
  assert.ok(result.includes('@returns'))
  assert.ok(result.includes('function add'))
})

test('generateProposedCode fix action adds defensive checks', () => {
  const code = 'function validate(input) {\n  return input.trim()\n}'
  const result = generateProposedCode(code, 'validate.js', 'fix', '')
  assert.ok(result.includes('Defensive check'))
})

test('generateProposedCode refactor action modernizes var declarations', () => {
  const code = 'var x = 1\nvar y = 2'
  const result = generateProposedCode(code, 'old.js', 'refactor', '')
  assert.ok(result.includes('const x'))
  assert.ok(result.includes('const y'))
  assert.ok(result.includes("'use strict'"))
})

test('generateProposedCode test action generates test scaffold', () => {
  const code = 'function foo() {}\nfunction bar() {}'
  const result = generateProposedCode(code, 'lib.js', 'test', '')
  assert.ok(result.includes("test('foo"))
  assert.ok(result.includes("test('bar"))
  assert.ok(result.includes("import test from"))
})

test('generateProposedCode custom action prepends prompt comment', () => {
  const code = 'const x = 1'
  const result = generateProposedCode(code, 'x.js', 'custom', 'Optimize performance')
  assert.ok(result.includes('// AI proposal: Optimize performance'))
})

test('generateProposedCode returns code unchanged for empty custom prompt', () => {
  const code = 'const x = 1'
  const result = generateProposedCode(code, 'x.js', 'custom', '')
  assert.equal(result, code)
})

// ── createDraftPatch validation ───────────────────────────────────────────────

test('createDraftPatch throws when roomId is missing', () => {
  assert.throws(
    () => createDraftPatch({ roomId: '', user, fileId: 'f1', fileName: 'x.js', baseContent: '' }),
    AiAssistantError,
  )
})

test('createDraftPatch throws when user is not provided', () => {
  assert.throws(
    () => createDraftPatch({ roomId, user: null, fileId: 'f1', fileName: 'x.js', baseContent: '' }),
    AiAssistantError,
  )
})

test('createDraftPatch throws when fileName is missing', () => {
  assert.throws(
    () => createDraftPatch({ roomId, user, fileId: 'f1', fileName: '', baseContent: '' }),
    AiAssistantError,
  )
})

test('createDraftPatch uses customProposedCode when provided', () => {
  const draft = createDraftPatch({
    roomId,
    user,
    fileId: 'f1',
    fileName: 'custom.js',
    baseContent: 'original',
    customProposedCode: 'custom output',
  })
  assert.equal(draft.proposedContent, 'custom output')
})

// ── draft lifecycle ───────────────────────────────────────────────────────────

test('getDraftPatch returns null for unknown draftId', () => {
  assert.equal(getDraftPatch('nonexistent-draft-id'), null)
})

test('listUserDrafts only returns drafts for the specified room and user', () => {
  const draft1 = createDraftPatch({
    roomId: 'room-a',
    user: { id: 'user-1', login: 'u1', name: 'User 1' },
    fileId: 'f1',
    fileName: 'a.js',
    baseContent: 'code a',
  })
  const draft2 = createDraftPatch({
    roomId: 'room-a',
    user: { id: 'user-2', login: 'u2', name: 'User 2' },
    fileId: 'f2',
    fileName: 'b.js',
    baseContent: 'code b',
  })

  const user1Drafts = listUserDrafts('room-a', 'user-1')
  assert.ok(user1Drafts.some((d) => d.draftId === draft1.draftId))
  assert.ok(!user1Drafts.some((d) => d.draftId === draft2.draftId))

  discardDraftPatch(draft1.draftId)
  discardDraftPatch(draft2.draftId)
})

test('discardDraftPatch returns true for existing draft and false for unknown', () => {
  const draft = createDraftPatch({
    roomId,
    user,
    fileId: 'f99',
    fileName: 'z.js',
    baseContent: '',
  })
  assert.equal(discardDraftPatch(draft.draftId), true)
  assert.equal(discardDraftPatch(draft.draftId), false)
})
