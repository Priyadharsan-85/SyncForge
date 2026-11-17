# SyncForge

SyncForge is an early-stage collaborative code workspace. Teammates can open the same room, edit together in Monaco, and continue working through a temporary network interruption. It uses **Yjs CRDTs** for concurrent edits; it does not implement Operational Transformation.

> **Status:** MVP, not production-ready. Rooms currently have no authentication or access control. Do not use SyncForge for private or sensitive source code. Redis update streams have no compaction or retention policy yet; monitor Redis storage and use durable, backed-up Redis for deployments.

## What works today

- Create a room or join one using a room code or invite URL.
- Create and edit multiple shared files in Monaco; Yjs merges concurrent edits.
- Keep a local copy in browser IndexedDB and merge it back after reconnecting.
- Show room presence and copy an invite link.
- Append each accepted document update to a Redis stream before broadcasting it, then replay updates after a server restart.
- Use the Socket.IO Redis adapter for multi-process message distribution.
- Run the web app, Node.js server, and Redis with Docker Compose.

## Run locally

Requirements: Node.js 22.12+ (or 24+) and npm.

```sh
npm install
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). Redis is optional for local development; without it, room state lives only in the server process. Production mode requires `REDIS_URL`.

The server exposes `/health` for liveness and `/ready` for readiness. When Redis is configured, `/ready` performs a bounded Redis connectivity check and returns `503` if Redis is unavailable; without Redis it reports `persistence: "memory"`.

To run the containerized development stack:

```sh
docker compose up --build
```

The app is available at `http://localhost:5173`. To stop it, press `Ctrl+C` and run `docker compose down`.

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

- Add safe Redis stream compaction and retention, then verify offline/reconnect behavior under server and Redis failures.
- Add room authorization, rate limits, and safe-by-default deployment settings.
- Add meaningful observability and repeatable load tests before making scalability claims.
- Improve the editor workflow with cursor awareness, file renaming/deletion, and accessible keyboard interactions.

Contributions and focused bug reports are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change.
