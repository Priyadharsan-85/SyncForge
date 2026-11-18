/**
 * Edge-case tests for the validation and project import modules.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanDisplayName, isValidRoomId } from '../src/validation.js'
import { validateImportedFiles } from '../src/projectImport.js'

// ── isValidRoomId ─────────────────────────────────────────────────────────────

test('isValidRoomId accepts alphanumeric IDs', () => {
  assert.equal(isValidRoomId('abc123'), true)
  assert.equal(isValidRoomId('ROOM_ID-01'), true)
})

test('isValidRoomId accepts IDs at the length boundaries', () => {
  assert.equal(isValidRoomId('abc'), true)         // min 3
  assert.equal(isValidRoomId('a'.repeat(48)), true) // max 48
})

test('isValidRoomId rejects IDs that are too short or too long', () => {
  assert.equal(isValidRoomId('ab'), false)           // too short
  assert.equal(isValidRoomId('a'.repeat(49)), false) // too long
})

test('isValidRoomId rejects IDs with special characters', () => {
  assert.equal(isValidRoomId('room id'), false)   // space
  assert.equal(isValidRoomId('room.id'), false)   // dot
  assert.equal(isValidRoomId('room/id'), false)   // slash
  assert.equal(isValidRoomId(''), false)
})

test('isValidRoomId rejects non-string inputs', () => {
  assert.equal(isValidRoomId(123), false)
  assert.equal(isValidRoomId(null), false)
  assert.equal(isValidRoomId(undefined), false)
})

// ── cleanDisplayName ──────────────────────────────────────────────────────────

test('cleanDisplayName trims whitespace', () => {
  assert.equal(cleanDisplayName('  Alice  '), 'Alice')
})

test('cleanDisplayName truncates to 32 characters', () => {
  const long = 'A'.repeat(50)
  assert.equal(cleanDisplayName(long).length, 32)
})

test('cleanDisplayName returns empty string for non-string input', () => {
  assert.equal(cleanDisplayName(null), '')
  assert.equal(cleanDisplayName(undefined), '')
  assert.equal(cleanDisplayName(42), '')
})

// ── validateImportedFiles ─────────────────────────────────────────────────────

test('validateImportedFiles accepts an array of valid text files', () => {
  const files = [
    { path: 'src/index.js', content: 'console.log("hello")' },
    { path: 'README.md', content: '# Project' },
  ]
  const result = validateImportedFiles(files)
  assert.equal(result.length, 2)
})

test('validateImportedFiles throws for non-array input', () => {
  assert.throws(() => validateImportedFiles(null), (err) => err.status === 400)
  assert.throws(() => validateImportedFiles({}), (err) => err.status === 400)
  assert.throws(() => validateImportedFiles('string'), (err) => err.status === 400)
})

test('validateImportedFiles throws for empty file array', () => {
  assert.throws(() => validateImportedFiles([]), (err) => err.status === 400)
})

test('validateImportedFiles rejects path traversal attempts', () => {
  const files = [{ path: '../etc/passwd', content: 'malicious' }]
  assert.throws(() => validateImportedFiles(files), (err) => err.status === 400)
})

test('validateImportedFiles rejects duplicate file paths', () => {
  const files = [
    { path: 'index.js', content: 'a' },
    { path: 'index.js', content: 'b' },
  ]
  assert.throws(() => validateImportedFiles(files), (err) => err.status === 400)
})
