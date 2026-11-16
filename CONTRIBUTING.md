# Contributing

Thanks for helping improve SyncForge. The project is an early-stage MVP, so focused, tested changes are especially valuable.

## Development setup

1. Install Node.js 22.12+ and npm.
2. Run `npm install`.
3. Start the client and server with `npm run dev`.
4. Run `npm test`, `npm run lint`, and `npm run build` before submitting.

Redis is optional for local development. `docker compose up --build` starts the containerized stack.

## Pull requests

- Open an issue for larger features so the behavior and scope can be discussed first.
- Keep pull requests focused and explain user-visible behavior and any tradeoffs.
- Add tests for changed behavior, especially synchronization and reconnect edge cases.
- Never include secrets, private source code, or real user data in examples or test fixtures.
- Do not describe the app as production-ready or claim performance numbers without reproducible evidence.

## Good first contributions

- Keyboard and screen-reader accessibility improvements.
- Tests for editing and reconnect behavior across multiple clients.
- Clear empty, loading, offline, and error states.
- Developer documentation and small usability fixes.
