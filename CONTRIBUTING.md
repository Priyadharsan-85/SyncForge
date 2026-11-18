# Contributing to SyncForge

Thank you for your interest in contributing! This document explains how to get started, what the codebase looks like, and what we expect from pull requests.

---

## Project structure

```
SyncForge/
├── client/          # React + Vite frontend (TypeScript)
│   └── src/
│       ├── App.tsx               Main application shell
│       ├── AiAssistantModal.tsx  AI draft review dialog
│       ├── BranchManagerModal.tsx Branch/PR management
│       ├── DiffViewer.tsx        Unified diff renderer
│       ├── editorBinding.ts      Yjs ↔ Monaco binding
│       └── projectFiles.ts       Folder/ZIP import helpers
├── server/          # Node.js / Express / Socket.IO backend (ESM)
│   ├── src/
│   │   ├── index.js        HTTP + WebSocket entry point
│   │   ├── auth.js         Session tokens and GitHub OAuth
│   │   ├── aiAssistant.js  AI draft patch generation
│   │   ├── branchManager.js  Branch and commit storage
│   │   ├── diffPatch.js    LCS diff, hunks, patch formatting
│   │   ├── githubImport.js GitHub public repo importer
│   │   ├── githubWorkflow.js Patch export and push guards
│   │   ├── projectImport.js  Local file import validation
│   │   ├── pullRequestManager.js PR lifecycle
│   │   ├── rateLimit.js    Per-actor rate limiting
│   │   ├── redisStore.js   Yjs document persistence
│   │   ├── semanticMerge.js Three-way merge
│   │   ├── validation.js   Input validation helpers
│   │   ├── workspaceAccess.js Workspace and invite management
│   │   └── workspaceSync.js  Branch-to-live-doc sync
│   └── test/        Node test runner test files
├── .env.example     Environment variable documentation
├── docker-compose.yml
└── Dockerfile
```

---

## Development setup

```bash
git clone https://github.com/Priyadharsan-85/SyncForge.git
cd SyncForge
npm install
cp .env.example .env   # then fill in SESSION_SECRET + GitHub OAuth values
npm run dev
```

The dev server proxies all `/api`, `/auth`, and `/socket.io` requests from Vite (port 5173) to the Express server (port 3001), so you only need to open one URL.

---

## Running tests

```bash
npm test          # run all server tests
```

The server tests use Node's built-in test runner (`node --test`). No external test framework is needed.

---

## Submitting a pull request

1. **Fork** the repository and create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature
   ```
2. Write your changes. Keep each commit focused on one thing.
3. Add or update tests if you are changing server-side logic.
4. Make sure `npm test` passes with zero failures.
5. Run `npm run lint` to check for client-side linting issues.
6. Open a pull request with a clear title and a description of what changes and why.

---

## Code style

- Server: plain ESM JavaScript, no TypeScript. Follow the patterns already in the file you're editing.
- Client: TypeScript + React. Use functional components with hooks. Avoid `any`.
- Formatting: code is not auto-formatted yet — match the indentation and style of the surrounding code.
- Avoid introducing new dependencies without prior discussion in an issue.

---

## Reporting bugs

Open a [GitHub issue](https://github.com/Priyadharsan-85/SyncForge/issues) and include:

- Steps to reproduce
- Expected and actual behaviour
- Browser/Node/OS version if relevant

---

## Security vulnerabilities

Please do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the responsible disclosure process.
