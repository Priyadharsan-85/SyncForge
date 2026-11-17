import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkAiDraftRateLimit,
  checksum,
  createDraftPatch,
  discardDraftPatch,
  getDraftPatch,
  listUserDrafts,
  rebaseDraftPatch,
} from '../src/aiAssistant.js'

const testUser = {
  id: 'user-123',
  name: 'Taylor Swift',
  login: 'taylorswift',
}

test('createDraftPatch generates a private draft with diff and checksum', () => {
  const code = 'function multiply(x, y) {\n  return x * y\n}'
  const draft = createDraftPatch({
    roomId: 'room-abc',
    user: testUser,
    fileId: 'file-1',
    fileName: 'math.js',
    baseContent: code,
    prompt: 'Add documentation',
    actionType: 'doc',
  })

  assert.ok(draft.draftId)
  assert.equal(draft.roomId, 'room-abc')
  assert.equal(draft.author.id, 'user-123')
  assert.equal(draft.fileName, 'math.js')
  assert.equal(draft.baseChecksum, checksum(code))
  assert.ok(draft.diff.length > 0)
  assert.ok(draft.proposedContent.includes('/**'))
  assert.ok(draft.proposedContent.includes('@param {*} x'))
  assert.equal(draft.status, 'draft')
})

test('listUserDrafts returns only drafts belonging to user and room', () => {
  const code = 'const x = 1'
  const draft1 = createDraftPatch({
    roomId: 'room-xyz',
    user: testUser,
    fileId: 'f1',
    fileName: 'a.js',
    baseContent: code,
  })

  const otherUser = { id: 'other-999', name: 'Other', login: 'other' }
  createDraftPatch({
    roomId: 'room-xyz',
    user: otherUser,
    fileId: 'f2',
    fileName: 'b.js',
    baseContent: code,
  })

  const userDrafts = listUserDrafts('room-xyz', testUser.id)
  assert.equal(userDrafts.length, 1)
  assert.equal(userDrafts[0].draftId, draft1.draftId)
})

test('discardDraftPatch removes draft from memory', () => {
  const draft = createDraftPatch({
    roomId: 'room-temp',
    user: testUser,
    fileId: 'f-temp',
    fileName: 'temp.js',
    baseContent: 'let z = 1',
  })

  assert.ok(getDraftPatch(draft.draftId))
  const discarded = discardDraftPatch(draft.draftId)
  assert.equal(discarded, true)
  assert.equal(getDraftPatch(draft.draftId), null)
})

test('rebaseDraftPatch evaluates concurrent live changes against proposal', () => {
  const original = 'const timeout = 1000\nconst retries = 3'
  const draft = createDraftPatch({
    roomId: 'room-rebase',
    user: testUser,
    fileId: 'f-cfg',
    fileName: 'config.js',
    baseContent: original,
    actionType: 'refactor',
  })

  // Live workspace had non-conflicting change
  const liveNonConflicting = 'const timeout = 1000\nconst retries = 3\nconst debug = true'
  const cleanRebase = rebaseDraftPatch(draft.draftId, liveNonConflicting)
  assert.equal(cleanRebase.hasConflict, false)

  // Live workspace changed the exact line AI modified
  const liveConflicting = 'const timeout = 99999\nconst retries = 3'
  const conflictRebase = rebaseDraftPatch(draft.draftId, liveConflicting)
  assert.equal(conflictRebase.hasConflict, true)
  assert.ok(conflictRebase.conflicts.length > 0)
})

test('checkAiDraftRateLimit throttles excessive draft requests', async () => {
  const actor = 'rate-test-user'
  // Consume all up to limit
  let lastResult
  for (let i = 0; i < 30; i++) {
    lastResult = await checkAiDraftRateLimit(null, actor)
    assert.equal(lastResult.allowed, true)
  }
  // 31st request should be throttled
  const throttled = await checkAiDraftRateLimit(null, actor)
  assert.equal(throttled.allowed, false)
  assert.ok(throttled.retryAfterSeconds > 0)
})

