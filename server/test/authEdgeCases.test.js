/**
 * Additional edge-case tests for the auth module.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSessionToken,
  matchesSecret,
  readCookie,
  safeReturnPath,
  verifySessionToken,
} from '../src/auth.js'

const secret = 'test-session-secret-with-sufficient-length'
const user = { id: '42', login: 'testuser', name: 'Test User' }

test('verifySessionToken returns null for missing token', () => {
  assert.equal(verifySessionToken(undefined, secret), null)
  assert.equal(verifySessionToken(null, secret), null)
  assert.equal(verifySessionToken('', secret), null)
})

test('verifySessionToken returns null when secret is missing', () => {
  const token = createSessionToken(user, secret)
  assert.equal(verifySessionToken(token, ''), null)
  assert.equal(verifySessionToken(token, undefined), null)
})

test('verifySessionToken returns null for a token with extra segments', () => {
  const token = createSessionToken(user, secret)
  assert.equal(verifySessionToken(`${token}.extra`, secret), null)
})

test('verifySessionToken returns null for a token with no separator', () => {
  assert.equal(verifySessionToken('noseparatortoken', secret), null)
})

test('createSessionToken encodes the correct user fields', () => {
  const now = Date.now()
  const token = createSessionToken(user, secret, now)
  const verified = verifySessionToken(token, secret, now)
  assert.equal(verified.id, user.id)
  assert.equal(verified.login, user.login)
  assert.equal(verified.name, user.name)
})

test('readCookie handles empty cookie header', () => {
  assert.equal(readCookie('', 'syncforge_session'), undefined)
})

test('readCookie handles cookie with no value', () => {
  const result = readCookie('key=', 'key')
  assert.equal(result, '')
})

test('readCookie handles multiple cookies with the same prefix', () => {
  const val = readCookie('syncforge_session_v2=old; syncforge_session=correct', 'syncforge_session')
  assert.equal(val, 'correct')
})

test('safeReturnPath rejects paths exceeding 2048 chars', () => {
  const longPath = `/${'x'.repeat(2_050)}`
  assert.equal(safeReturnPath(longPath), '/')
})

test('safeReturnPath accepts complex query strings', () => {
  const path = '/workspace?room=abc123&invite=xyz456'
  assert.equal(safeReturnPath(path), path)
})

test('safeReturnPath rejects non-string inputs', () => {
  assert.equal(safeReturnPath(42), '/')
  assert.equal(safeReturnPath(null), '/')
  assert.equal(safeReturnPath({}), '/')
})

test('matchesSecret rejects when either argument is not a string', () => {
  assert.equal(matchesSecret(null, 'value'), false)
  assert.equal(matchesSecret('value', null), false)
  assert.equal(matchesSecret(undefined, undefined), false)
})

test('matchesSecret rejects strings of different lengths', () => {
  assert.equal(matchesSecret('short', 'much-longer-string'), false)
})
