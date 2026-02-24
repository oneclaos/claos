# 03 — Tech Stack

> All libraries and frameworks with versions and roles.

---

## Core Framework

| Library      | Version | Role                                          |
| ------------ | ------- | --------------------------------------------- |
| `next`       | 16.1.6  | App Router, API routes, SSR, standalone build |
| `react`      | 19.2.3  | UI framework                                  |
| `react-dom`  | 19.2.3  | DOM rendering                                 |
| `typescript` | ^5      | Type safety across entire codebase            |

---

## Runtime Dependencies

### Communication

| Library | Version | Role                                                             |
| ------- | ------- | ---------------------------------------------------------------- |
| `ws`    | ^8.19.0 | Node.js WebSocket client/server (gateway connections + WS proxy) |

### Auth & Security

| Library  | Version | Role                                         |
| -------- | ------- | -------------------------------------------- |
| `bcrypt` | ^6.0.0  | Password hashing (BCRYPT_ROUNDS = 12)        |
| `otplib` | ^13.3.0 | TOTP 2FA (optional, not enforced by default) |
| `qrcode` | ^1.5.4  | QR code generation for TOTP enrollment       |

### Data / Storage

| Library   | Version | Role                                                                      |
| --------- | ------- | ------------------------------------------------------------------------- |
| `ioredis` | ^5.9.3  | Optional Redis session store (lazy-initialized, disabled if no REDIS_URL) |
| `zod`     | ^4.3.6  | Input validation schemas (API routes, localStorage deserialization)       |

### Terminal

| Library                 | Version | Role                                               |
| ----------------------- | ------- | -------------------------------------------------- |
| `node-pty`              | ^1.1.0  | Native PTY process spawning for embedded terminal  |
| `xterm`                 | ^5.3.0  | Browser-side terminal emulator (client components) |
| `xterm-addon-fit`       | ^0.8.0  | Auto-resize xterm to container                     |
| `xterm-addon-web-links` | ^0.9.0  | Clickable URLs in terminal                         |

### UI / Styling

| Library                        | Version  | Role                                          |
| ------------------------------ | -------- | --------------------------------------------- |
| `tailwindcss`                  | ^4       | Utility-first CSS (postcss plugin variant)    |
| `@radix-ui/react-context-menu` | ^2.2.16  | Context menu primitives                       |
| `@radix-ui/react-dialog`       | ^1.1.15  | Modal dialogs                                 |
| `@radix-ui/react-scroll-area`  | ^1.2.10  | Custom scrollbars                             |
| `@radix-ui/react-select`       | ^2.2.6   | Accessible select dropdown                    |
| `@radix-ui/react-slot`         | ^1.2.4   | Radix slot utility (used by Button asChild)   |
| `@radix-ui/react-tabs`         | ^1.1.13  | Accessible tab primitives                     |
| `lucide-react`                 | ^0.563.0 | SVG icon library                              |
| `class-variance-authority`     | ^0.7.1   | Component variant utility (shadcn/ui pattern) |
| `clsx`                         | ^2.1.1   | Conditional class name builder                |
| `tailwind-merge`               | ^3.4.0   | Merge Tailwind classes without conflicts      |

### Markdown Rendering

| Library            | Version  | Role                                          |
| ------------------ | -------- | --------------------------------------------- |
| `react-markdown`   | ^10.1.0  | Renders markdown in chat messages             |
| `rehype-highlight` | ^7.0.2   | Syntax highlighting in code blocks            |
| `remark-gfm`       | ^4.0.1   | GitHub Flavored Markdown tables/strikethrough |
| `highlight.js`     | ^11.11.1 | Core syntax highlighting library              |

---

## Dev Dependencies

| Library                     | Version | Role                                      |
| --------------------------- | ------- | ----------------------------------------- |
| `jest`                      | ^30.2.0 | Unit/integration test runner              |
| `jest-environment-jsdom`    | ^30.2.0 | DOM environment for React component tests |
| `ts-jest`                   | ^29.4.6 | TypeScript support in Jest                |
| `@testing-library/react`    | ^16.3.2 | React component testing utilities         |
| `@testing-library/jest-dom` | ^6.9.1  | Custom Jest matchers for DOM              |
| `@playwright/test`          | ^1.58.2 | End-to-end browser tests                  |
| `eslint`                    | ^9      | Linting                                   |
| `eslint-config-next`        | 16.1.6  | Next.js ESLint rules                      |
| `tw-animate-css`            | ^1.4.0  | Tailwind animation utilities              |

---

## Runtime Environment

| Aspect          | Value                                           |
| --------------- | ----------------------------------------------- |
| Node.js         | v22.22.0                                        |
| Default port    | 3006 (configurable via PORT env)                |
| Process manager | Docker (docker-compose.yml)                     |
| Auth storage    | File-based (DATA_DIR, default `~/.claos`)  |
| Session store   | File (default) or Redis (REDIS_URL env)         |
| Build output    | Standalone (`next build` → `.next/standalone/`) |

---

## Key Environment Variables

| Variable                   | Usage                                                        |
| -------------------------- | ------------------------------------------------------------ |
| `GATEWAYS`                 | JSON array of GatewayConfig — static gateway list            |
| `CLAOS_PASSWORD_HASH` | Bcrypt hash of dashboard password                            |
| `DATA_DIR`                 | Directory for persistent data (sessions, config, audit logs) |
| `REDIS_URL`                | Optional Redis URL for session storage                       |
| `CSRF_SECRET`              | Optional CSRF secret (auto-generated on first run if absent) |
| `GATEWAY_PORT_START`       | Discovery scan start port (default 18750)                    |
| `GATEWAY_PORT_END`         | Discovery scan end port (default 18810)                      |
| `STRICT_SESSION_BINDING`   | If `true`, validates session IP + User-Agent                 |
| `FORCE_HTTPS`              | If `true`, redirects HTTP to HTTPS in production             |
| `NODE_ENV`                 | `production` disables dev console audit logs                 |

---

## Architecture Patterns Used

| Pattern                 | Where                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------- |
| Provider Pattern        | 5 React Contexts wrapping DashboardLayout                                           |
| Repository Pattern      | lib/session-store.ts FileSessionStore / RedisSessionStore                           |
| Circuit Breaker         | lib/gateway/circuit-breaker.ts (threshold=5, reset=60s)                             |
| Connection Pool         | lib/gateway/chat-client.ts `clients` Map; server/gateway-ws-proxy.js `upstreamPool` |
| Observer (EventEmitter) | lib/gateway/ws-client.ts extends EventEmitter; useGatewayWs handler map             |
| Strategy Pattern        | getGatewayClient auto-detects clawdbot vs openclaw protocol                         |
| Queue Pattern           | useMessageSender per-session message queue (Map of arrays)                          |
| Idempotency Keys        | All chat.send calls include client-generated idempotency key                        |
| Layered Cache           | loadHistory: memory Map → localStorage → server (3 levels)                          |
| Barrel Exports          | lib/gateway/index.ts exports all gateway sub-modules                                |
