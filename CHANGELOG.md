# Changelog

All notable changes to Claos Dashboard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- **tempTokens persistence**: Migrated TOTP temp-token store from volatile in-memory Map to
  file-based JSON in `DATA_DIR`. Survives PM2 restarts; bounded to 1 000 entries to prevent
  DoS; expired entries purged on startup.
- **Async session I/O cache**: Added 5 s in-memory read-cache for `sessions.json` and 2 s
  cache for `rate-limits.json` in `lib/auth.ts`. Eliminates blocking `readFileSync` on every
  authenticated request. Writes are fire-and-forget via `fs.promises` while the cache is
  updated synchronously so subsequent reads are always fresh.
- **localStorage hardening**: All `localStorage.getItem` reads now validate the parsed
  structure (array/object shape check) and purge corrupted keys instead of propagating
  bad data.

### Fixed
- **Test noise**: Mocked `console.warn` in circuit-breaker test suite to suppress expected
  "Circuit breaker opened" messages in test output.
- **Hardcoded gateway URL** in `ChatPanel`: replaced `http://127.0.0.1:18789` with a
  dynamic URL derived from a new optional `gatewayConfig` prop; falls back to
  `ws://<hostname>:18789` when the prop is absent.

### Changed
- **Docker UID/GID**: `docker-compose.yml` now uses `${UID:-1000}:${GID:-1000}` instead
  of the hardcoded `1002:1002`. Document the variables in `.env.example`.

### Documentation
- Added `CHANGELOG.md` (this file) following Keep a Changelog format.

---

## [0.1.0] — 2025

Initial public release of Claos Dashboard.

### Added

#### Core features
- Multi-gateway AI agent chat dashboard (Next.js 15, React 19, TypeScript)
- Zero-config first-run wizard — password setup without touching config files
- Gateway manager UI — add/remove/discover VPS gateways at runtime
- Real-time WebSocket chat with streaming support (`agent.stream.*` events)
- Multi-agent group sessions with ping-pong dialogue and round-robin messaging
- File/image/audio upload support in chat
- Persistent chat history per session (localStorage + server-side)

#### Shell / Terminal
- Web-based shell via `xterm.js` with PTY support
- Persistent shell state across tab navigation

#### File Manager
- Browse, read, create, edit, delete, move, download files
- VPS-wide access (configurable `ALLOWED_BASE_PATHS`)
- Blocked paths: `/proc`, `/sys`, `/dev`, `/boot`, `/root`, `/etc/shadow`
- Blocked extensions: `.ts`, `.py` (creation only), binary files

#### Authentication & Security
- bcrypt password hashing (12 rounds)
- Session-based auth with cookie binding (4 h expiry)
- Optional STRICT_SESSION_BINDING (IP + User-Agent validation)
- CSRF token protection on all mutating endpoints
- File-based rate limiting (5 attempts → 15 min lockout, per IP)
- Persistent rate limits and sessions across restarts
- TOTP two-factor authentication with recovery codes
- Audit logging to `DATA_DIR/audit.log`
- Security headers: CSP, X-Frame-Options, X-Content-Type-Options, etc.
- CSP without `unsafe-eval` in production

#### Infrastructure
- Docker + Docker Compose for local and production deployments
- Nginx reverse proxy with Let's Encrypt SSL (prod compose)
- Optional Redis session store
- Automated S3-compatible backup service
- PM2-ready (`ecosystem.config.js`)
- GitHub Actions CI (lint + test)

#### UI / UX
- Design system: white mode, orange accent (`#FF6B35`), CSS custom properties
- Phase 1–3 UI overhaul: sidebar redesign, chat bubbles, sessions sidebar
- ErrorBoundary component wrapping dashboard layout
- Skeleton loaders, connection status indicator (Live / Connecting / Offline)
- Agent presence & typing indicators
- Session rename and delete
- Real-time status page (gateway health, agent list)

#### Developer Experience
- Jest + Testing Library (86 tests)
- `CONTRIBUTING.md` with development setup guide
- MIT license

### Fixed
- Group sessions appearing twice on refresh
- localStorage race condition on mount
- WS reconnect loop on timeout
- Stale async updates when switching sessions rapidly
- History display filtering out injected group context messages
- `normalizeMessageContent` for `{type, text}` object payloads

[Unreleased]: https://github.com/e-cesar9/claos-dashboard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/e-cesar9/claos-dashboard/releases/tag/v0.1.0
