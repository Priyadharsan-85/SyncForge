import express from 'express'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Serve the built React client (client/dist) from the API server, so a single
 * container can host the whole app behind one origin. This keeps cookies,
 * CORS and the Socket.IO handshake same-origin, which is what the client
 * assumes (it calls `/api`, `/auth` and `/socket.io` with relative URLs).
 *
 * Paths owned by the API are never answered with index.html: a typo in an
 * API URL must still produce the JSON 404, not a 200 HTML page.
 */

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_CLIENT_DIST = resolve(MODULE_DIR, '../../client/dist')

/** Route prefixes the server owns; the SPA fallback skips them. */
export const API_PATH_PATTERN = /^\/(api|auth|health|ready|metrics|socket\.io)(\/|$)/

/**
 * The HTML document needs a looser policy than the API's `default-src 'none'`
 * — it loads its own scripts, styles, Monaco web workers, and Google Fonts —
 * but still forbids third-party scripts, framing and plugins.
 */
export const CLIENT_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' ws: wss:",
].join('; ')

/**
 * Resolve which directory to serve, or null when static serving is off.
 *
 * `SERVE_CLIENT=false` disables it explicitly (for deployments where nginx or
 * a CDN serves the client); `CLIENT_DIST_DIR` points at a non-default build.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function resolveClientDist(env = process.env) {
  if (env.SERVE_CLIENT === 'false' || env.SERVE_CLIENT === '0') return null
  const dir = env.CLIENT_DIST_DIR ? resolve(env.CLIENT_DIST_DIR) : DEFAULT_CLIENT_DIST
  return existsSync(join(dir, 'index.html')) ? dir : null
}

/**
 * @param {string} distDir Absolute path to a built client.
 * @returns {import('express').Router}
 */
export function createStaticClientRouter(distDir) {
  const router = express.Router()
  const indexFile = join(distDir, 'index.html')

  router.use((request, response, next) => {
    if (API_PATH_PATTERN.test(request.path)) return next()
    response.set('Content-Security-Policy', CLIENT_CONTENT_SECURITY_POLICY)
    response.set('Cross-Origin-Resource-Policy', 'same-origin')
    next()
  })

  // Vite fingerprints everything under /assets, so it can be cached forever.
  router.use(
    '/assets',
    express.static(join(distDir, 'assets'), {
      immutable: true,
      maxAge: '1y',
      fallthrough: false,
      index: false,
    }),
  )

  router.use(
    express.static(distDir, {
      index: false,
      setHeaders(response) {
        response.set('Cache-Control', 'no-cache')
      },
    }),
  )

  // SPA fallback: only for GET/HEAD navigations outside the API namespace.
  router.use((request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next()
    if (API_PATH_PATTERN.test(request.path)) return next()
    response.set('Cache-Control', 'no-cache')
    response.sendFile(indexFile)
  })

  return router
}
