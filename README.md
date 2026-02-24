# Claos Dashboard

> **Multi-agent AI orchestration dashboard for openclaw infrastructure.**

[![Status: Beta](https://img.shields.io/badge/status-beta-yellow.svg)](#status)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 🎯 What is Claos?

Claos is a dashboard for managing distributed AI openclaw agent infrastructure locally or in VPS. Connect to multiple openclaw gateways, orchestrate multi-agent conversations, and control your AI fleet from a single interface.

**Requires:** An openclaw gateway instance.

---

## ✨ Features

### 💬 Real-time Chat

- **1-on-1 conversations** with any connected agent
- **Multi-agent groups** - Create brainstorm sessions with 2+ agents
- **Streaming responses** via SSE with automatic reconnection
- **File/image uploads** with compression
- **Message history** persisted in IndexedDB

### 🎛️ Agent Management

- **Auto-discovery** of local gateways (ports 18750-18850)
- **Manual gateway configuration** for remote VPS
- **Live status indicators** (online/offline)
- **Session management** - Create, rename, delete conversations

### 🖥️ UI Control

- **Navigate dashboard** via chat commands
- **Open terminals** from conversation
- **Browse files** through agent instructions
- **First-to-execute** - In groups, first agent to parse command executes it

### 📁 File Manager

- **Browse** VPS filesystem
- **Read/Edit** text files with syntax highlighting
- **Create/Delete** files and directories
- **Download** files directly
- **Path protection** - Blocked paths: `/proc`, `/sys`, `/dev`, `/etc/shadow`

### 🔒 Security

- **bcrypt password hashing** (12 rounds)
- **TOTP 2FA** with recovery codes
- **CSRF protection** on all mutations
- **Rate limiting** with lockout
- **CSP headers** with per-request nonce
- **Audit logging** for security events

### 🖥️ Terminal

- **Web-based shell** via xterm.js
- **PTY support** for interactive commands
- **Multiple terminals** simultaneously
- **Persistent state** across tab switches

---

## ⌨️ Keyboard Shortcuts

| Shortcut           | Action                |
| ------------------ | --------------------- |
| `Ctrl + Enter`     | Send message          |
| `Ctrl + N`         | New conversation      |
| `Ctrl + G`         | New group chat        |
| `Ctrl + K`         | Search sessions       |
| `Ctrl + /`         | Focus chat input      |
| `Escape`           | Close modals/panels   |
| `↑` / `↓`          | Navigate session list |
| `Ctrl + Shift + T` | New terminal          |

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- An openclaw gateway

### Installation

```bash
# Clone
git clone https://github.com/oneclaos/claos.git
cd claos-dashboard

# Install
npm install

# Configure
cp .env.example .env.local
# Edit .env.local with your gateway details

# Run
npm run dev
```

### First Run

1. Open `http://localhost:3006`
2. Set your admin password
3. (Optional) Configure 2FA
4. Add your gateway connections

---

## ⚙️ Configuration

### Environment Variables

```bash
# Required
DATA_DIR=/path/to/data          # Persistent storage directory

# Gateway Configuration (JSON array)
GATEWAYS='[{"id":"main","name":"Main","url":"ws://127.0.0.1:18789","token":"your-token"}]'

# Optional
GATEWAY_PORT_START=18750        # Auto-discovery port range start
GATEWAY_PORT_END=18850          # Auto-discovery port range end
STRICT_SESSION_BINDING=false    # Bind sessions to IP+UserAgent
REDIS_URL=                      # Redis for session storage (optional)
```

### Gateway Format

```json
{
  "id": "unique-id",
  "name": "Display Name",
  "url": "ws://host:port",
  "token": "gateway-token",
  "type": "openclaw"
}
```

### File Browser

By default, the file browser opens to your `$HOME` directory (if within allowed paths).

```bash
# Customize allowed directories (comma-separated)
ALLOWED_BASE_PATHS=/home/myuser,/srv/projects,/var/www

# Default allowed paths (if not set):
# /home, /srv, /var/www, /tmp/claos-data
```

**Security notes:**

- System user homes (`root`, `ubuntu`, `admin`, etc.) are always blocked
- Sensitive paths (`/proc`, `/sys`, `/dev`, `/etc/shadow`) are blocked
- Set `ALLOWED_BASE_PATHS` to restrict access to specific directories

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Claos Dashboard                  │
├─────────────────────────────────────────────────────────┤
│  Next.js 15 (App Router)                                │
│  ├── React 19 + TypeScript                              │
│  ├── Tailwind CSS + Custom Design System                │
│  └── IndexedDB (Client Storage)                         │
├─────────────────────────────────────────────────────────┤
│  API Layer                                              │
│  ├── /api/chat/* - Message streaming                    │
│  ├── /api/sessions/* - Session management               │
│  ├── /api/files/* - File operations                     │
│  ├── /api/terminal/* - PTY management                   │
│  └── /api/gateways - Gateway registry                   │
├─────────────────────────────────────────────────────────┤
│  Gateway Connections (WebSocket)                        │
│  ├── Openclaw Protocol                                  │
│  └── OpenClaw Protocol                                  │
└─────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
    ┌──────────┐        ┌──────────┐        ┌──────────┐
    │ Gateway 1│        │ Gateway 2│        │ Gateway N│
    │ (Agent)  │        │ (Agent)  │        │ (Agent)  │
    └──────────┘        └──────────┘        └──────────┘
```

---

## 🧪 Development

```bash
# Development server
npm run dev

# Type checking
npm run type-check

# Linting
npm run lint

# Tests
npm test

# Build
npm run build

# Production
npm start
```

---

## 📦 Deployment

### Docker

```bash
docker-compose up -d
```

### PM2

```bash
npm run build
pm2 start ecosystem.config.cjs
```

### Manual

```bash
npm run build
npm start
```

---

## 📄 API Reference

### Chat

- `POST /api/chat/stream` - Stream message to agent
- `GET /api/chat/history` - Get conversation history
- `POST /api/sessions/spawn` - Create new session

### Sessions

- `GET /api/sessions` - List all sessions
- `DELETE /api/sessions/[key]` - Delete session
- `POST /api/sessions/rename` - Rename session

### Files

- `GET /api/files` - List directory
- `GET /api/files/read` - Read file content
- `POST /api/files/write` - Write file
- `POST /api/files/create` - Create file/directory
- `DELETE /api/files/delete` - Delete file/directory

### Gateways

- `GET /api/gateways` - List configured gateways
- `GET /api/agents/discover` - Discover local gateways

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

---

## 🔐 Security

See [SECURITY.md](SECURITY.md) for security policies and reporting vulnerabilities.

---

## 📜 License

MIT License - see [LICENSE](LICENSE)

---

## 🔗 Links

- **Claos:** https://github.com/oneclaos/claos
- **Documentation:** Coming soon
- **Discord:** Coming soon

---

<div align="center">

### _One Claos to rule them all_ 👑

</div>
