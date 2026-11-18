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
- Keyboard shortcuts: `Ctrl/Cmd+Shift+N` (new file), `+A` (AI), `+B` (branches), `+I` (invite)
- React `ErrorBoundary` with recovery UI wrapping the entire application
- Loading skeleton components for workspace list and file sidebar
- Security HTTP response headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` (production)
- `Dockerfile` and `docker-compose.yml` for containerised deployment
- Nginx configuration with proxy rules and long-lived asset caching
- GitHub Actions Docker build-and-push workflow targeting GHCR
- Multi-version CI matrix (Node 22 and 24)
- `.env.example` documenting every configurable environment variable
- Comprehensive `README.md` with setup, architecture, and API reference
- `CONTRIBUTING.md`, `SECURITY.md`, and `LICENSE` (MIT)
- `robots.txt`, Open Graph, and Twitter Card meta tags
- `CHANGELOG.md` (this file)

### Fixed
- `workspaceAccess.test.js` refactored to use unique room IDs per test to prevent cross-test state leakage

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
