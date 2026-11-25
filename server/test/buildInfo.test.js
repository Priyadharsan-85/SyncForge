import assert from 'node:assert/strict'
import test from 'node:test'
import { getBuildInfo, resolveCommit, resolveFeatures } from '../src/buildInfo.js'

const MANAGED_ENV_KEYS = [
  'GIT_COMMIT',
  'GIT_SHA',
  'SOURCE_COMMIT',
  'GITHUB_SHA',
  'RENDER_GIT_COMMIT',
  'VERCEL_GIT_COMMIT_SHA',
  'FLY_IMAGE_REF',
  'REDIS_URL',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'SESSION_SECRET',
  'METRICS_TOKEN',
  'NODE_ENV',
]

/** Run `body` with the given env overlay, restoring every managed key after. */
function withEnv(overlay, body) {
  const saved = new Map(MANAGED_ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of MANAGED_ENV_KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(overlay)) process.env[key] = value
  try {
    return body()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

// ── resolveCommit ───────────────────────────────────────────────────────────

test('resolveCommit returns "unknown" when no provider variable is set', () => {
  withEnv({}, () => assert.equal(resolveCommit(), 'unknown'))
})

test('resolveCommit reads each supported provider variable', () => {
  for (const key of [
    'GIT_COMMIT',
    'GIT_SHA',
    'SOURCE_COMMIT',
    'GITHUB_SHA',
    'RENDER_GIT_COMMIT',
    'VERCEL_GIT_COMMIT_SHA',
    'FLY_IMAGE_REF',
  ]) {
    withEnv({ [key]: 'deadbeef' }, () => {
      assert.equal(resolveCommit(), 'deadbeef', `${key} was not read`)
    })
  }
})

test('resolveCommit prefers GIT_COMMIT when several variables are set', () => {
  withEnv({ GIT_COMMIT: 'first', GITHUB_SHA: 'second', SOURCE_COMMIT: 'third' }, () => {
    assert.equal(resolveCommit(), 'first')
  })
})

test('resolveCommit skips blank and whitespace-only values', () => {
  withEnv({ GIT_COMMIT: '   ', GITHUB_SHA: 'realsha' }, () => {
    assert.equal(resolveCommit(), 'realsha')
  })
  withEnv({ GIT_COMMIT: '' }, () => assert.equal(resolveCommit(), 'unknown'))
})

test('resolveCommit trims surrounding whitespace', () => {
  withEnv({ GIT_COMMIT: '  abc123\n' }, () => assert.equal(resolveCommit(), 'abc123'))
})

// ── resolveFeatures ─────────────────────────────────────────────────────────

test('resolveFeatures reports every subsystem as false when nothing is configured', () => {
  withEnv({}, () => {
    assert.deepEqual(resolveFeatures(), {
      redisPersistence: false,
      githubOAuth: false,
      sessionSigning: false,
      metricsAuth: false,
    })
  })
})

test('resolveFeatures reports each subsystem as true once configured', () => {
  withEnv(
    {
      REDIS_URL: 'redis://localhost:6379',
      GITHUB_CLIENT_ID: 'client-id',
      GITHUB_CLIENT_SECRET: 'client-secret',
      SESSION_SECRET: 'x'.repeat(64),
      METRICS_TOKEN: 'scrape-token',
    },
    () => {
      assert.deepEqual(resolveFeatures(), {
        redisPersistence: true,
        githubOAuth: true,
        sessionSigning: true,
        metricsAuth: true,
      })
    },
  )
})

test('githubOAuth stays false when only one half of the credential pair is set', () => {
  withEnv({ GITHUB_CLIENT_ID: 'client-id' }, () => {
    assert.equal(resolveFeatures().githubOAuth, false)
  })
  withEnv({ GITHUB_CLIENT_SECRET: 'client-secret' }, () => {
    assert.equal(resolveFeatures().githubOAuth, false)
  })
})

test('sessionSigning stays false for a secret shorter than 32 characters', () => {
  withEnv({ SESSION_SECRET: 'x'.repeat(31) }, () => {
    assert.equal(resolveFeatures().sessionSigning, false)
  })
  withEnv({ SESSION_SECRET: 'x'.repeat(32) }, () => {
    assert.equal(resolveFeatures().sessionSigning, true)
  })
})

test('resolveFeatures returns only booleans, never a configured value', () => {
  withEnv(
    {
      REDIS_URL: 'redis://admin:hunter2@10.0.0.4:6379',
      GITHUB_CLIENT_ID: 'Iv1.secretclientid',
      GITHUB_CLIENT_SECRET: 'ghs_supersecret',
      SESSION_SECRET: 'session-secret-value-that-is-long-enough',
      METRICS_TOKEN: 'metrics-bearer-token',
    },
    () => {
      const features = resolveFeatures()
      for (const value of Object.values(features)) {
        assert.equal(typeof value, 'boolean')
      }
      const serialized = JSON.stringify(features)
      for (const secret of [
        'hunter2',
        '10.0.0.4',
        'Iv1.secretclientid',
        'ghs_supersecret',
        'session-secret-value-that-is-long-enough',
        'metrics-bearer-token',
      ]) {
        assert.ok(!serialized.includes(secret), `features leaked ${secret}`)
      }
    },
  )
})

// ── getBuildInfo ────────────────────────────────────────────────────────────

test('getBuildInfo reports the full identity payload', () => {
  const info = getBuildInfo()
  assert.equal(info.name, 'syncforge')
  assert.match(info.version, /^\d+\.\d+\.\d+/)
  assert.equal(info.node, process.version)
  assert.equal(info.platform, `${process.platform}-${process.arch}`)
  assert.equal(typeof info.commit, 'string')
  assert.equal(typeof info.features, 'object')
})

test('getBuildInfo defaults the environment to development', () => {
  withEnv({}, () => assert.equal(getBuildInfo().environment, 'development'))
  withEnv({ NODE_ENV: 'production' }, () => assert.equal(getBuildInfo().environment, 'production'))
})

test('getBuildInfo reports a parseable startedAt and a non-negative uptime', () => {
  const info = getBuildInfo()
  assert.ok(!Number.isNaN(Date.parse(info.startedAt)))
  assert.ok(Number.isInteger(info.uptimeSeconds))
  assert.ok(info.uptimeSeconds >= 0)
})

test('getBuildInfo reports a stable startedAt across calls', () => {
  assert.equal(getBuildInfo().startedAt, getBuildInfo().startedAt)
})

test('getBuildInfo payload is JSON-serializable and free of secret values', () => {
  withEnv(
    {
      GIT_COMMIT: 'abc1234',
      REDIS_URL: 'redis://admin:hunter2@10.0.0.4:6379',
      SESSION_SECRET: 'x'.repeat(64),
      METRICS_TOKEN: 'metrics-bearer-token',
    },
    () => {
      const serialized = JSON.stringify(getBuildInfo())
      assert.deepEqual(JSON.parse(serialized).commit, 'abc1234')
      assert.ok(!serialized.includes('hunter2'))
      assert.ok(!serialized.includes('metrics-bearer-token'))
      assert.ok(!serialized.includes('x'.repeat(64)))
    },
  )
})
