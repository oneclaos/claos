# Claos Dashboard — API Reference

All routes require an active session cookie (`claos_session`) unless noted as public.  
Mutating routes (`POST`, `PUT`, `DELETE`, `PATCH`) on protected endpoints additionally require a CSRF token in the `x-csrf-token` header.

Get a CSRF token: `POST /api/auth` with `{ "action": "csrf" }`.

---

## Authentication — `/api/auth`

### `GET /api/auth`
Check authentication status and get a fresh CSRF token.

**Response**
```json
{
  "authenticated": true,
  "csrfToken": "abc123.def456",
  "totpEnabled": false,
  "firstRun": false
}
```

### `POST /api/auth`
Perform an auth action. Supported `action` values:

| Action | Description |
|--------|-------------|
| `login` | Password login (step 1 of 1 or step 1 of 2 if TOTP enabled) |
| `verify-totp` | TOTP / recovery code verification (step 2 when TOTP is enabled) |
| `logout` | Invalidate current session |
| `rotate` | Rotate session token (get a new token + CSRF) |
| `csrf` | Get a fresh CSRF token without rotating the session |

**Login request**
```json
{ "action": "login", "password": "your-password" }
```

**Login response (no TOTP)**
```json
{ "success": true, "csrfToken": "abc123.def456" }
```

**Login response (TOTP required)**
```json
{ "totpRequired": true, "tempToken": "<temp-token>" }
```

**TOTP verification request**
```json
{ "action": "verify-totp", "tempToken": "<temp-token>", "code": "123456" }
```

**Error codes**: `401` invalid credentials / session expired, `429` rate-limited (5 attempts → 15 min lockout)

---

## Chat — `/api/chat`

### `POST /api/chat/stream`
Stream an AI response via Server-Sent Events (SSE).

**Headers**: `x-csrf-token: <token>`

**Request body**
```json
{
  "gatewayId": "my-gateway",
  "sessionKey": "claos-my-gateway-1700000000000",
  "message": "Hello, what can you do?",
  "attachments": [
    { "content": "data:image/jpeg;base64,...", "mimeType": "image/jpeg", "fileName": "photo.jpg" }
  ]
}
```

**SSE event stream** (each line `data: <json>`)
```json
{ "type": "delta", "text": "Hello! I can " }
{ "type": "delta", "text": "help you with..." }
{ "type": "done",  "text": "<full response text>" }
{ "type": "error", "error": "Gateway unreachable" }
```

**Error codes**: `401` unauthorized, `403` invalid CSRF, `400` missing fields, `503` gateway error

### `GET /api/chat/warmup`
Pre-warm WebSocket connections to all configured gateways. Called automatically on login.

**Response**: `{ "warmed": ["gateway-1", "gateway-2"] }`

---

## Sessions — `/api/sessions`

### `GET /api/sessions`
List all agent sessions across all gateways.

**Response**
```json
{
  "sessions": [
    {
      "sessionKey": "claos-gw1-1700000000000",
      "gateway": "gw1",
      "gatewayName": "Agent Alpha",
      "kind": "direct",
      "lastActive": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 1
}
```

### `POST /api/sessions`
List sessions with filters and pagination.

**Request body**
```json
{
  "gatewayId": "gw1",
  "channel": "telegram",
  "limit": 50,
  "offset": 0
}
```

### `GET /api/sessions/history`
Fetch conversation history for a specific session.

**Query parameters**
- `gatewayId` *(required)* — Gateway ID
- `sessionKey` *(required)* — Session key
- `limit` *(optional)* — Max messages (default: 100)

**Response**
```json
{
  "messages": [
    { "role": "user", "content": "Hello", "timestamp": "2024-01-15T10:00:00Z" },
    { "role": "assistant", "content": "Hi there!", "timestamp": "2024-01-15T10:00:01Z" }
  ],
  "sessionKey": "claos-gw1-1700000000000",
  "gateway": "gw1",
  "gatewayName": "Agent Alpha"
}
```

### `POST /api/sessions/spawn`
Create a new session on a gateway.

**Headers**: `x-csrf-token: <token>`

**Request body**
```json
{
  "gatewayId": "gw1",
  "sessionKey": "claos-multiagent-1700000000000",
  "message": "Optional initial message"
}
```

**Response**: `{ "success": true, "sessionKey": "..." }`

### `POST /api/sessions/rename`
Rename a session (saves a custom display name).

**Request body**
```json
{ "sessionKey": "claos-gw1-1700000000000", "name": "My Chat" }
```

**Response**: `{ "success": true }`

### `DELETE /api/sessions/[sessionKey]`
Delete a session from its gateway.

**Headers**: `x-csrf-token: <token>`

**Query parameters**: `gatewayId` *(required)*

**Response**: `{ "success": true }`

---

## Gateways — `/api/gateways`

### `GET /api/gateways`
List all registered gateways (auto-discovered + environment + custom).

**Response**
```json
{
  "gateways": [
    {
      "id": "gw1",
      "name": "Agent Alpha",
      "url": "ws://localhost:18789",
      "online": true,
      "custom": false
    }
  ]
}
```

### `POST /api/gateways`
Register a custom gateway.

**Headers**: `x-csrf-token: <token>`

**Request body**
```json
{
  "name": "Remote Agent",
  "url": "wss://my-server.com:18789",
  "gatewayToken": "optional-auth-token"
}
```

**Response**: `{ "success": true, "gateway": { "id": "remote-agent", ... } }`

### `DELETE /api/gateways?id=<gateway-id>`
Remove a custom gateway.

**Headers**: `x-csrf-token: <token>`

**Response**: `{ "success": true }`  
**Error**: `404` if gateway not found or is not a custom gateway.

---

## Files — `/api/files`

All file routes validate paths against `ALLOWED_BASE_PATHS` (default: `/`). Path traversal (e.g. `..`) is blocked.

### `GET /api/files?path=<dir>`
Browse a directory or read file metadata.

**Response (directory)**
```json
{
  "type": "directory",
  "path": "/home/clawd",
  "entries": [
    { "name": "README.md", "type": "file", "size": 1024, "modified": "2024-01-15T10:00:00Z" }
  ]
}
```

**Response (file redirect)**: Redirects to `/api/files/read?path=...`

### `GET /api/files/read?path=<file>`
Read file contents.

**Response**: `{ "content": "...", "path": "/home/clawd/README.md", "size": 1024 }`

### `POST /api/files/write`
Write content to an existing file.

**Headers**: `x-csrf-token: <token>`

**Request body**
```json
{ "path": "/home/clawd/myfile.txt", "content": "Hello World" }
```

**Response**: `{ "success": true }`  
**Limits**: Max 10 MB content. Blocked paths: `.env`, `.ssh`, `.git`, `node_modules`, etc.

### `POST /api/files/create`
Create a new file or directory.

**Headers**: `x-csrf-token: <token>`

**Request body**
```json
{ "path": "/home/clawd/newfile.md", "isDirectory": false }
```

**Response**: `{ "success": true }`  
**Note**: Script extensions (`.sh`, `.py`, `.ts`, etc.) are blocked.

### `DELETE /api/files/delete`
Move a file to trash (reversible delete).

**Headers**: `x-csrf-token: <token>`

**Request body**: `{ "path": "/home/clawd/oldfile.txt" }`

**Response**: `{ "success": true, "trashPath": "/home/clawd/.local/share/claos-trash/..." }`  
**Protected paths**: `.env`, `.ssh`, `.git`, `AGENTS.md`, `SOUL.md`, etc.

### `POST /api/files/move`
Move or rename a file.

**Headers**: `x-csrf-token: <token>`

**Request body**: `{ "from": "/home/clawd/old.txt", "to": "/home/clawd/new.txt" }`

**Response**: `{ "success": true }`

### `GET /api/files/download?path=<file>`
Download a file as an attachment.

---

## Terminal — `/api/terminal`

### `GET /api/terminal`
List active PTY sessions.

**Response**: `{ "sessions": [{ "id": "abc123", "created": "...", "cols": 80, "rows": 24 }] }`

### `POST /api/terminal`
Create a new PTY session.

**Headers**: `x-csrf-token: <token>`

**Response**: `{ "id": "abc123", "cols": 80, "rows": 24 }`

### `GET /api/terminal/[id]/stream`
SSE stream of terminal output for session `id`.

**SSE events**
```
data: {"type":"output","data":"$ "}
data: {"type":"closed"}
```

### `POST /api/terminal/[id]/write`
Write input to the terminal.

**Headers**: `x-csrf-token: <token>`

**Request body**: `{ "data": "ls -la\n" }`

### `POST /api/terminal/[id]/resize`
Resize the terminal window.

**Headers**: `x-csrf-token: <token>`

**Request body**: `{ "cols": 120, "rows": 30 }`

### `DELETE /api/terminal/[id]`
Kill and clean up a terminal session.

---

## Settings — `/api/settings`

### `POST /api/settings/password`
Change the dashboard password.

**Headers**: `x-csrf-token: <token>`

**Request body**
```json
{
  "currentPassword": "old-password",
  "newPassword": "new-secure-password"
}
```

**Response**: `{ "success": true }`  
**Error codes**: `401` invalid current password, `400` new password too short (<8 chars)

---

## First Run — `/api/first-run`

Public endpoint used during initial setup (no session required).

### `POST /api/first-run`
Configure the dashboard for the first time.

**Request body**
```json
{ "password": "initial-password" }
```

**Response**: `{ "success": true }` — redirects to login.

---

## Error Response Format

All error responses follow:
```json
{ "error": "Human-readable error message" }
```

Common HTTP status codes:
| Code | Meaning |
|------|---------|
| `400` | Bad request / validation error |
| `401` | Not authenticated |
| `403` | CSRF token invalid or access denied |
| `404` | Resource not found |
| `429` | Rate limited (auth routes) |
| `500` | Internal server error |
