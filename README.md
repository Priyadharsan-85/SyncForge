# SyncForge

SyncForge is an early-stage collaborative code workspace. Teammates can open the same room, edit together in Monaco, and continue working through a temporary network interruption. It uses **Yjs CRDTs** for concurrent edits; it does not implement Operational Transformation.

> **Status:** MVP, not production-ready. Authenticated owners and editors can collaborate; room IDs alone do not grant access. Redis still needs durable backups, an operational retention policy, and production monitoring before using SyncForge for important or sensitive source code.

## What works today

- Create a private workspace and invite editors with a seven-day invite link. Only the owner can create invite links; invitees appear in the workspace dashboard after joining.
- Browse workspaces you own or have been granted access to; knowing a room ID is not sufficient to join.
- Import a folder or ZIP from your device. Unsupported/binary files are skipped; imports are limited to 300 text files, 512 KiB per file, and 6 MiB total. ZIP files are limited to 20 MiB and 16 MiB expanded.
- Import public GitHub repositories. Existing GitHub contributors are automatically granted editor access and can open the workspace from their dashboard. Private repositories are not supported.
- Create and edit multiple shared files in Monaco; Yjs merges concurrent edits.
- Keep a local copy in browser IndexedDB and merge it back after reconnecting.
- Show room presence and copy an invite link.
- Sign in with GitHub; signed, HttpOnly sessions identify participants and are required for Socket.IO connections.
- Append each accepted document update to a Redis stream before broadcasting it, then replay updates after a server restart.
- Periodically compact Redis update streams into Yjs snapshots and retain only updates newer than each snapshot checkpoint.
- Use the Socket.IO Redis adapter for multi-process message distribution.
- Share participant presence across server instances and evict idle room documents from Redis-backed server memory.
- Run the web app, Node.js server, and Redis with Docker Compose.

Workspaces created before room authorization was added have no recorded owner and are not automatically migrated. Their Redis document data is not deleted, but old room links cannot grant access; migrate ownership explicitly before relying on those workspaces.

## Run locally

Requirements: Node.js 22.12+ (or 24+) and npm.

```sh
npm install
npm run dev
```

Create a GitHub OAuth App with homepage `http://localhost:5173` and callback `http://localhost:5173/auth/github/callback`. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and a random `SESSION_SECRET` of at least 32 characters in the environment before running `npm run dev`. These values are secrets; do not commit them. Open the Vite URL printed in the terminal (normally `http://localhost:5173`). Redis is optional for local development; without it, room state lives only in the server process. Production mode requires Redis and OAuth configuration.

The server exposes `/health` for liveness and `/ready` for readiness. When Redis is configured, `/ready` performs a bounded Redis connectivity check and returns `503` if Redis is unavailable; writes and update replay also have time limits. The client retries transient storage errors while keeping edits in IndexedDB. Without Redis, readiness reports `persistence: "memory"`.

Compaction defaults to every 500 stored updates per room. Set `REDIS_COMPACTION_THRESHOLD` to a positive integer to tune it; lowering it reduces replay work but creates snapshots more often.

To run the containerized stack, first copy `server/.env.example` to `.env` and set the GitHub OAuth credentials and a generated `SESSION_SECRET`. Register the callback URL shown above in the OAuth App. Then run:

```sh
docker compose up --build
```

The app is available at `http://localhost:5173`. To stop it, press `Ctrl+C` and run `docker compose down`.

## Authentication and load test

The server validates OAuth state on the GitHub callback, creates a seven-day HMAC-signed session cookie (`HttpOnly`, `SameSite=Lax`, and `Secure` in production), and derives each participant's display name from the authenticated GitHub profile. Keep the frontend and API on one origin (or behind a same-origin reverse proxy) so the browser sends the session cookie to both REST and Socket.IO endpoints. Production startup fails without Redis, GitHub OAuth credentials, and a `SESSION_SECRET` of at least 32 characters.

Workspace creation is limited to 15 actions per user per hour, project imports (local and GitHub combined) to 5 per hour, and invite creation to 20 per hour. Limits are keyed by authenticated GitHub user ID and shared through Redis across server instances. A `429` response includes `Retry-After`; if Redis cannot check a production limit, the action fails with `503` rather than bypassing the limit. Without Redis in local development, limits are process-local.

The repeatable Socket.IO load test defaults to 100 clients and a unique throwaway room. Run it only against a local or staging deployment with disposable Redis data; it writes test edits to that room. Sign in with a dedicated test account, then pass the session cookie without saving it in the repository:

```powershell
$env:LOAD_TEST_COOKIE = 'syncforge_session=<session-token>'
npm run load-test --workspace server
```

Optional settings are `LOAD_TEST_URL`, `LOAD_TEST_ORIGIN`, and `LOAD_TEST_CLIENTS` (1–500). The report includes connection/join counts, update acknowledgement p50/p95/p99, failures, and document convergence. This is a repeatable baseline, not a capacity guarantee; results depend on the machine, network, Redis configuration, and workload.

## Project layout

```text
client/       React, TypeScript, Monaco Editor, Yjs and IndexedDB
server/       Express, Socket.IO, Yjs and optional Redis
```

## Checks

```sh
npm test
npm run lint
npm run build
```

## Roadmap

- Verify compaction behavior under concurrent writers and tune its threshold with representative workload tests.
- Add rate limits and safe-by-default deployment settings.
- Add meaningful observability before making scalability claims.
- Improve the editor workflow with cursor awareness, file renaming/deletion, and accessible keyboard interactions.

Contributions and focused bug reports are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change.
