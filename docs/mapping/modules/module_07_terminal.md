# Module: Terminal (`lib/terminal/pty-manager.ts` + `app/api/terminal/` + `components/terminal/terminal.tsx`)

## Rôle

Provides an embedded interactive shell in the dashboard by creating real PTY processes on the host, streaming output via SSE, and accepting input via POST — with security constraints (env whitelist, session cap, idle cleanup).

## Responsabilités principales

### `lib/terminal/pty-manager.ts` (PTYManager singleton)

- `createSession(id)`: spawns `/bin/bash` via `node-pty` with a whitelisted environment (only 13 safe env vars — explicitly excludes GATEWAY_TOKEN, CSRF_SECRET, CLAOS_PASSWORD_HASH, etc.)
- `write(id, data)`: forwards input data to PTY
- `resize(id, cols, rows)`: adjusts PTY dimensions
- `destroySession(id)`: kills PTY process and removes all EventEmitter listeners
- `listSessions()`: returns session metadata for status display
- **Idle cleanup**: `setInterval` every 5 minutes destroys sessions inactive >30 minutes
- **Session cap**: max 20 simultaneous sessions; rejects (not silently kills) when exceeded

### `app/api/terminal/` routes

- `POST /api/terminal` — creates session, returns `{ sessionId }`
- `GET /api/terminal/[id]/stream` — SSE stream of PTY output
- `POST /api/terminal/[id]/write` — sends input to PTY
- `POST /api/terminal/[id]/resize` — resizes PTY
- `DELETE /api/terminal/[id]` — destroys session
- All routes validate session cookie; write/resize/delete routes validate CSRF

### `context/terminal-context.tsx`

- Manages `TerminalWindow` objects (UI state: minimized, dead flag)
- `createTerminal()`: calls `POST /api/terminal`, adds window
- `closeTerminal(windowId, sessionId)`: calls `DELETE /api/terminal`, removes window
- `markDead(windowId)`: marks terminal as dead (PTY exited) for UI feedback
- `toggleMinimize(windowId)`: show/hide the xterm.js panel

### `components/terminal/terminal.tsx`

- Renders `xterm.js` Terminal with FitAddon and WebLinksAddon
- Connects to SSE stream for PTY output
- Sends keystrokes to `/api/terminal/[id]/write`
- Handles resize events via ResizeObserver

## Dépendances internes

- `lib/auth.ts` — session validation in all terminal API routes
- `lib/csrf-client.ts` — CSRF token for write/delete operations in TerminalContext
- `lib/constants.ts` — `RATE_LIMITS.TERMINAL_MAX_SESSIONS`

## Dépendances externes

- `node-pty` ^1.1.0 — native PTY spawning
- `xterm` ^5.3.0 — browser terminal emulator
- `xterm-addon-fit` — responsive resize
- `xterm-addon-web-links` — clickable URLs
- `events` (Node.js) — `EventEmitter` for PTY output relay

## Ce qui dépend de lui

- `app/(dashboard)/terminal/page.tsx` — renders `TerminalView`
- `components/views/TerminalView.tsx` — wraps `terminal.tsx` + TerminalContext

## Flux de données entrants

- Keyboard input from browser → `POST /api/terminal/[id]/write`
- Resize events (ResizeObserver) → `POST /api/terminal/[id]/resize`
- PTY process output → EventEmitter `data` events → SSE stream

## Flux de données sortants

- PTY output as SSE events to browser
- `TerminalWindow` state to TerminalContext consumers

## Risques / Couplages forts

1. **Full host shell access** — the terminal gives authenticated users a real bash shell as the process user (no sandboxing beyond the whitelisted env). If auth is bypassed (see gateway-ws-proxy risks), an attacker gets shell access. This is intentional for a self-hosted tool but must be clearly documented.

2. **`node-pty` is a native addon** — requires compilation at build time (`pty.node` binary). The build script manually copies it to the standalone output. If the binary is missing or built for the wrong architecture/Node version, the terminal silently fails to load (undefined reference to `pty.spawn`).

3. **SSE stream has no explicit timeout** — the stream stays open as long as the PTY is alive. If the client disconnects without sending DELETE, the PTY session lingers for up to 30 minutes (idle cleanup). The session cap (20) is a backstop but could be exhausted by abandoned sessions.

4. **EventEmitter.setMaxListeners(20)** — set on the PTY emitter to prevent Node.js warnings. If more than 20 concurrent SSE clients subscribe to the same PTY session (e.g., multiple browser tabs showing the same terminal), events are silently dropped after 20 listeners.

5. **TerminalContext `creating` flag is a single boolean** — if two calls to `createTerminal()` race (e.g., double-click), both can proceed because the `creating` flag is set and cleared in the same async chain without a lock.

## Architecture Improvements

- **Sandbox the PTY** — run the shell in a restricted user or Docker container to prevent privilege escalation.
- **Add SSE stream timeout** — automatically close the SSE stream and send an `exit` event after 5 minutes of no activity.
- **Deduplicate PTY sessions** — if the user already has an active session with the same `sessionId`, return the existing one instead of creating a new SSE stream.
- **Fix `creating` race** — use a ref-based mutex or debounce the create button.
