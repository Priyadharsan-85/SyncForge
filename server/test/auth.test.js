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
const user = { id: '12345', login: 'octocat', name: 'Octo Cat' }

test('session tokens authenticate the encoded user and expire', () => {
  const now = 1_800_000_000_000
  const token = createSessionToken(user, secret, now)
  assert.deepEqual(verifySessionToken(token, secret, now), user)
  assert.equal(verifySessionToken(token, secret, now + 8 * 24 * 60 * 60 * 1000), null)
})

test('session tokens reject tampering and wrong secrets', () => {
  const token = createSessionToken(user, secret)
  assert.equal(verifySessionToken(`${token}x`, secret), null)
  assert.equal(verifySessionToken(token, 'another-secret'), null)
})

test('cookie parsing does not confuse similarly named cookies', () => {
  assert.equal(
    readCookie('other=x; syncforge_session=abc.def; syncforge_session_old=no', 'syncforge_session'),
    'abc.def',
  )
  assert.equal(readCookie(undefined, 'syncforge_session'), undefined)
})

test('OAuth return paths are restricted to the same origin', () => {
  assert.equal(safeReturnPath('/?room=team-room'), '/?room=team-room')
  assert.equal(safeReturnPath('//attacker.example'), '/')
  assert.equal(safeReturnPath('https://attacker.example'), '/')
  assert.equal(safeReturnPath('/\\attacker.example'), '/')
  assert.equal(safeReturnPath(`/${'a'.repeat(2_048)}`), '/')
})

test('OAuth state comparison requires an exact match', () => {
  assert.equal(matchesSecret('random-state', 'random-state'), true)
  assert.equal(matchesSecret('random-state', 'other-state'), false)
  assert.equal(matchesSecret(undefined, 'random-state'), false)
})
