# Changelog

All notable changes to SyncForge are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [1.0.0] — 2026-11-26

First production release.

### Added
- The server serves the built client (`client/dist`) with an HTML-specific CSP, immutable asset caching and an SPA fallback, so one container hosts the whole app
- Validated configuration module that lists every problem at boot and falls back to Render's `RENDER_EXTERNAL_URL`
- Render Blueprint (`render.yaml`) with a private Key Value instance and generated secrets
- CI job that builds the production image and smoke-tests it against Redis
- Client test suite (`node:test` with type stripping) for binary decoding, language detection and command ranking
- Dependabot for npm, GitHub Actions and Docker base images
- `docs/DEPLOYMENT.md`, `docs/API.md`, a deployment topology diagram and product screenshots
- `npm run dev` loads the root `.env` automatically

### Changed
- Monaco is bundled locally with Vite-built web workers and lazy-loaded, instead of fetched from a CDN
- Docker Compose builds the image itself; nginx is now a WebSocket-aware reverse proxy only
- The image sets `NODE_ENV=production`, records the commit SHA and probes `/health` for liveness
- Graceful shutdown is bounded to 10 seconds and unhandled rejections are logged
- Minimum Node.js version is 22.18

### Fixed
- Joining a room in the browser threw "Unexpected end of array" because Socket.IO delivers binary payloads as `ArrayBuffer`; rooms never reached the Live state
- The Docker image failed to build because the client was compiled on Alpine without musl native bindings
- `docker compose up` required a host-side client build
- The top bar read "Workspace" when a room was opened from a link
- Hidden file actions truncated sidebar file names
- Escape did not close dialogs, and the AI and branch dialogs could stack

### Removed
- Stale `client/Dockerfile`, `server/Dockerfile` and `server/.env.example`

### Pre-release development included in 1.0.0

#### Added
- Workspace delete endpoint (owner only) with Yjs document cleanup
- Workspace rename endpoint (owner only)
- File delete and rename in the collaborative workspace sidebar
- File filter/search input in the workspace sidebar
- Keyboard shortcuts: `Ctrl/Cmd+Shift+N` (new file), `+A` (AI), `+B` (branches), `+I` (invite)
- Keyboard shortcuts help panel accessible from the sidebar help button
- React `ErrorBoundary` with recovery UI wrapping the entire application
- Loading skeleton components for workspace list and file sidebar
- Animated toast notification component replacing static alert banners
- Security HTTP response headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` (production)
- Structured JSON request logging middleware with request IDs
- In-process metrics collector with per-counter tracking
- `Dockerfile` and `docker-compose.yml` for containerised deployment
- Nginx configuration with proxy rules and long-lived asset caching
- GitHub Actions Docker build-and-push workflow targeting GHCR
- Multi-version CI matrix (Node 22 and 24)
- `.env.example` documenting every configurable environment variable
- Comprehensive `README.md` with setup, architecture, and API reference
- `CONTRIBUTING.md`, `SECURITY.md`, and `LICENSE` (MIT)
- `robots.txt`, Open Graph, and Twitter Card meta tags
- `CHANGELOG.md` (this file)
- GitHub feature request and PR templates

#### Tests added (167 passing, 2 skipped)
- Workspace rename and delete lifecycle tests
- Workspace management integration tests
- Diff/patch edge cases (CRLF, empty strings, multi-hunk)
- Branch edge cases (validation, tree hash, commit limits)
- Pull request edge cases (filtering, lifecycle, diff reporting)
- AI assistant edge cases (checksum, code generation, draft lifecycle)
- Auth edge cases (token validation, cookie parsing, path safety)
- Validation edge cases (roomId, displayName, file import)
- Workspace sync edge cases (apply, remove, mixed ops)
- Rate limit edge cases (actor/scope isolation, validation)
- Request logger unit tests
- Metrics module unit tests

#### Fixed
- `workspaceAccess.test.js` refactored to use unique room IDs per test to prevent cross-test state leakage
- Request logger now reads `NODE_ENV` dynamically instead of at module load time

---

## [0.1.0] — 2025-01-01

### Added
- Real-time collaborative code editing powered by Yjs CRDTs and Socket.IO
- Offline resilience with IndexedDB local persistence and automatic reconnect
- Multi-file workspace support with live-synced file tree
- GitHub OAuth sign-in
- Workspace creation, local folder/ZIP import, and public GitHub repository import
- Workspace invite links (time-limited, single-use)
- Branch management: create branches, commit snapshots, view history
- Pull request lifecycle: create, review diff, merge (with conflict detection), close
- Three-way semantic merge with conflict markers
- Private AI draft patches: JSDoc, refactor, test generation, custom prompts
- Diff viewer with unified diff rendering and conflict banners
- Branch-to-live workspace sync-back
- Git patch export for branches and pull requests
- Redis persistence with Yjs update streaming and room compaction
- Multi-instance scaling via `@socket.io/redis-adapter`
- Per-actor rate limiting for workspace creation, project import, invites, and AI drafts
- Full server test suite (60 tests) using Node's built-in test runner
