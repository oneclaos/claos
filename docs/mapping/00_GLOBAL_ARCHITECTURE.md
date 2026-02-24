# 00 — Global Architecture

> Claos Dashboard — Next.js 15 / React 19 / TypeScript
> Mapping produced: 2025-07

---

## 1. Vision Macro

Claos is a **self-hosted, authenticated web dashboard** for managing conversations with one or more AI agent gateways (Clawdbot and OpenClaw protocols). It provides multi-tab chat, a filesystem browser over the host's VFS, an embedded PTY terminal, agent group orchestration, and system status monitoring — all behind a single-user session-cookie auth wall.

The system is a **modular monolith**: one Next.js process handles the HTTP API, SSE streaming, the custom WS proxy bridge, and all React UI. External services are the AI agent gateways (local processes on `localhost:187xx`), optional Redis, and optionally node-pty for shell access.

---

## 2. Architecture Diagram (ASCII)

```
┌─────────────────────────────────────────────────────────────────┐
│  BROWSER                                                        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  React App (Next.js App Router, Client Components)      │    │
│  │                                                         │    │
│  │  Providers (layout.tsx dashboard)                       │    │
│  │  ChatProvider → TabProvider → TerminalProvider          │    │
│  │  NotificationProvider → AgentUIControlProvider          │    │
│  │                                                         │    │
│  │  Pages (app/(dashboard)/)                               │    │
│  │  DashboardPage → [chat|terminal|files|status|settings]  │    │
│  │                                                         │    │
│  │  Hooks                                                  │    │
│  │  useSessionLoader   useMessageSender                    │    │
│  │  useGatewayWs  ──►  useChatWs                          │    │
│  │         │                                               │    │
│  │         │  wss://.../api/gateway/ws?gatewayId=X         │    │
│  └─────────┼───────────────────────────────────────────────┘    │
└────────────┼────────────────────────────────────────────────────┘
             │ HTTP/WS (authenticated + CSRF)
             │
┌────────────▼────────────────────────────────────────────────────┐
│  NEXT.JS PROCESS  (server/index.js → .next/standalone)         │
│                                                                  │
│  middleware.ts  (Edge Runtime)                                   │
│  ├── Auth check (session cookie)                                 │
│  ├── CSRF validation (POST/PUT/DELETE)                           │
│  └── CSP nonce + security headers                                │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  API Routes (app/api/)                                    │   │
│  │  /auth  /sessions  /chat/stream  /files/*  /terminal/*   │   │
│  │  /groups  /gateways  /agents  /setup/pair  /health        │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  Gateway Library (lib/gateway/)                           │   │
│  │  registry → chat-client → ws-client → GatewayWsClient    │   │
│  │  discovery (port scan 18750-18810)                        │   │
│  │  circuit-breaker, http-client, errors, auto-pair          │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  Custom WS Bridge (server/gateway-ws-proxy.js)            │   │
│  │  One upstream WS pool per gatewayId                       │   │
│  │  Relays frames: browser ↔ gateway                         │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  lib/auth.ts — session mgmt, bcrypt, CSRF, rate limiting        │
│  lib/terminal/pty-manager.ts — node-pty sessions                │
│  lib/groups.ts — agent group persistence                        │
│  lib/audit.ts — append-only audit log (rotation)               │
│                                                                  │
└────────────────────────────────────────────┬────────────────────┘
                                             │
              ┌──────────────────────────────┼──────────────────┐
              │                              │                  │
              ▼                              ▼                  ▼
  ┌────────────────────┐      ┌────────────────────┐      ┌──────────┐
  │ Clawdbot Gateway   │      │ OpenClaw Gateway   │      │  Redis   │
  │ localhost:1875x    │      │ localhost:1875y    │      │ (opt.)   │
  │ WS protocol v3     │      │ WS protocol v3     │      │          │
  └────────────────────┘      └────────────────────┘      └──────────┘
```

---

## 3. Strategic Modules (10 most critical)

| # | File | Why Critical |
|---|------|-------------|
| 1 | `middleware.ts` | First line of defence — auth, CSRF, CSP for every request |
| 2 | `server/gateway-ws-proxy.js` | Manages upstream gateway WebSocket pool; failure = no chat |
| 3 | `lib/gateway/ws-client.ts` | Protocol implementation for Clawdbot/OpenClaw — all agent comms |
| 4 | `lib/gateway/chat-client.ts` | Connection pool manager; handles auto-detection and reconnects |
| 5 | `lib/gateway/registry.ts` | Single source of truth for all gateway configs; feeds all API routes |
| 6 | `lib/auth.ts` | Session creation/validation, CSRF generation, bcrypt, rate limiting |
| 7 | `context/chat-context.tsx` | Entire chat state + localStorage persistence across page navigation |
| 8 | `hooks/useMessageSender.ts` | Orchestrates message sending (WS + SSE fallback, queuing, groups) |
| 9 | `app/api/chat/stream/route.ts` | SSE streaming endpoint — primary chat data path |
| 10 | `lib/terminal/pty-manager.ts` | PTY session lifecycle; singleton with 30-min cleanup |

---

## 4. Fragility Points

1. **`gateway-ws-proxy.js` reads `sessions.json` directly** — bypasses `lib/auth.ts` abstraction. If the session file path changes or Redis is enabled, the WS proxy silently stops authenticating properly.

2. **`useMessageSender` is a 500+ line god hook** — handles input state, image compression, file selection, SSE streaming, WS streaming, multi-gateway group rounds, retries, notifications, and message queuing. A bug here can cause cascading failures across all chat flows.

3. **`lib/auth.ts` and `lib/session-store.ts` are parallel implementations** — both implement file-based session storage; `auth.ts` is the live one but `session-store.ts` also exists with a Redis option. The `lib/session-store.ts` is only referenced by `__tests__` (or unused in production), creating maintenance confusion.

4. **`lib/gateway/discovery.ts` probes 60 ports on every cold cache miss** — 60 parallel HTTP requests with 150ms timeout each. Under slow hosts this adds 150ms latency to the first API call after 30s cache expiry.

5. **`lib/groups.ts` uses synchronous blocking I/O** (`readFileSync`/`writeFileSync`) on group operations — can block the Node.js event loop under concurrent requests.

6. **No persistence for WS-proxy upstream pool** — if the Node.js process restarts, all upstream gateway connections are torn down and must be re-established per browser reconnect. This is expected but not communicated to the UI.

---

## 5. Visible Technical Debt

1. **Tab schema v1/v2/v3 accumulation** — `lib/tab-types.ts` defines three versioned Zod schemas but `TabContext` still serializes with `TAB_STORAGE_VERSION = 1`. Migration code from v2/v3 schemas appears dead (not called anywhere in the context).

2. **`gateway.ts` vs `lib/gateway/` directory** — `lib/gateway.ts` is a thin re-export of the `lib/gateway/` module internals, creating an extra indirection layer that leaks `sendMessage`/`getGateways` from `sessions.ts` and `discovery.ts` into `lib/groups.ts` (the groups module imports `gateway.ts` not the gateway directory directly).

3. **`data/agents-registry.json` exists but is unused** — the JSON file at `data/agents-registry.json` is present but not imported anywhere in the TypeScript codebase; agents are discovered dynamically.

4. **CSRF route list in middleware is not exhaustive** — `/api/chat/stream` validates its own CSRF but is not in `csrfProtectedRoutes`. The middleware comment says "keep exhaustive" but the list was not updated when the stream route was added.

5. **`server/gateway-ws-proxy.js` duplicates auth logic** — session cookie name, session file path, and token validation are hardcoded in plain JS, creating drift risk when `lib/auth.ts` or `lib/constants.ts` change.

6. **`lib/session-store.ts` dead code** — `RedisSessionStore` is implemented but `lib/auth.ts` (the primary auth module) does not use it. Redis session support is effectively disabled.

---

## 6. Dependency Matrix (module × module)

```
                   middleware  auth  gateway/  chat-ctx  tab-ctx  terminal  groups  audit
middleware            —         R      —         —         —        —        —       —
lib/auth              —         —      —         —         —        —        —       —
lib/gateway/*         —        (R)     —         —         —        —        W       —
API routes            R         R      R         —         —        R        R       R
chat-context          —         —      —         —         —        —        —       —
tab-context           —         —      —         —         —        —        —       —
useMessageSender      —         R      —         R         R        —        —       —
useSessionLoader      —         —      —         R         —        —        —       —
useChatWs             —         —      —         —         —        —        —       —
useGatewayWs          —         —      —         —         —        —        —       —
gateway-ws-proxy      —        (FS)    R         —         —        —        —       —
server/index.js       —         —      —         —         —        —        —       —
```
R = reads/imports, W = writes, (R) = optional fallback, (FS) = direct filesystem read

---

## 7. Complexity Heatmap (imports/dependents)

| Module | Fan-In (depended on by) | Fan-Out (depends on) | Complexity |
|--------|------------------------|---------------------|-----------|
| `lib/auth.ts` | 9 API routes + middleware + proxy | fs, bcrypt, crypto, constants | 🔴 HIGH |
| `lib/gateway/chat-client.ts` | 5 API routes + stream | ws-client, registry, errors | 🔴 HIGH |
| `lib/gateway/registry.ts` | sessions, agents, gateways API | chat-client, discovery, config | 🟠 MED-HIGH |
| `context/chat-context.tsx` | 4 hooks + 5+ components | lib/types | 🟠 MED-HIGH |
| `hooks/useMessageSender.ts` | ChatSection, chat-input | chat-context, tab-context, notif, csrf, ws | 🔴 HIGH |
| `lib/validation.ts` | 8 API routes | zod | 🟡 MED |
| `lib/types.ts` | ~20 files | — | 🟡 MED |
| `lib/constants.ts` | 8 files | — | 🟢 LOW |
| `lib/audit.ts` | 4 lib files | fs | 🟢 LOW |
| `lib/gateway/ws-client.ts` | chat-client, gateway-ws-proxy | ws, events, errors | 🔴 HIGH |
