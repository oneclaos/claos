# Module: Auth (`lib/auth.ts`)

## Rôle
Handles all server-side authentication: session creation/validation, password hashing (bcrypt), CSRF token generation/validation, rate limiting, and persistent config management — backed by the local filesystem.

## Responsabilités principales
- **Session management**: `createSession`, `validateSession`, `deleteSession`, `rotateSession`, `getSessionInfo` — backed by `DATA_DIR/sessions.json` with 5s in-memory cache
- **Password hashing**: `hashPassword` / `verifyPassword` using bcrypt (12 rounds)
- **Config management**: `getPasswordHash`, `setPasswordHash`, `isFirstRun` — reads/writes `DATA_DIR/config.json` with 30s cache; config takes precedence over env var
- **CSRF tokens**: `generateCsrfToken` (HMAC-SHA256, 48 hex chars, timestamp-embedded), `validateCsrfToken` (timing-safe comparison, 4h expiry)
- **Rate limiting**: `checkRateLimit`, `recordLoginAttempt` — per-IP counter with 5-attempt threshold, 15-minute lockout; persisted to `DATA_DIR/rate-limits.json` with 2s cache
- **Cookie management**: `getSessionFromCookies`, `setSessionCookie`, `clearSessionCookie` — uses Next.js `cookies()` API; httpOnly, strict SameSite, secure in production
- **CSRF secret**: Auto-generated on first call if not in env (`CSRF_SECRET`) or config; persisted to `DATA_DIR/config.json`

## Dépendances internes
- `lib/constants.ts` — `SESSION_COOKIE` constant

## Dépendances externes
- `next/headers` — `cookies()` API for cookie management
- `fs` (Node.js) — file I/O for sessions, config, rate limits
- `crypto` (Node.js) — `randomBytes`, `createHash`, `timingSafeEqual`
- `bcrypt` — password hashing

## Ce qui dépend de lui
- **Every API route** (9+ route handlers) — session validation on each request
- `middleware.ts` — CSRF token format pre-check (not full HMAC, just regex)
- `app/api/chat/stream/route.ts` — full CSRF validation
- `app/api/auth/route.ts` — login, logout, session check
- `app/api/settings/password/route.ts` — password change

## Flux de données entrants
- HTTP cookies (session token)
- `x-csrf-token` request header
- Login credentials (password string)
- IP address + User-Agent (from request headers)

## Flux de données sortants
- Session tokens (hex, 64 chars)
- CSRF tokens (`timestamp.signature` format)
- Validated session data (IP, UA, expiry)
- Rate limit decisions (`{ allowed, retryAfter }`)

## Risques / Couplages forts

1. **Parallel session implementations** — `lib/auth.ts` AND `lib/session-store.ts` both implement file-based session storage. `lib/auth.ts` is the active implementation. `lib/session-store.ts` exists with a Redis path but is NOT imported by `lib/auth.ts`. This creates confusion about which is canonical and makes the Redis upgrade path unclear.

2. **Blocking I/O on hot path** — `loadSessions()` calls `readFileSync` on every request where the 5s cache has expired. Under concurrent requests, multiple reads can execute simultaneously. The write path uses async `fsPromises.writeFile` (fire-and-forget) which is better, but the read path is still synchronous.

3. **`gateway-ws-proxy.js` bypasses this module** — the WS proxy reads `sessions.json` directly from the filesystem using its own `loadSessions()` function. If the session file path (`DATA_DIR`) changes, or if Redis is enabled, the proxy silently stops validating sessions correctly.

4. **CSRF secret generated at module load time** — `const CSRF_SECRET = loadOrCreateCsrfSecret()` runs synchronously when the module is first imported. If the data directory is unavailable at startup, the secret generation silently falls back to a new in-memory value — causing CSRF validation to fail for all existing tokens.

5. **Sessions file is not atomic** — `saveSessions` uses `fsPromises.writeFile` (not atomic rename). Under a crash during write, the file can be corrupted. `loadSessions()` falls back to an empty store on parse errors, which is safe but silently invalidates all active sessions.

6. **Rate limit cleanup is on-save only** — old rate limit entries (>1 hour) are cleaned when `saveRateLimits` is called. Under low login activity, stale entries accumulate indefinitely.

## Suggestions d'amélioration architecturale
- **Consolidate session implementations** — deprecate `lib/session-store.ts`, add the Redis path directly into `lib/auth.ts` with an environment-based factory (`REDIS_URL` → Redis, default → file).
- **Atomic session file writes** — write to a temp file and rename atomically to prevent corruption.
- **Share session validation with `gateway-ws-proxy.js`** — expose a simple `validateToken(token): boolean` that the proxy can call via a lightweight internal HTTP endpoint (`/api/auth/validate`) to avoid filesystem coupling.
- **Consider async read** — replace `readFileSync` in `loadSessions()` with async reads + a short lock (or use a proper in-memory store like a Map with periodic async flush).
