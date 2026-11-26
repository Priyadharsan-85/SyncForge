/**
 * Server configuration, read once from the environment and validated up
 * front so a misconfigured deploy fails at boot with every problem listed,
 * rather than at the first request that needs the missing value.
 */

const DEFAULT_PORT = 3001
const DEFAULT_CLIENT_ORIGIN = 'http://localhost:5173'
const DEFAULT_COMPACTION_THRESHOLD = 500
export const MIN_SESSION_SECRET_LENGTH = 32

/**
 * @typedef {object} ServerConfig
 * @property {boolean} production
 * @property {number} port
 * @property {string} clientOrigin  Origin (scheme://host[:port]) of the browser client.
 * @property {string | undefined} redisUrl
 * @property {number} redisCompactionThreshold
 * @property {string} sessionSecret
 * @property {string | undefined} githubClientId
 * @property {string | undefined} githubClientSecret
 * @property {string} githubCallbackUrl
 */

/** Treat empty strings (common from `${VAR:-}` in Compose) as unset. */
function read(env, name) {
  const value = env[name]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function parseOrigin(raw, name) {
  try {
    return new URL(raw).origin
  } catch {
    throw new Error(`${name} must be an absolute URL, got "${raw}".`)
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {ServerConfig}
 */
export function loadConfig(env = process.env) {
  // RENDER_EXTERNAL_URL is injected by Render; using it as a fallback means a
  // one-click deploy works without hand-copying the service URL.
  const originSource = read(env, 'CLIENT_ORIGIN') ?? read(env, 'RENDER_EXTERNAL_URL') ?? DEFAULT_CLIENT_ORIGIN
  const clientOrigin = parseOrigin(originSource, 'CLIENT_ORIGIN')

  return {
    production: env.NODE_ENV === 'production',
    port: Number(read(env, 'PORT') ?? DEFAULT_PORT),
    clientOrigin,
    redisUrl: read(env, 'REDIS_URL'),
    redisCompactionThreshold: Number(read(env, 'REDIS_COMPACTION_THRESHOLD') ?? DEFAULT_COMPACTION_THRESHOLD),
    sessionSecret: read(env, 'SESSION_SECRET') ?? '',
    githubClientId: read(env, 'GITHUB_CLIENT_ID'),
    githubClientSecret: read(env, 'GITHUB_CLIENT_SECRET'),
    githubCallbackUrl: read(env, 'GITHUB_CALLBACK_URL') ??
      new URL('/auth/github/callback', clientOrigin).toString(),
  }
}

/**
 * Every reason this config cannot run. Empty means it is fine.
 *
 * @param {ServerConfig} config
 * @returns {string[]}
 */
export function configProblems(config) {
  const problems = []
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65_535) {
    problems.push('PORT must be an integer between 0 and 65535.')
  }
  if (
    config.redisUrl &&
    (!Number.isSafeInteger(config.redisCompactionThreshold) || config.redisCompactionThreshold < 1)
  ) {
    problems.push('REDIS_COMPACTION_THRESHOLD must be a positive safe integer.')
  }
  if (config.production) {
    if (!config.redisUrl) {
      problems.push('REDIS_URL is required in production for durable workspace storage.')
    }
    if (!config.githubClientId || !config.githubClientSecret) {
      problems.push('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required in production.')
    }
    if (config.sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
      problems.push(`SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters in production.`)
    }
  }
  return problems
}

/**
 * @param {ServerConfig} config
 * @throws {Error} listing every problem when the config is unusable.
 */
export function assertValidConfig(config) {
  const problems = configProblems(config)
  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`)
  }
}
