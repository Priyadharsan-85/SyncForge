<div align="center">
  <img src="client/public/syncforge.svg" width="72" alt="SyncForge code brackets logo" />
  <h1>SyncForge</h1>
  <p><strong>One live workspace. Your whole team, building together.</strong></p>
  <p>A real-time collaborative code editor built with React, Monaco, Yjs, Socket.IO, Node.js, and Redis.</p>
  <p>
    <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white" />
    <img alt="Yjs" src="https://img.shields.io/badge/Yjs-CRDT-ff4a00" />
    <img alt="Socket.IO" src="https://img.shields.io/badge/Socket.IO-realtime-010101?logo=socketdotio&logoColor=white" />
    <img alt="Redis" src="https://img.shields.io/badge/Redis-persistence%20%26%20pub%2Fsub-DC382D?logo=redis&logoColor=white" />
    <img alt="Docker Compose" src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" />
  </p>
</div>

<br />

![SyncForge system architecture: React and Monaco clients connect through Socket.IO to horizontally scalable Node.js servers, backed by Redis and GitHub OAuth/import APIs.](architecture.svg)

> **Project status:** MVP / early access, not production-ready. Workspace access is authenticated and Redis-backed, but production deployments still need durable Redis backups, operational monitoring, and an appropriate data-retention policy.

## What makes SyncForge useful

| Collaborate live | Keep ownership clear | Pick up where you left off |
| --- | --- | --- |
| Monaco editing with Yjs conflict-free document updates, live room presence, and shared files. | Private workspaces, owner-controlled seven-day invites, and automatic editor access for public GitHub contributors. | IndexedDB recovery in the browser, Redis update replay, and snapshot compaction on the server. |

- **Bring a project:** import a local folder, a ZIP, or a public GitHub repository. Private repository import is not supported.
- **Recover safely:** accepted document changes are persisted to Redis before they are broadcast to collaborators.
- **Scale out:** the Socket.IO Redis adapter shares room events and presence between server instances.
- **Stay responsive:** Redis-backed action limits are shared across server instances.

Local imports support up to 300 text files, 512 KiB per file, and 6 MiB total. ZIP files are limited to 20 MiB compressed and 16 MiB expanded. Binary and common generated/dependency directories are skipped.

## Run it locally

**Requirements:** Node.js 22.12+ (or 24+) and npm.

```sh
npm install
npm run dev
```

Create a GitHub OAuth App with homepage `http://localhost:5173` and callback `http://localhost:5173/auth/github/callback`. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and a random `SESSION_SECRET` of at least 32 characters before running the app. Keep these secrets out of source control. Open the Vite URL printed in the terminal.

Redis is optional for local development; without it, data and rate limits are process-local. Production mode requires Redis and GitHub OAuth credentials.

### Run with Docker Compose

Copy `server/.env.example` to `.env`, set the GitHub OAuth credentials and a generated `SESSION_SECRET`, then start the stack:

```sh
docker compose up --build
```

Open `http://localhost:5173`. Stop the stack with `Ctrl+C`, then run `docker compose down`.

### GitHub sign-in setup

Register `http://localhost:5173/auth/github/callback` as the OAuth callback URL. The server validates OAuth state and issues a seven-day HMAC-signed `HttpOnly` session cookie (`SameSite=Lax`, `Secure` in production). OAuth currently requests `read:user`; GitHub repository import uses public GitHub APIs and does not request private-repository permissions.

### Workspace action limits

Per authenticated GitHub user, SyncForge allows 15 workspace creations, 5 combined local/GitHub imports, and 20 invite creations per hour. Redis applies these limits consistently across server instances. A `429` response includes `Retry-After`; if Redis cannot check a production limit, the action fails with `503` instead of silently bypassing the limit.

## Reliability and load testing

The server exposes `/health` for liveness and `/ready` for readiness. With Redis configured, readiness performs a bounded connectivity check and returns `503` if Redis is unavailable. Redis writes and update replay have time limits; the client keeps local edits in IndexedDB and retries transient failures.

Compaction defaults to every 500 stored updates per room. Set `REDIS_COMPACTION_THRESHOLD` to a positive integer to tune it; lowering it reduces replay work but creates snapshots more often.

The Socket.IO load test defaults to 100 clients and a unique throwaway room. Run it only against a local or staging deployment with disposable Redis data. Sign in with a dedicated test account and provide its session cookie without saving it in the repository:

```powershell
$env:LOAD_TEST_COOKIE = 'syncforge_session=<session-token>'
npm run load-test --workspace server
```

Optional settings: `LOAD_TEST_URL`, `LOAD_TEST_ORIGIN`, and `LOAD_TEST_CLIENTS` (1–500). The report includes connection/join counts, update acknowledgement p50/p95/p99, failures, and document convergence. This baseline is not a capacity guarantee.

## Important workspace migration note

Workspaces created before room authorization was introduced have no recorded owner and are not automatically migrated. Their Redis document data is not deleted, but old room links no longer grant access. Migrate ownership explicitly before relying on those workspaces.

## Development checks

```sh
npm test
npm run lint
npm run build
```

## Roadmap

- Add structured logs, metrics, and alerts for collaboration, Redis, and GitHub import health.
- Add file rename/delete workflows and accessible editor interactions.
- Design AI-assisted edits as reviewable proposals, plus GitHub branch/PR publishing that does not silently rewrite the live workspace.

The app interface uses **DM Sans** with **DM Mono** for code-oriented details. GitHub controls README fonts, so the documentation uses clear headings, compact feature panels, and architecture artwork instead of attempting unsupported custom font styling.

Contributions and focused bug reports are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change.
