# 02 — Data Flow

> Primary data flows, request lifecycle, and state management.

---

## Flow 1: User Sends a Chat Message (Single Agent, WS Path)

```
User types in <ChatInput> → sendMessage()
  │
  ▼
useMessageSender.sendMessage()
  ├── captures input + attachments
  ├── clears input immediately (visual feedback)
  └── checks session queue → sendMessageCore()
        │
        ├── 1. Appends user message to ChatContext messages
        │
        ├── 2. chatWs.state === 'connected'? YES → WS path
        │      │
        │      ▼
        │   useChatWs.streamChat()
        │      │
        │      ▼
        │   useGatewayWs.send('chat.send', { sessionKey, message, idempotencyKey })
        │      │
        │      ▼
        │   Browser WebSocket → wss://.../api/gateway/ws?gatewayId=X
        │      │
        │      ▼
        │   server/gateway-ws-proxy.js (UpstreamConnection pool)
        │      └── upstream.send(frame) → Gateway WS (localhost:1875x)
        │
        │   Gateway processes message, streams back 'agent' events:
        │   { type:'event', event:'agent', payload:{ runId, stream:'assistant', data:{delta} } }
        │   { type:'event', event:'agent', payload:{ runId, stream:'lifecycle', data:{phase:'end'} } }
        │      │
        │      ▼
        │   gateway-ws-proxy._broadcast() → browser WS
        │      │
        │      ▼
        │   useGatewayWs.ws.onmessage → emit('agent', payload)
        │      │
        │      ▼
        │   useChatWs: accumulates deltas → onDelta(delta, accumulated)
        │      │
        │      ▼
        │   useMessageSender: updates ChatContext messages (partial streaming update)
        │      │
        │   on lifecycle.end → onDone(fullText)
        │      │
        │      ▼
        │   ChatContext.setMessages(final) → localStorage.setItem
        │      │
        │      ▼
        │   Tab badge update + browser Notification (if tab inactive)
        │
        └── WS not connected → SSE fallback path (Flow 2)
```

---

## Flow 2: User Sends a Chat Message (SSE Fallback)

```
useMessageSender.sendMessageCore → streamOneGateway()
  │
  ├── fetch('POST /api/chat/stream', { gatewayId, sessionKey, message, idempotencyKey })
  │      headers: Content-Type, x-csrf-token
  │
  ▼
middleware.ts
  ├── validateSession (cookie)
  └── validateCsrfToken (x-csrf-token header format check only)

app/api/chat/stream/route.ts
  ├── validateSession() + validateCsrfToken() (full HMAC check)
  ├── getGatewayClient(gatewayId) → lib/gateway/chat-client.ts
  │      └── GatewayWsClient (Node.js ws, not browser WS)
  ├── registers 'agent' event listener on client
  ├── sends SSE: `: connected`
  ├── starts keepalive pings (15s interval)
  ├── client.request('chat.send', {...}, 30s ACK timeout)
  │
  │   Gateway streams 'agent' events via the SAME WS connection
  │   (shared GatewayWsClient pool in chat-client.ts)
  │
  ├── onAgentEvent:
  │   delta → `data: {"type":"delta","text":"..."}` (SSE)
  │   lifecycle.end → `data: {"type":"done","text":"..."}` (SSE)
  │   error → `data: {"type":"error","error":"..."}` (SSE)
  │
  ▼
Browser receives SSE stream
useMessageSender.attemptStream() reads the ReadableStream
  ├── accumulates text deltas → updates ChatContext messages
  ├── on 'done': saves to localStorage, triggers notifications
  └── on network error: retries up to 3x with exponential backoff
```

---

## Flow 3: Multi-Agent Group Message (Brainstorming)

```
useMessageSender (isGroup === true, gatewayIds: [gwA, gwB])
  │
  ├── Round 1 (sequential):
  │   for each gwId in gatewayIds:
  │     streamOneGateway(gwId, label, csrfToken, priorDialogue, isFollowUp=false)
  │       └── injects GROUP CHAT context header into message
  │       └── waits for full response
  │       └── appends to dialogueLog
  │
  └── Round 2 (follow-up, skip for slash commands):
      for each gwId in gatewayIds:
        streamOneGateway(gwId, label, csrfToken, dialogueLog, isFollowUp=true)
          └── each agent sees other agents' prior responses
```

---

## Flow 4: Session Loading (Page Load / Reconnect)

```
DashboardLayout mounts → ChatProvider + TabProvider wrap DashboardPage

useSessionLoader.useEffect (mount):
  1. Reads localStorage 'claos:sessions' → hydrates localSessionsRef
  2. calls loadSessions()

loadSessions():
  ├── fetch('/api/sessions', timeout 10s)
  │      ↓
  │   api/sessions/route.ts
  │      ├── validateSession
  │      ├── lib/gateway/sessions.ts → listAllSessions()
  │      │     └── getGatewayClient(gatewayId) per gateway → ws 'sessions.list'
  │      └── returns Session[]
  │
  ├── merges server sessions + local virtual sessions + localStorage group index
  ├── deduplicates (gateway:sessionKey key)
  └── saves to ChatContext + localStorage

useSessionLoader.useEffect (auto-restore):
  ├── reads localStorage 'claos:lastSession'
  └── selectSession(restored) → loadHistory(session)

loadHistory(session):
  1. In-memory cache hit? → instant display, return
  2. localStorage 'claos:msgs:<key>'? → display immediately
  3. fetch('/api/sessions/history?gatewayId=...&sessionKey=...')
        └── lib/gateway/sessions.ts → getSessionHistory (WS chat.history)
        └── merge with localStorage cache, update ChatContext.messages
```

---

## Flow 5: Gateway Discovery

```
useSessionLoader.useEffect (gateway fetch with retry):
  fetch('/api/gateways')
     ↓
  api/gateways/route.ts
     └── lib/gateway/registry.ts → getAllGateways()
           ├── cache still warm? → return cached
           └── cache stale:
                 ├── parseGatewaysConfig() → env.GATEWAYS JSON
                 ├── discoverGateways()    → 60 port probes (150ms each, parallel)
                 └── getCustomGateways()  → DATA_DIR/gateways.json
                 merge → deduplicate → cache (90s TTL)

  If gateways found → fetch('/api/chat/warmup')  (pre-connect WS clients)
  Retry with exponential backoff if gateway list is empty (2s, 4s, 8s, max 15s)
```

---

## Flow 6: WebSocket Bridge (Browser ↔ Gateway)

```
useGatewayWs({ gatewayId }) mounts:
  new WebSocket('wss://host/api/gateway/ws?gatewayId=X')
     │
     ▼
server/index.js (HTTP upgrade handler)
  └── wss.handleUpgrade() → server/gateway-ws-proxy.handleBrowserWs(ws, req)
        ├── validates session cookie (reads sessions.json directly from filesystem)
        ├── getUpstreamConnection(gatewayId)
        │     ├── pool hit + ready? → reuse
        │     └── new UpstreamConnection:
        │           new WebSocket(gateway.url)  [Node.js ws]
        │           auth handshake: connect.challenge → connect → hello-ok
        │           startPing() — 20s interval
        │
        ├── upstream.addClient(browserWs)
        ├── sends __bridge__ gateway_connected or gateway_connecting event
        │
        └── relays bidirectionally:
            browser ws.message → upstream.send(frame)
            upstream broadcasts to all browser clients on 'message'
```

---

## Flow 7: Terminal Session

```
TerminalView mounts → useTerminals.createTerminal()
  fetch('POST /api/terminal')
     ↓
  api/terminal/route.ts
     └── lib/terminal/pty-manager.ts → createSession(id)
           └── pty.spawn('/bin/bash', [], { env: SAFE_ENV_WHITELIST })
           returns { sessionId }

components/terminal/terminal.tsx mounts xterm.js Terminal
  fetch('/api/terminal/{id}/stream')  → SSE stream of PTY output
  fetch('POST /api/terminal/{id}/write', { data }) → PTY input
  fetch('POST /api/terminal/{id}/resize', { cols, rows }) → PTY resize

ptyManager cleanup: setInterval every 5min → destroys sessions inactive > 30min
```

---

## State Management Overview

| State | Location | Persistence | TTL / Scope |
|-------|----------|-------------|-------------|
| Sessions list | ChatContext (useState) | localStorage `claos:sessions` | Until manual clear |
| Selected session | ChatContext (useState) | localStorage `claos:lastSession` | Until manual clear |
| Messages per session | ChatContext (useState + ref cache) | localStorage `claos:msgs:<key>` | Until manual clear |
| Gateways list | ChatContext (useState) | None (reload on each gateway fetch) | Per-load |
| Tabs | TabContext (useState) | localStorage `claos_tabs` | Until manual close |
| Terminal windows | TerminalContext (useState) | None (in-memory only) | Per page session |
| Notification perm | NotificationContext (useState) | Browser (Notification API) | Browser |
| UI Control enabled | AgentUIControlContext | localStorage `claos_ui_control_enabled` | Persistent |
| Server sessions | lib/auth.ts (file + in-memory 5s) | `DATA_DIR/sessions.json` | 4 hours expiry |
| Gateway WS pool | lib/gateway/chat-client.ts (Map) | In-memory (process lifetime) | Until disconnect |
| WS proxy upstream | server/gateway-ws-proxy.js (Map) | In-memory (process lifetime) | Until last client disconnects |
| Circuit breakers | lib/gateway/circuit-breaker.ts (Map) | In-memory (process lifetime) | 60s auto-reset |
| Groups | lib/groups.ts (file) | `DATA_DIR/groups.json` | Persistent |
| PTY sessions | lib/terminal/pty-manager.ts (Map) | In-memory (process lifetime) | 30min idle timeout |
