# 01 — Dependency Graph

> Cross-module dependency matrix and critical nodes.

---

## Import Graph (directed, by logical module)

```
server/index.js
  └── server/gateway-ws-proxy.js
        └── [filesystem: sessions.json]    ← ⚠️ BYPASS of lib/auth.ts

middleware.ts
  └── next/server (Edge Runtime only — no Node.js imports)

app/api/auth/route.ts
  └── lib/auth.ts
  └── lib/audit.ts
  └── lib/constants.ts

app/api/auth/totp/route.ts
  └── lib/auth.ts
  └── lib/totp.ts

app/api/chat/stream/route.ts
  └── lib/auth.ts
  └── lib/gateway/chat-client.ts  ← uses getGatewayClient
  └── lib/constants.ts

app/api/sessions/route.ts
  └── lib/auth.ts
  └── lib/gateway/sessions.ts  ← uses listAllSessions
  └── lib/session-utils.ts

app/api/sessions/send/route.ts
  └── lib/auth.ts
  └── lib/gateway/sessions.ts  ← sendToSession
  └── lib/validation.ts
  └── lib/audit.ts

app/api/sessions/spawn/route.ts
  └── lib/auth.ts
  └── lib/gateway/sessions.ts  ← spawnSession
  └── lib/gateway/registry.ts

app/api/sessions/history/route.ts
  └── lib/auth.ts
  └── lib/gateway/sessions.ts  ← getSessionHistory

app/api/gateways/route.ts
  └── lib/auth.ts
  └── lib/gateway/registry.ts  ← getAllGateways / getCachedGateways

app/api/agents/route.ts
  └── lib/auth.ts
  └── lib/gateway/agents.ts  ← getAvailableAgents

app/api/agents/discover/route.ts
  └── lib/auth.ts
  └── lib/gateway/agents.ts

app/api/files/route.ts
  app/api/files/read/route.ts
  app/api/files/write/route.ts
  app/api/files/create/route.ts
  app/api/files/delete/route.ts
  app/api/files/move/route.ts
  app/api/files/download/route.ts
  └── lib/auth.ts
  └── lib/validation.ts
  └── lib/audit.ts
  └── [fs module: direct filesystem access]

app/api/terminal/route.ts
  app/api/terminal/[id]/*
  └── lib/auth.ts
  └── lib/terminal/pty-manager.ts
  └── lib/constants.ts

app/api/groups/route.ts
  app/api/groups/[id]/route.ts
  app/api/groups/[id]/message/route.ts
  └── lib/auth.ts
  └── lib/groups.ts
  └── lib/validation.ts

app/api/setup/pair/route.ts
  └── lib/auth.ts
  └── lib/gateway/auto-pair.ts
  └── lib/gateway/config.ts

app/api/settings/password/route.ts
  └── lib/auth.ts

app/api/health/route.ts
  └── [no auth required]

lib/gateway/index.ts (barrel)
  ├── lib/gateway/types.ts
  ├── lib/gateway/discovery.ts
  ├── lib/gateway/circuit-breaker.ts
  ├── lib/gateway/http-client.ts
  ├── lib/gateway/errors.ts
  ├── lib/gateway/ws-client.ts
  ├── lib/gateway/chat-client.ts
  ├── lib/gateway/sessions.ts
  ├── lib/gateway/registry.ts
  └── lib/gateway/agents.ts

lib/gateway/registry.ts
  ├── lib/gateway/chat-client.ts  ← parseGatewaysConfig
  ├── lib/gateway/discovery.ts    ← discoverGateways
  └── lib/gateway/config.ts       ← getCustomGateways

lib/gateway/chat-client.ts
  └── lib/gateway/ws-client.ts
  └── lib/gateway/errors.ts
  └── lib/gateway/registry.ts    ← dynamic import (circular ref managed via lazy import)

lib/gateway/ws-client.ts
  └── ws (node_modules)
  └── crypto (Node.js)
  └── events (Node.js)
  └── lib/gateway/errors.ts

lib/gateway/sessions.ts
  └── lib/gateway/chat-client.ts
  └── lib/gateway/registry.ts
  └── crypto (Node.js)

lib/gateway/agents.ts
  └── lib/gateway/discovery.ts
  └── lib/gateway/http-client.ts

lib/gateway/auto-pair.ts
  └── lib/gateway/config.ts
  └── [filesystem: /home/*/  .clawdbot/, .openclaw/ config files]

lib/gateway/discovery.ts
  └── lib/gateway/types.ts
  └── [fetch: localhost port scan]

lib/gateway/http-client.ts
  └── lib/gateway/circuit-breaker.ts
  └── lib/gateway/types.ts

lib/gateway/circuit-breaker.ts
  └── lib/gateway/types.ts

lib/groups.ts
  └── lib/gateway.ts  ← ⚠️ imports sendMessage + getGateways (not the index barrel)
  └── lib/utils.ts
  └── lib/audit.ts
  └── lib/types.ts
  └── lib/constants.ts

lib/auth.ts
  └── next/headers
  └── fs (Node.js)
  └── crypto (Node.js)
  └── bcrypt
  └── lib/constants.ts

context/chat-context.tsx
  └── lib/types.ts
  └── react

context/tab-context.tsx
  └── lib/tab-types.ts
  └── react

context/terminal-context.tsx
  └── lib/csrf-client.ts
  └── react

context/notification-context.tsx
  └── hooks/useTabNotifications.ts
  └── react

context/agent-ui-control-context.tsx
  └── lib/constants.ts
  └── react

hooks/useGatewayWs.ts
  └── react
  └── [Browser WebSocket API]

hooks/useChatWs.ts
  └── hooks/useGatewayWs.ts

hooks/useMessageSender.ts
  └── context/chat-context.tsx
  └── context/tab-context.tsx
  └── context/notification-context.tsx
  └── lib/csrf-client.ts
  └── lib/types.ts
  └── lib/session-utils.ts
  └── hooks/useChatWs.ts

hooks/useSessionLoader.ts
  └── context/chat-context.tsx
  └── lib/types.ts

hooks/useTabNotifications.ts
  └── context/tab-context.tsx  ← markTabUnread

hooks/useTabKeyboard.ts
  └── context/tab-context.tsx
```

---

## Critical Nodes (high fan-in)

| Node | Type | Depended on by |
|------|------|---------------|
| `lib/auth.ts` | Library | ALL API routes (9+), middleware, gateway-ws-proxy |
| `lib/gateway/chat-client.ts` | Library | stream route, sessions routes, status, gateways, registry (lazy) |
| `lib/gateway/registry.ts` | Library | sessions, agents, gateways, spawn, chat-client (lazy circular) |
| `context/chat-context.tsx` | Context | useMessageSender, useSessionLoader, ChatSection, conversation-list |
| `lib/types.ts` | Types | ~20 files across context, hooks, components, API |
| `lib/validation.ts` | Library | files API (6 routes), sessions API, groups API |
| `lib/constants.ts` | Config | 8 library and context files |

---

## Circular Dependency (managed)

```
lib/gateway/registry.ts
    imports (dynamic, lazy): lib/gateway/chat-client.ts
lib/gateway/chat-client.ts
    imports (dynamic, lazy): lib/gateway/registry.ts

→ Resolved via dynamic import() inside getGatewayClient()
→ This is intentional and documented in chat-client.ts
→ RISK: if both are synchronously required at cold start before either
  module is fully initialized, dynamic import avoids the circular issue.
```

---

## External Dependencies Summary

| Package | Usage | Risk |
|---------|-------|------|
| `ws` | Server-side gateway WS client + proxy | Low — stable |
| `node-pty` | PTY terminal sessions | Medium — native addon, build fragility |
| `bcrypt` | Password hashing | Low — stable |
| `ioredis` | Optional Redis session store | Low — optional path |
| `otplib` | TOTP 2FA | Low — stable |
| `zod` v4 | Input validation everywhere | Low — stable |
| `react-markdown` + `rehype-highlight` | Chat message rendering | Low |
| `xterm` | Terminal UI | Low — stable |
| `next` 16.1.6 | Framework | Medium — pinned to specific version |
| `@radix-ui/*` | UI primitives | Low — headless, stable |
| `lucide-react` | Icons | Low |
