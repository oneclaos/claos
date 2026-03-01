# Module: API Routes (`app/api/`)

## Rôle

Next.js App Router API route handlers — the server-side HTTP interface between the React frontend and the gateway library, filesystem, terminal, and auth subsystems.

## Route Inventory

### Auth

| Route            | Method | Auth     | CSRF | Role                                                    |
| ---------------- | ------ | -------- | ---- | ------------------------------------------------------- |
| `/api/auth`      | GET    | —        | —    | Check session, return `{ authenticated }`               |
| `/api/auth`      | POST   | —        | —    | Login (password + optional TOTP), create session cookie |
| `/api/auth`      | DELETE | Required | —    | Logout, clear session cookie                            |
| `/api/auth/totp` | GET    | Required | —    | Get TOTP setup (QR code)                                |
| `/api/auth/totp` | POST   | Required | —    | Verify TOTP code                                        |

### Chat

| Route                | Method | Auth     | CSRF                           | Role                                   |
| -------------------- | ------ | -------- | ------------------------------ | -------------------------------------- |
| `/api/chat/stream`   | POST   | Required | Required (self-validates HMAC) | SSE streaming chat — gateway → browser |
| `/api/chat/route`    | POST   | Required | —                              | Non-streaming send (legacy)            |
| `/api/chat/sessions` | GET    | Required | —                              | (Alias for /api/sessions)              |
| `/api/chat/history`  | GET    | Required | —                              | Session history (alias)                |
| `/api/chat/warmup`   | GET    | Required | —                              | Pre-connect gateway WS clients         |

### Sessions

| Route                        | Method | Auth     | CSRF     | Role                                    |
| ---------------------------- | ------ | -------- | -------- | --------------------------------------- |
| `/api/sessions`              | GET    | Required | —        | List all sessions across all gateways   |
| `/api/sessions/send`         | POST   | Required | Required | Send message to session (non-streaming) |
| `/api/sessions/spawn`        | POST   | Required | Required | Spawn a new agent session               |
| `/api/sessions/history`      | GET    | Required | —        | Fetch message history for a session     |
| `/api/sessions/rename`       | POST   | Required | Required | Rename a session                        |
| `/api/sessions/cleanup`      | POST   | Required | —        | Delete/hide sessions                    |
| `/api/sessions/[sessionKey]` | DELETE | Required | —        | Delete a specific session               |

### Files

| Route                 | Method | Auth     | CSRF     | Role                    |
| --------------------- | ------ | -------- | -------- | ----------------------- |
| `/api/files`          | GET    | Required | —        | List directory contents |
| `/api/files/read`     | GET    | Required | —        | Read file content       |
| `/api/files/write`    | POST   | Required | Required | Write file content      |
| `/api/files/create`   | POST   | Required | Required | Create file/directory   |
| `/api/files/delete`   | POST   | Required | Required | Delete file/directory   |
| `/api/files/move`     | POST   | Required | Required | Move/rename file        |
| `/api/files/download` | GET    | Required | —        | Stream file download    |

### Terminal

| Route                       | Method | Auth     | CSRF     | Role                     |
| --------------------------- | ------ | -------- | -------- | ------------------------ |
| `/api/terminal`             | GET    | Required | —        | List PTY sessions        |
| `/api/terminal`             | POST   | Required | Required | Create new PTY session   |
| `/api/terminal/[id]`        | DELETE | Required | Required | Destroy PTY session      |
| `/api/terminal/[id]/stream` | GET    | Required | —        | SSE stream of PTY output |
| `/api/terminal/[id]/write`  | POST   | Required | Required | Send input to PTY        |
| `/api/terminal/[id]/resize` | POST   | Required | Required | Resize PTY               |

### Groups

| Route                      | Method | Auth     | CSRF     | Role                                  |
| -------------------------- | ------ | -------- | -------- | ------------------------------------- |
| `/api/groups`              | GET    | Required | —        | List agent groups                     |
| `/api/groups`              | POST   | Required | Required | Create agent group                    |
| `/api/groups/[id]`         | GET    | Required | —        | Get group details                     |
| `/api/groups/[id]`         | PUT    | Required | Required | Update group                          |
| `/api/groups/[id]`         | DELETE | Required | Required | Delete group                          |
| `/api/groups/[id]/message` | POST   | Required | —        | Send message to group (non-streaming) |

### Gateway & Agents

| Route                  | Method | Auth     | CSRF     | Role                          |
| ---------------------- | ------ | -------- | -------- | ----------------------------- |
| `/api/gateways`        | GET    | Required | —        | List all gateways with status |
| `/api/gateways`        | POST   | Required | Required | Add custom gateway            |
| `/api/agents`          | GET    | Required | —        | List available agents         |
| `/api/agents/discover` | POST   | Required | —        | Re-run gateway discovery      |

### System

| Route                    | Method   | Auth     | CSRF     | Role                             |
| ------------------------ | -------- | -------- | -------- | -------------------------------- |
| `/api/health`            | GET      | —        | —        | Health check (no auth)           |
| `/api/first-run`         | GET/POST | —        | —        | First-run setup wizard           |
| `/api/setup/pair`        | POST     | Required | —        | Auto-pair gateway                |
| `/api/settings/password` | POST     | Required | Required | Change password                  |
| `/api/csp-report`        | POST     | —        | —        | CSP violation reporting endpoint |

## Risques Communs

1. **Inconsistent CSRF enforcement** — routes like `/api/groups/[id]/message` (POST) are not in the middleware `csrfProtectedRoutes` list and don't appear to self-validate CSRF. The middleware pre-check only covers `/api/groups` (prefix match), but `/api/groups/[id]/message` is a different path.

2. **File API uses direct `fs` access** — all file routes directly import `fs` and operate on the host filesystem. Path traversal is blocked by `lib/validation.ts` `safePathSchema`, but the path is also resolved via `fs.realpath()` and checked against `ALLOWED_BASE_PATHS`. Symlink resolution happens but must be consistently applied across all file endpoints.

3. **Groups `[id]/message` route is non-streaming** — it calls `sendGroupMessage()` which blocks until all agents respond (up to 2 minutes). This can exhaust the Next.js serverless function timeout in some deployment environments.

4. **No rate limiting on non-auth routes** — rate limiting is only applied to `/api/auth` (login attempts). Other routes (e.g., `/api/chat/stream`, `/api/terminal`, `/api/files`) have no per-client rate limits.

## Architecture Improvements

- **Centralize auth middleware** — create a `withAuth(handler)` wrapper that handles session validation, CSRF check, and error response formatting, reducing boilerplate across all 30+ routes.
- **Add rate limiting to chat/terminal routes** — token bucket per session to prevent abuse.
- **Make group message route streaming** — return an SSE stream instead of blocking for 2 minutes.
- **Audit CSRF coverage** — programmatically verify that every POST/PUT/DELETE route either (a) is in `csrfProtectedRoutes` or (b) self-validates CSRF.
