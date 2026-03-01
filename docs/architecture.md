# Claos - Architecture (v3 - Multi-Gateway)

## Overview

Web interface for managing conversations with **all Clawdbot agents** across **multiple gateways**.

```
                                            ┌─────────────────────────────────────────┐
[User] ──SSH tunnel──▶ [localhost:3847] ──▶│           Claos                    │
                                            │  (Multi-Gateway Dashboard)              │
                                            └────────────┬───────────────┬────────────┘
                                                         │               │
                                        ┌────────────────┴───┐   ┌───────┴────────────┐
                                        ▼                    │   │                    ▼
                               Gateway 1 (James)             │   │           Gateway 2 (Clawdio)
                               127.0.0.1:18785               │   │           127.0.0.1:18795
                                        │                    │   │                    │
                            ┌───────────┼───────────┐        │   │        ┌───────────┼───────────┐
                            ▼           ▼           ▼        │   │        ▼           ▼           ▼
                         [main]    [telegram]  [discord]     │   │     [main]    [telegram]  [slack]
                                                             │   │
```

## Multi-Gateway Support

### Configuration

Gateways are configured via environment:

```bash
# Option 1: Individual tokens
GATEWAY_TOKEN_CLAWD=xxx
GATEWAY_TOKEN_CLAWDIO=xxx

# Option 2: Full JSON override
GATEWAYS='[
  {"id":"clawd","name":"James","url":"http://127.0.0.1:18785","token":"xxx"},
  {"id":"clawdio","name":"Clawdio","url":"http://127.0.0.1:18795","token":"xxx"}
]'
```

### Default Gateways

| ID      | Name    | Port (UI) | Port (API) |
| ------- | ------- | --------- | ---------- |
| clawd   | James   | 18785     | 18787      |
| clawdio | Clawdio | 18795     | 18797      |

### Aggregation

- Sessions from all gateways are fetched in parallel
- Each session is tagged with `gateway` and `gatewayName`
- UI allows filtering by gateway
- Sort by `lastActive` descending across all gateways

## Components

### Frontend (React + shadcn/ui)

- Multi-column layout
- Gateway filter tabs
- Real-time polling (sessions: 5s, history: 3s)
- Session sidebar with gateway badges
- Chat panel with message input

### Backend (Next.js API Routes)

- `/api/auth` - Login/logout with rate limiting
- `/api/agents` - List sessions from all gateways
- `/api/history` - Get session history (specify gateway)
- `/api/send` - Send message (specify gateway)

### lib/gateway.ts

- `getGateways()` - Get configured gateways
- `listAllSessions()` - Aggregate sessions from all gateways
- `getSessionHistory()` - Fetch history from specific gateway
- `sendMessage()` - Send to specific gateway/session

## Directory Structure

```
claos/
├── app/
│   ├── globals.css           # Dark theme styles
│   ├── layout.tsx
│   ├── page.tsx              # Main dashboard
│   ├── login/
│   │   └── page.tsx          # Login screen
│   └── api/
│       ├── auth/route.ts     # Auth endpoints
│       ├── agents/route.ts   # List all sessions
│       ├── history/route.ts  # Get session history
│       └── send/route.ts     # Send message
├── lib/
│   ├── gateway.ts            # Multi-gateway client
│   └── auth.ts               # Session management
├── middleware.ts             # Auth + security headers
└── .env.local                # Gateway config
```

## Security

### Authentication

- Password: SHA256 hash stored in env
- Session: 32-byte random token, 4h expiry
- Rate limiting: 5 attempts → 15min lockout

### Network

- Localhost binding only (127.0.0.1)
- Access via SSH tunnel
- No internet exposure

### Headers

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
```

## Deployment

```bash
# Build
cd /home/clawd/clawd/projects/claos
npm run build

# Start (Docker - recommended)
docker compose up -d

# Access
ssh -L 3847:127.0.0.1:3847 user@vps
# Open http://localhost:3847
```

## Default Credentials

- Password: `Claos2026!`
- Change via: `CLAOS_PASSWORD_HASH` env

## Adding More Gateways

1. Add gateway to `GATEWAYS` env JSON
2. Restart Claos
3. New gateway appears in filter tabs

```json
{
  "id": "new-agent",
  "name": "New Agent",
  "url": "http://127.0.0.1:18XXX",
  "token": "optional-auth-token"
}
```
