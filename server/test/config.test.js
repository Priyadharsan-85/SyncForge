import assert from 'node:assert/strict'
import test from 'node:test'
import { assertValidConfig, configProblems, loadConfig } from '../src/config.js'

const productionEnv = {
  NODE_ENV: 'production',
  CLIENT_ORIGIN: 'https://syncforge.example.com/some/path',
  REDIS_URL: 'redis://redis:6379',
  SESSION_SECRET: 'x'.repeat(48),
  GITHUB_CLIENT_ID: 'id',
  GITHUB_CLIENT_SECRET: 'secret',
}

test('loadConfig applies development defaults', () => {
  const config = loadConfig({})
  assert.equal(config.production, false)
  assert.equal(config.port, 3001)
  assert.equal(config.clientOrigin, 'http://localhost:5173')
  assert.equal(config.redisUrl, undefined)
  assert.equal(config.redisCompactionThreshold, 500)
  assert.equal(config.githubCallbackUrl, 'http://localhost:5173/auth/github/callback')
  assert.deepEqual(configProblems(config), [])
})

test('loadConfig reduces CLIENT_ORIGIN to an origin', () => {
  const config = loadConfig(productionEnv)
  assert.equal(config.clientOrigin, 'https://syncforge.example.com')
  assert.equal(config.githubCallbackUrl, 'https://syncforge.example.com/auth/github/callback')
})

test('loadConfig falls back to RENDER_EXTERNAL_URL', () => {
  const config = loadConfig({ RENDER_EXTERNAL_URL: 'https://syncforge.onrender.com' })
  assert.equal(config.clientOrigin, 'https://syncforge.onrender.com')
})

test('explicit CLIENT_ORIGIN wins over RENDER_EXTERNAL_URL', () => {
  const config = loadConfig({
    CLIENT_ORIGIN: 'https://code.example.com',
    RENDER_EXTERNAL_URL: 'https://syncforge.onrender.com',
  })
  assert.equal(config.clientOrigin, 'https://code.example.com')
})

test('empty strings are treated as unset', () => {
  const config = loadConfig({ REDIS_URL: '', GITHUB_CALLBACK_URL: '  ', PORT: '' })
  assert.equal(config.redisUrl, undefined)
  assert.equal(config.port, 3001)
  assert.equal(config.githubCallbackUrl, 'http://localhost:5173/auth/github/callback')
})

test('an invalid CLIENT_ORIGIN fails with a readable message', () => {
  assert.throws(() => loadConfig({ CLIENT_ORIGIN: 'not a url' }), /CLIENT_ORIGIN must be an absolute URL/)
})

test('a complete production config is valid', () => {
  assert.doesNotThrow(() => assertValidConfig(loadConfig(productionEnv)))
})

test('production reports every missing requirement at once', () => {
  const problems = configProblems(loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short' }))
  assert.equal(problems.length, 3)
  assert.match(problems.join('\n'), /REDIS_URL/)
  assert.match(problems.join('\n'), /GITHUB_CLIENT_ID/)
  assert.match(problems.join('\n'), /SESSION_SECRET/)
})

test('assertValidConfig lists problems in the thrown error', () => {
  assert.throws(
    () => assertValidConfig(loadConfig({ ...productionEnv, REDIS_URL: '' })),
    /Invalid configuration:\n {2}- REDIS_URL is required/,
  )
})

test('rejects out-of-range ports and bad compaction thresholds', () => {
  assert.match(configProblems(loadConfig({ PORT: '70000' })).join(), /PORT/)
  assert.match(configProblems(loadConfig({ PORT: 'abc' })).join(), /PORT/)
  assert.match(
    configProblems(loadConfig({ REDIS_URL: 'redis://x', REDIS_COMPACTION_THRESHOLD: '0' })).join(),
    /REDIS_COMPACTION_THRESHOLD/,
  )
  // The threshold only matters when Redis is in use.
  assert.deepEqual(configProblems(loadConfig({ REDIS_COMPACTION_THRESHOLD: '0' })), [])
})
