# Changelog

All notable changes to SyncForge are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
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

### Tests added (167 passing, 2 skipped)
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

### Fixed
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
