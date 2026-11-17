import { createHmac, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE_NAME = 'syncforge_session'
export const OAUTH_STATE_COOKIE_NAME = 'syncforge_oauth_state'
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

function signatureFor(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

export function createSessionToken(user, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    login: user.login,
    name: user.name,
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  })).toString('base64url')
  return `${payload}.${signatureFor(payload, secret)}`
}

export function verifySessionToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !secret) return null
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) return null

  const expected = Buffer.from(signatureFor(payload, secret))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (
      typeof claims.sub !== 'string' ||
      typeof claims.login !== 'string' ||
      typeof claims.name !== 'string' ||
      !Number.isInteger(claims.exp) ||
      claims.exp <= Math.floor(now / 1000)
    ) return null

    return { id: claims.sub, login: claims.login, name: claims.name }
  } catch {
    return null
  }
}

export function readCookie(header, cookieName) {
  if (typeof header !== 'string') return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== cookieName) continue
    return part.slice(separator + 1).trim()
  }
  return undefined
}

export function safeReturnPath(path) {
  if (
    typeof path !== 'string' ||
    path.length > 2_048 ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\')
  ) return '/'
  return path
}

export function matchesSecret(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false
  const expectedBytes = Buffer.from(expected)
  const receivedBytes = Buffer.from(received)
  return expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
}
