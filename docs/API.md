# API reference

All endpoints are served from the same origin as the client. Authenticated
routes read the `syncforge_session` cookie set by GitHub sign-in; state-changing
routes also require the request `Origin` to match `CLIENT_ORIGIN`.

Errors are always JSON — `{ "error": "message" }` — and every response carries
an `X-Request-Id` header you can quote when reporting a problem.

## Authentication

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/me` | The signed-in user, or `401` |
| `GET` | `/auth/github` | Start GitHub OAuth (`?returnTo=/path`) |
| `GET` | `/auth/github/callback` | OAuth callback |
| `POST` | `/auth/logout` | Clear the session cookie |

## Workspaces

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/workspaces` | Workspaces the current user belongs to |
| `POST` | `/api/workspaces` | Create a blank workspace |
| `POST` | `/api/workspaces/import/local` | Import a project from a file array (`{ name, files: [{ path, content }] }`) |
| `POST` | `/api/workspaces/import/github` | Import a public GitHub repository |
| `PATCH` | `/api/workspaces/:roomId` | Rename (owner only) |
| `DELETE` | `/api/workspaces/:roomId` | Delete with its document (owner only) |
| `GET` | `/api/workspaces/:roomId/stats` | File count, total size, branch and pull request counts |
| `POST` | `/api/workspaces/:roomId/fork` | Clone into a new workspace you own |
| `POST` | `/api/workspaces/:roomId/invites` | Create a seven-day invite link (owner only) |

## Branches and commits

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/workspaces/:roomId/branches` | List branches |
| `POST` | `/api/workspaces/:roomId/branches` | Create a branch |
| `DELETE` | `/api/workspaces/:roomId/branches/:branch` | Delete a branch (`main` is protected) |
| `GET` | `/api/workspaces/:roomId/branches/:branch/commits` | Commit history |
| `POST` | `/api/workspaces/:roomId/branches/:branch/commits` | Snapshot the live workspace as a commit |
| `GET` | `/api/workspaces/:roomId/commits/:commitId` | One commit |
| `GET` | `/api/workspaces/:roomId/commits/:commitId/diff` | Diff against its parent |
| `POST` | `/api/workspaces/:roomId/branches/:branch/sync-live` | Replace the live document with the branch head |
| `POST` | `/api/workspaces/:roomId/branches/:branch/export-patch` | Download a `git apply`-able patch |

## Pull requests

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/workspaces/:roomId/pulls` | List (`?status=open\|merged\|closed`) |
| `POST` | `/api/workspaces/:roomId/pulls` | Open a pull request |
| `GET` | `/api/workspaces/:roomId/pulls/:prNumber` | One pull request |
| `GET` | `/api/workspaces/:roomId/pulls/:prNumber/diff` | Its diff |
| `POST` | `/api/workspaces/:roomId/pulls/:prNumber/merge` | Three-way merge; `409` on conflict |
| `POST` | `/api/workspaces/:roomId/pulls/:prNumber/close` | Close without merging |
| `GET` | `/api/workspaces/:roomId/pulls/:prNumber/comments` | Discussion |
| `POST` | `/api/workspaces/:roomId/pulls/:prNumber/comments` | Add a comment |
| `POST` | `/api/workspaces/:roomId/pulls/:prNumber/export-patch` | Download the PR as a patch |
| `GET` | `/api/workspaces/:roomId/github/status` | Patch-export readiness for the GitHub workflow tab |

## AI drafts

Drafts are private to their author and never touch the shared document until
accepted.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/workspaces/:roomId/ai/draft` | Generate a draft patch for a file |
| `GET` | `/api/workspaces/:roomId/ai/drafts` | Your drafts |
| `POST` | `/api/workspaces/:roomId/ai/rebase` | Rebase a draft onto the current live content |
| `DELETE` | `/api/workspaces/:roomId/ai/drafts/:draftId` | Discard a draft |

## Operations

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness — `200` while the process is serving |
| `GET` | `/ready` | Readiness — `503` when Redis is unreachable |
| `GET` | `/api/version` | Version, commit SHA, uptime and enabled features (booleans only) |
| `GET` | `/metrics` | JSON by default, Prometheus text with `Accept: text/plain`. Requires `Authorization: Bearer $METRICS_TOKEN` in production |

## Socket.IO events

| Direction | Event | Payload |
|---|---|---|
| client → server | `room:join` | `{ roomId, inviteToken? }` → ack `{ ok, state, stateVector, role, members }` |
| client → server | `document:update` | `{ roomId, update }` (Yjs update) → ack `{ ok, retryable?, error? }` |
| server → client | `document:update` | Yjs update from another collaborator |
| server → client | `presence:update` | Current room members |
| server → client | `room:error` | Human-readable error |

Binary fields arrive as `ArrayBuffer` in browsers; wrap them in `Uint8Array`
before handing them to Yjs (see `client/src/binary.ts`).
