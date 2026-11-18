# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| `main` (latest) | ✅ |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please email security reports to the maintainers using the contact details on the repository's GitHub profile, or open a [private security advisory](https://github.com/Priyadharsan-85/SyncForge/security/advisories/new) on GitHub.

Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Any suggested mitigations if you have them

We aim to acknowledge reports within **48 hours** and to release a fix or mitigation within **14 days** of confirmation.

## Security model

- All session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Sessions are signed with HMAC-SHA256 and expire after 7 days.
- OAuth state parameters are validated with a timing-safe comparison.
- CORS is restricted to the configured `CLIENT_ORIGIN`.
- WebSocket connections verify the session cookie and reject connections from unknown origins.
- Rate limits are enforced on workspace creation, project import, invite creation, and AI draft generation.
- File content imported from GitHub is treated as untrusted data; no code is evaluated.
- Redis keys are namespaced to prevent cross-workspace access.
- Branch commits use optimistic concurrency control to prevent lost updates under concurrent writes.
