# Contributing to Claos Dashboard

Thank you for your interest in contributing! This guide covers everything you need to get started.

## Architecture Overview

Claos is a Next.js 15 (App Router) dashboard that connects to one or more **Clawdbot Gateway** instances via REST + SSE. Authentication is session-based (cookie + CSRF), file-based storage is used for persistence (no external database), and all real-time chat responses are streamed via Server-Sent Events.

## Running Locally

### Prerequisites

- Node.js ≥ 18
- A running [Clawdbot Gateway](https://github.com/e-cesar9/claos-dashboard) (or configure a mock in `.env.local`)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/e-cesar9/claos-dashboard.git
cd claos-dashboard

# 2. Install dependencies
npm install

# 3. Copy and configure environment
cp .env.example .env.local
# Edit .env.local — set CLAOS_PASSWORD_HASH and GATEWAY_URLS

# 4. Start the dev server
npm run dev
```

The dashboard will be available at `http://localhost:3000`.

## Running Tests

```bash
# Unit + integration tests (Jest)
npm test

# Watch mode (re-runs on file changes)
npm run test:watch

# Coverage report
npm run test:coverage

# End-to-end tests (Playwright — requires a running server)
npm run test:e2e
```

All Jest tests live in `__tests__/`. The E2E tests live in `e2e/`.

**Rule:** `npm run build && npm test` must pass before any PR is merged.

## PR Guidelines

1. **One concern per PR** — keep changes focused and reviewable.
2. **Tests required** — new features need unit tests; bug fixes should include a regression test.
3. **Build must pass** — run `npm run build && npm test` locally before pushing.
4. **Conventional commits** — use `feat:`, `fix:`, `refactor:`, `docs:`, `chore:` prefixes.
5. **No secrets** — never commit `.env.local`, credentials, or private keys.
6. **Type-safe** — TypeScript strict mode is enforced; no `any` unless justified.

## Project Structure

```
app/
  (dashboard)/       # Authenticated dashboard routes
  api/               # Next.js API routes (REST + SSE)
  login/             # Public login page
components/
  chat/              # Chat UI components
  layout/            # Sidebar, navigation
  ui/                # Reusable UI primitives
context/             # React context providers (chat state, terminal)
lib/                 # Server-side utilities (auth, gateway, groups, validation)
__tests__/           # Jest unit/integration tests
e2e/                 # Playwright end-to-end tests
```

## Code Style

- **Formatter:** Prettier (via ESLint config)
- **Linter:** `npm run lint`
- **CSS:** Tailwind CSS with CSS variables for theming (see `app/globals.css`)
- **Imports:** Use `@/` path alias for project-root imports

## Security Notes

- Never weaken CSRF protection or authentication middleware
- File paths must be validated through `lib/validation.ts` before any filesystem operation
- All user inputs must go through the Zod schemas in `lib/validation.ts`
