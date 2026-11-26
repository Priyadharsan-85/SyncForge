/**
 * Build and runtime identity, served at `GET /api/version`.
 *
 * Answers the questions that come up first during an incident: which build
 * is actually running, how long has this process been up, and which
 * optional subsystems did it start with? Without this, confirming a deploy
 * landed means shelling into the container.
 *
 * Only booleans are reported for configuration, never values — the shape of
 * this payload is public.
 */

import { readFileSync } from 'node:fs'

/** Environment variables that CI providers use for the deployed commit SHA. */
const COMMIT_ENV_KEYS = [
  'GIT_COMMIT',
  'GIT_SHA',
  'SOURCE_COMMIT',
  'GITHUB_SHA',
  'RENDER_GIT_COMMIT',
  'VERCEL_GIT_COMMIT_SHA',
  'FLY_IMAGE_REF',
]

const startedAt = new Date()

function readPackageVersion() {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    )
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    // A trimmed container image may omit the manifest; identity is still
    // useful without it, so degrade rather than crash at startup.
    return '0.0.0'
  }
}

const version = readPackageVersion()

/**
 * The deployed commit SHA, from whichever provider variable is populated.
 *
 * @returns {string} Full or short SHA, or 'unknown'.
 */
export function resolveCommit() {
  for (const key of COMMIT_ENV_KEYS) {
    const value = process.env[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return 'unknown'
}

/**
 * Which optional subsystems this process was configured with. Presence
 * only — no secret is ever echoed back.
 *
 * @returns {Record<string, boolean>}
 */
export function resolveFeatures() {
  return {
    redisPersistence: Boolean(process.env.REDIS_URL),
    githubOAuth: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    sessionSigning: (process.env.SESSION_SECRET ?? '').length >= 32,
    metricsAuth: Boolean(process.env.METRICS_TOKEN),
    githubApiToken: Boolean(process.env.GITHUB_API_TOKEN?.trim()),
  }
}

/**
 * Full build-and-runtime snapshot.
 *
 * @returns {Record<string, unknown>}
 */
export function getBuildInfo() {
  return {
    name: 'syncforge',
    version,
    commit: resolveCommit(),
    environment: process.env.NODE_ENV ?? 'development',
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    features: resolveFeatures(),
  }
}
