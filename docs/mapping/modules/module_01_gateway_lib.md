# Module: Gateway Library (`lib/gateway/`)

## Rôle
Core server-side library that manages authenticated WebSocket connections to AI agent gateways (Clawdbot and OpenClaw protocols), with auto-discovery, circuit breaking, and a connection pool.

## Responsabilités principales
- **WS client** (`ws-client.ts`): Implements the Clawdbot/OpenClaw WS protocol v3 — challenge/connect handshake, streaming agent events, request/response correlation, keepalive pings, exponential reconnect
- **Connection pool** (`chat-client.ts`): Maintains one `GatewayWsClient` per gatewayId; auto-detects protocol type; handles reconnect lifecycle and pool cleanup
- **Registry** (`registry.ts`): Single source of truth for all gateways — merges static config (`GATEWAYS` env), discovered gateways, and custom gateways; 90s TTL cache with background refresh
- **Discovery** (`discovery.ts`): Probes localhost ports 18750–18810 (configurable); identifies Clawdbot (HTML) and OpenClaw (JSON) gateways; 30s cache
- **Sessions** (`sessions.ts`): `listSessions`, `listAllSessions`, `getSessionHistory`, `sendToSession`, `spawnSession`, `sendMessage` — all via WS requests
- **Circuit breaker** (`circuit-breaker.ts`): Per-gateway failure counter; opens circuit after 5 failures; auto-resets after 60s; exponential backoff retry with jitter
- **HTTP client** (`http-client.ts`): Fallback HTTP path for health checks and OpenAI-compatible send; uses circuit breaker
- **Agents** (`agents.ts`): Maps discovered gateways to Agent objects with emoji avatars
- **Auto-pair** (`auto-pair.ts`): First-run wizard — scans ports 18700–18799, reads `/home/*/  .clawdbot/clawdbot.json` config files, auto-saves token if readable
- **Errors** (`errors.ts`): Typed `GatewayErrorCode` enum + `GatewayError` class with `retryable` flag; `toGatewayError()` normalizer
- **Config** (`config.ts`): Custom gateways persistence (`DATA_DIR/gateways.json`) — add/remove without restart

## Dépendances internes
- `lib/gateway/types.ts` — shared types and constants (thresholds, TTLs)
- `lib/gateway/errors.ts` — all modules import for structured error handling

## Dépendances externes
- `ws` v8 — WebSocket client (Node.js server-side only)
- `crypto` (Node.js built-in) — `randomUUID`, `randomBytes`
- `events` (Node.js built-in) — `EventEmitter` base for `GatewayWsClient`
- `fs` (Node.js built-in) — auto-pair config file reading, custom gateway persistence
- `fetch` (Node.js built-in) — discovery port probing, HTTP client

## Ce qui dépend de lui
- `app/api/chat/stream/route.ts` — `getGatewayClient`
- `app/api/sessions/*` — `listAllSessions`, `listSessions`, `getSessionHistory`, `sendToSession`, `spawnSession`
- `app/api/gateways/route.ts` — `getAllGateways`, `getCachedGateways`
- `app/api/agents/*` — `getAvailableAgents`, `listGatewaysWithStatus`
- `app/api/setup/pair/route.ts` — `scanAndAutoPair`, `addCustomGateway`
- `lib/groups.ts` — `sendMessage`, `getGateways` (via `lib/gateway.ts` re-export)
- `server/gateway-ws-proxy.js` — reads GATEWAYS env (does NOT import this module)

## Flux de données entrants
- `GATEWAYS` environment variable (JSON array of GatewayConfig)
- HTTP responses from gateway ports (discovery probing)
- WebSocket frames from gateways (events, responses)
- Auth tokens from config files (auto-pair)

## Flux de données sortants
- `GatewayWsClient` instances in the connection pool
- Session lists, message history, send confirmations
- Gateway configs (to registry consumers)
- `GatewayError` typed errors (to API routes)

## Risques / Couplages forts

1. **Circular dependency between `chat-client.ts` and `registry.ts`** — `chat-client.ts` dynamically imports `registry.ts` inside `getGatewayClient()` to avoid the cycle. This works but is fragile; a synchronous code path that triggers both modules simultaneously before full initialization could cause `undefined` imports.

2. **Discovery probes 60 ports on every cache miss** — 60 concurrent `fetch()` calls with 150ms timeout each. Under a VPS with many open ports or under load, this scan adds latency and can generate spurious errors in server logs. No abort controller for the entire batch.

3. **`parseGatewaysConfig()` exists in both `chat-client.ts` AND `discovery.ts`** — both parse `process.env.GATEWAYS` independently. If the parsing logic diverges, the two modules can disagree on which gateways exist.

4. **Circuit breaker state is process-scoped in-memory** — it resets on process restart and is not shared across multiple Node.js workers. Under PM2 cluster mode, each worker has independent circuit state.

5. **`auto-pair.ts` reads arbitrary home directories** — it iterates `/home/*` to find config files. Permission errors are caught silently, but this scan happens on the first-run pairing flow and should be tightly scoped.

6. **Protocol auto-detection tries `clawdbot` first, then falls back to `openclaw`** — this means every new `openclaw`-only gateway incurs one failed connection attempt before succeeding. Detected types are cached in `detectedTypes` Map (process lifetime).

## Suggestions d'amélioration architecturale
- **Merge `parseGatewaysConfig()`** into a single location (e.g., `config.ts`) imported by both modules.
- **Extract the circular dependency** by having `chat-client.ts` accept a `GatewayConfig` parameter directly instead of looking it up from the registry. The caller (API route) already has the config.
- **Add a discovery timeout per batch** using `Promise.allSettled` + `AbortController` with a 5s total cap to prevent slow VPS port scans from delaying gateway list responses.
- **Persist circuit breaker state** to a lightweight store (or at least expose metrics) so operators can observe the state.
