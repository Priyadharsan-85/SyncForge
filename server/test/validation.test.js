import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanDisplayName, isValidRoomId } from '../src/validation.js'

test('room IDs accept bounded URL-safe characters', () => {
  assert.equal(isValidRoomId('team-room_7'), true)
  assert.equal(isValidRoomId('ab'), false)
  assert.equal(isValidRoomId('room id'), false)
  assert.equal(isValidRoomId('x'.repeat(49)), false)
  assert.equal(isValidRoomId(null), false)
})

test('display names are trimmed and bounded', () => {
  assert.equal(cleanDisplayName('  Alex  '), 'Alex')
  assert.equal(cleanDisplayName('x'.repeat(40)).length, 32)
  assert.equal(cleanDisplayName(undefined), '')
})
