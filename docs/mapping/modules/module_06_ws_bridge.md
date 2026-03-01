# Module: WebSocket Bridge (`server/gateway-ws-proxy.js` + `server/index.js`)

## Rôle

Custom Node.js server layer that intercepts HTTP upgrades for `/api/gateway/ws`, maintains a pool of upstream gateway WebSocket connections, and proxies frames bidirectionally between browser clients and AI agent gateways.

## Responsabilités principales

### `server/index.js`

- Loads `.env.local` manually before starting Next.js (env must be available before any module)
- Patches `http.createServer` to intercept the HTTP server instance and attach WS upgrade handler before Next.js registers its own
- Creates a `WebSocketServer` (`noServer: true`) and registers `handleBrowserWs` for each connection
- Installs global `unhandledRejection` and `uncaughtException` handlers (non-fatal for known client-abort errors)
- Handles `SIGTERM` gracefully (5s deadline, closes WS server + connections, then exits)
- Boots the Next.js standalone server (`require('.next/standalone/server.js')`)

### `server/gateway-ws-proxy.js` (`UpstreamConnection` class)

- One `UpstreamConnection` per `gatewayId` — shared across all browser clients for that gateway
- Implements the Clawdbot/OpenClaw WS auth handshake (`connect.challenge` → `connect` → `hello-ok`)
- Sends keepalive pings every 20s
- Auto-reconnects with exponential backoff (1s → 30s) as long as any browser client is still connected
- Broadcasts upstream gateway frames to all registered browser clients (`_broadcast`)
- Sends internal `__bridge__` events to browser clients on connect/disconnect/error state changes
- Cleans up upstream connection when last browser client disconnects
- **Validates session cookie** by directly reading `DATA_DIR/sessions.json` (bypasses `lib/auth.ts`)

## Dépendances internes

- **None** — plain JS file cannot import TypeScript modules
- Reads `process.env.GATEWAYS` directly (mirrors `parseGatewaysConfig()`)
- Reads filesystem `sessions.json` directly (mirrors `lib/auth.ts` session validation)

## Dépendances externes

- `ws` (node_modules)
- `crypto` (Node.js)
- `fs` (Node.js)
- `path` (Node.js)
- `http` (Node.js — `http.createServer` monkey-patching)

## Ce qui dépend de lui

- `hooks/useGatewayWs.ts` — browser WebSocket client connects to `/api/gateway/ws`
- `hooks/useChatWs.ts` — uses `useGatewayWs` for streaming chat

## Flux de données entrants

- Browser WS connections (`wss://host/api/gateway/ws?gatewayId=X`)
- Session cookie from HTTP request headers
- `GATEWAYS` env variable for upstream gateway config
- Upstream gateway WS frames (`agent` events, `res` frames)

## Flux de données sortants

- Upstream `req` frames (browser → gateway)
- Gateway events broadcast to browser clients (gateway → browser, N:1 fan-out)
- `__bridge__` events: `gateway_connected`, `gateway_disconnected`, `gateway_connecting`, `error`

## Risques / Couplages forts

1. **Direct filesystem session validation** — `gateway-ws-proxy.js` reads `sessions.json` directly with its own `loadSessions()` function. This hardcodes:
   - The `SESSION_COOKIE` name (`claos_session`)
   - The `DATA_DIR` path (`$HOME/.claos`)
   - The session file path (`sessions.json`)
   - The session validation logic (`expiresAt < Date.now()`)
     If any of these change in `lib/auth.ts`, the proxy silently accepts or rejects sessions incorrectly. **Redis sessions are NOT supported** — the proxy always reads the file store.

2. **`upstreamPool` is module-level global** — all browser connections share the same pool per process. Under PM2 cluster mode with multiple workers, each worker has its own pool, so the same gateway has N upstream connections (one per worker). This multiplies gateway load by the worker count.

3. **`getUpstreamConnection` has a TOCTOU race** — if two browser clients connect simultaneously for the same `gatewayId`, both may enter the `if (existing && !existing.closed && existing.ready) return existing` check simultaneously (before the first `connect()` completes), leading to two `UpstreamConnection` instances being created for the same gateway. The second one overwrites the pool entry, orphaning the first.

4. **Auth only checks session expiry, not IP/UA** — the proxy's `validateSessionToken()` doesn't implement `STRICT_SESSION_BINDING` even if the env var is set. The `lib/auth.ts` implementation does. This is a behavioural divergence.

5. **`http.createServer` monkey-patching** — modifies a core Node.js API synchronously at module load time. If `server.js` calls `http.createServer` more than once (which the Next.js standalone server does not, but could in a future version), only the first call gets the WS handler. The patch restores the original after the first call, which is a mitigation.

6. **GATEWAYS env parsed in both `gateway-ws-proxy.js` and `lib/gateway/chat-client.ts`** — separate parsing, potential for divergence.

## Architecture Improvements

- **Validate sessions via an internal HTTP call** — add `GET /api/auth/validate?token=X` (not publicly accessible, bound to 127.0.0.1) that the proxy can call. This makes the proxy share the real auth logic regardless of storage backend.
- **Replace monkey-patching** with a proper custom Next.js server entry point that constructs the HTTP server first and passes it to Next.js, eliminating the race/fragility.
- **Add a mutex for `getUpstreamConnection`** — e.g., a `Map<string, Promise>` of in-flight connection attempts to prevent duplicate upstream connections.
- **Consider compiling `gateway-ws-proxy.js` to TypeScript** — this would allow importing from `lib/` and eliminate the drift risk between the proxy and the auth/config modules.
