# SyncForge

A real-time collaborative code workspace for teams. Multiple people can edit the same files simultaneously, with changes synced live through CRDTs (Yjs). Built on Node.js, React, Monaco Editor, Socket.IO, and Redis.

[![CI](https://github.com/Priyadharsan-85/SyncForge/actions/workflows/ci.yml/badge.svg)](https://github.com/Priyadharsan-85/SyncForge/actions/workflows/ci.yml)

---

## Features

- **Real-time collaboration** — every keystroke is propagated instantly to all connected editors using Yjs CRDTs
- **Offline resilience** — edits made while disconnected are synced automatically when the connection returns, using IndexedDB for local persistence
- **Multi-file workspaces** — create, rename, and delete files within a shared workspace
- **Branch management** — create branches, commit snapshots, and track history without leaving the browser
- **Pull requests** — open, review, diff, and merge branches inside the workspace
- **AI code assistant** — generate private draft patches (JSDoc, refactor, tests, custom prompts) that only apply when you explicitly accept them
- **GitHub import** — import any public GitHub repository directly into a workspace
- **Patch export** — download standard `.patch` files from any branch or PR to apply locally with `git apply`
- **Invite links** — workspace owners can share a time-limited invite URL to add collaborators
- **GitHub OAuth** — sign in with your GitHub account; contributors of imported repositories get editor access automatically

---

## Architecture

```
┌───────────────────────────────────┐
│  Browser (React + Monaco + Yjs)   │
│  IndexedDB local persistence      │
└───────────┬───────────────────────┘
            │ WebSocket (Socket.IO)
            │ HTTP (REST)
┌───────────▼───────────────────────┐
│  Node.js / Express / Socket.IO    │
│  Yjs server-side document store   │
│  GitHub OAuth                     │
└───────────┬───────────────────────┘
            │
┌───────────▼───────────────────────┐
│  Redis (optional)                  │
│  Session store, document updates,  │
│  branch/PR/workspace metadata      │
└───────────────────────────────────┘
```

The server can run **without Redis** in development. In that mode all state is held in memory and is lost when the server restarts.

---

## Quick start

### Prerequisites

- Node.js ≥ 22
- npm ≥ 10
- Redis 7+ (optional for development)
- A GitHub OAuth App (for sign-in)

### 1. Clone and install

```bash
git clone https://github.com/Priyadharsan-85/SyncForge.git
cd SyncForge
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in SESSION_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
```

See [`.env.example`](.env.example) for every available option and guidance on creating a GitHub OAuth App.

### 3. Start development servers

```bash
npm run dev
```

This concurrently starts:
- Vite dev server at `http://localhost:5173`
- Express + Socket.IO server at `http://localhost:3001`

Open `http://localhost:5173` in your browser.

### 4. Run tests

```bash
npm test
```

---

## Production deployment

### Docker Compose (recommended)

```bash
cp .env.example .env
# Edit .env
docker compose up -d
```

The Compose file starts Redis, the Node.js server, and an Nginx static file server for the built client.

### Manual

```bash
# Build the client
npm run build --workspace client

# Start the server
NODE_ENV=production node server/src/index.js
```

Serve the built files in `client/dist` from your CDN or static server and point `CLIENT_ORIGIN` at the domain.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3001` | Server listen port |
| `CLIENT_ORIGIN` | No | `http://localhost:5173` | Allowed CORS origin for the browser client |
| `SESSION_SECRET` | **Yes (prod)** | — | Secret for signing session cookies |
| `REDIS_URL` | No | — | Redis connection URL; omit for memory-only mode |
| `REDIS_COMPACTION_THRESHOLD` | No | `500` | Yjs update count before room compaction |
| `GITHUB_CLIENT_ID` | **Yes** | — | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | **Yes** | — | GitHub OAuth App client secret |
| `GITHUB_CALLBACK_URL` | No | Derived from `CLIENT_ORIGIN` | OAuth redirect URI |

---

## API reference

### Authentication

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/me` | Return the authenticated user |
| `GET` | `/auth/github` | Redirect to GitHub OAuth |
| `GET` | `/auth/github/callback` | OAuth callback |
| `POST` | `/auth/logout` | Clear the session cookie |

### Workspaces

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/workspaces` | List workspaces for the current user |
| `POST` | `/api/workspaces` | Create a blank workspace |
| `POST` | `/api/workspaces/import/local` | Import a local project (file array) |
| `POST` | `/api/workspaces/import/github` | Import a public GitHub repository |
| `PATCH` | `/api/workspaces/:roomId` | Rename a workspace |
| `DELETE` | `/api/workspaces/:roomId` | Delete a workspace (owner only) |
| `POST` | `/api/workspaces/:roomId/invites` | Create an invite link |

### Branches & commits

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/workspaces/:roomId/branches` | List branches |
| `POST` | `/api/workspaces/:roomId/branches` | Create a branch |
| `GET` | `/api/workspaces/:roomId/branches/:branch/commits` | List commits on a branch |
| `POST` | `/api/workspaces/:roomId/branches/:branch/commits` | Commit a snapshot |
| `POST` | `/api/workspaces/:roomId/branches/:branch/sync-live` | Sync branch to live workspace |
| `POST` | `/api/workspaces/:roomId/branches/:branch/export-patch` | Export branch as `.patch` |

### Pull requests

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/workspaces/:roomId/pulls` | List pull requests |
| `POST` | `/api/workspaces/:roomId/pulls` | Create a pull request |
| `GET` | `/api/workspaces/:roomId/pulls/:prNumber` | Get a pull request |
| `GET` | `/api/workspaces/:roomId/pulls/:prNumber/diff` | Get PR diff |
| `POST` | `/api/workspaces/:roomId/pulls/:prNumber/merge` | Merge a pull request |
| `POST` | `/api/workspaces/:roomId/pulls/:prNumber/close` | Close a pull request |
| `POST` | `/api/workspaces/:roomId/pulls/:prNumber/export-patch` | Export PR as `.patch` |

### AI assistant

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/workspaces/:roomId/ai/draft` | Generate an AI draft patch |
| `GET` | `/api/workspaces/:roomId/ai/drafts` | List your drafts |
| `POST` | `/api/workspaces/:roomId/ai/rebase` | Rebase a draft against live content |
| `DELETE` | `/api/workspaces/:roomId/ai/drafts/:draftId` | Discard a draft |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## License

MIT — see [LICENSE](LICENSE).
