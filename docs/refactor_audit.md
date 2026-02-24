# Claos Refactor Audit

**Date:** 2026-02-21  
**Auditor:** James (FDE)  
**Scope:** Full codebase architecture review

---

## Executive Summary

| Metric                | Value        |
| --------------------- | ------------ |
| Total Files           | 198 TS/TSX   |
| Total Lines           | 32,316       |
| API Routes            | 39           |
| React Contexts        | 5            |
| Custom Hooks          | 7            |
| TypeScript Errors     | 0 ✅ (fixed) |
| Circular Dependencies | 2            |

---

## 🚨 Critical Issues

### 1. Circular Dependencies

```
lib/gateway/chat-client.ts ↔ lib/gateway/registry.ts
```

**Risk:** Runtime import issues, bundling problems, harder to test.

**Fix:** Extract shared types/interfaces to `lib/gateway/types.ts` and refactor imports.

### 2. Monolithic Hooks

| File                        | Lines | Responsibilities                                                                         |
| --------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `hooks/useMessageSender.ts` | 660   | Message queue, image compression, SSE streaming, WebSocket, group chat, file attachments |
| `hooks/useSessionLoader.ts` | 311   | Gateway fetch, session loading, history, caching                                         |
| `hooks/useGatewayWs.ts`     | 287   | WebSocket connection, heartbeat, reconnection logic                                      |

**Impact:** Hard to test, hard to maintain, violation of Single Responsibility Principle.

### 3. Monolithic Pages

| File                                                  | Lines | Issue                                        |
| ----------------------------------------------------- | ----- | -------------------------------------------- |
| `app/(dashboard)/groups/page.tsx`                     | 593   | UI + business logic + state management mixed |
| `app/first-run/page.tsx`                              | 457   | Multi-step wizard with all steps inline      |
| `components/agent-ui-control/FloatingAgentButton.tsx` | 526   | Too many responsibilities                    |
| `components/views/FilesView.tsx`                      | 463   | File tree + editor + operations combined     |

---

## ⚠️ Medium Issues

### 4. Console.log Pollution

**Count:** 50 `console.*` calls outside of `logger.ts` and tests.

**Locations:**

- `hooks/useMessageSender.ts` - 3 occurrences
- `hooks/useSessionLoader.ts` - 4 occurrences
- `hooks/useGatewayWs.ts` - 2 occurrences
- `components/terminal/terminal.tsx` - 3 occurrences
- Various other files

**Fix:** Replace with structured `lib/logger.ts` calls.

### 5. Duplicate Code Patterns

#### Gateway Display Helper

Defined locally in multiple files instead of using `lib/session-utils.ts`:

- ~~`components/chat/new-chat-modal.tsx`~~ (deleted)
- ~~`components/chat/new-group-modal.tsx`~~ (deleted)

**Status:** Fixed ✅

#### Gateway List Item Rendering

Similar gateway card/list item rendering in:

- `components/chat/new-chat-panel.tsx`
- `components/chat/new-group-panel.tsx`
- `app/(dashboard)/groups/page.tsx`
- `components/gateways/gateway-manager.tsx`

**Fix:** Create reusable `<GatewayCard />` or `<GatewayListItem />` component.

### 6. Inconsistent Error Handling

Some API routes use:

```typescript
return Response.json({ error: 'message' }, { status: 400 })
```

Others use:

```typescript
return new Response(JSON.stringify({ error: 'message' }), { status: 400 })
```

**Fix:** Standardize on `Response.json()` pattern.

---

## 📁 Architecture Analysis

### Current Structure

```
├── app/
│   ├── (dashboard)/      # Protected routes
│   ├── api/              # 39 API routes
│   ├── login/
│   └── first-run/
├── components/
│   ├── ui/               # Base components (shadcn)
│   ├── chat/             # Chat-related (9 files)
│   ├── files/            # File manager (4 files)
│   ├── layout/           # Layout components
│   ├── views/            # Full page views
│   └── agent-ui-control/ # AI UI control
├── context/              # 5 React contexts
├── hooks/                # 7 custom hooks
└── lib/
    ├── gateway/          # Gateway client (14 files) ✅ Well structured
    ├── terminal/         # PTY manager
    └── [various utils]
```

### Recommended Changes

#### Split `lib/auth.ts` (438 lines)

```
lib/auth/
├── index.ts        # Re-exports
├── session.ts      # Session management
├── password.ts     # Password hashing/verification
├── csrf.ts         # CSRF token handling
└── types.ts        # Auth types
```

#### Split `hooks/useMessageSender.ts` (660 lines)

```
hooks/message-sender/
├── index.ts              # Main hook (orchestrator)
├── useImageCompression.ts
├── useMessageQueue.ts
├── useAttachments.ts
├── useSSEStream.ts
└── types.ts
```

#### Split `app/(dashboard)/groups/page.tsx` (593 lines)

```
components/groups/
├── GroupList.tsx
├── GroupChat.tsx
├── GroupMessageList.tsx
├── CreateGroupForm.tsx
└── AgentSelector.tsx
```

---

## 📊 File Size Distribution

### Files > 400 lines (excluding tests)

| File                                                  | Lines | Priority |
| ----------------------------------------------------- | ----- | -------- |
| `hooks/useMessageSender.ts`                           | 660   | HIGH     |
| `app/(dashboard)/groups/page.tsx`                     | 593   | MEDIUM   |
| `components/agent-ui-control/FloatingAgentButton.tsx` | 526   | MEDIUM   |
| `components/views/FilesView.tsx`                      | 463   | LOW      |
| `app/first-run/page.tsx`                              | 457   | LOW      |
| `lib/auth.ts`                                         | 438   | LOW      |
| `components/layout/sidebar.tsx`                       | 417   | LOW      |

### Files > 300 lines

| File                              | Lines |
| --------------------------------- | ----- |
| `lib/gateway/ws-client.ts`        | 399   |
| `lib/groups.ts`                   | 382   |
| `components/chat/ChatSection.tsx` | 357   |
| `hooks/useSessionLoader.ts`       | 311   |
| `context/chat-context.tsx`        | 305   |

---

## ✅ What's Good

1. **Gateway module** (`lib/gateway/`) - Well organized, clear separation
2. **UI components** (`components/ui/`) - Clean, reusable shadcn components
3. **Type definitions** (`lib/types.ts`) - Centralized, well documented
4. **API route structure** - RESTful, consistent naming
5. **Test coverage** - Comprehensive test files for critical paths
6. **Security** - CSRF protection, SSRF protection, TOTP support

---

## 🎯 Refactoring Roadmap

### Phase 1: Quick Wins (2 hours)

- [x] Remove duplicate modal components
- [x] Fix all TypeScript errors (61 → 0)
- [ ] Replace `console.*` with logger
- [ ] Fix circular dependencies
- [ ] Create `<GatewayListItem />` component

### Phase 2: Hook Refactoring (4 hours)

- [ ] Split `useMessageSender` into focused hooks
- [ ] Extract image compression utility
- [ ] Extract message queue logic
- [ ] Add proper error boundaries

### Phase 3: Page Refactoring (3 hours)

- [ ] Split `groups/page.tsx` into components
- [ ] Split `first-run/page.tsx` into step components
- [ ] Extract `FloatingAgentButton` sub-components

### Phase 4: Architecture (2 hours)

- [ ] Split `lib/auth.ts` into modules
- [ ] Standardize error handling patterns
- [ ] Add barrel exports for cleaner imports

---

## 📝 TODOs Found in Codebase

| Location                                   | TODO                              |
| ------------------------------------------ | --------------------------------- |
| `__tests__/components/sidebar.test.tsx:87` | Settings link not yet implemented |
| `__tests__/tab-navigation.test.tsx:256`    | Settings link not yet implemented |
| `__tests__/session-store.test.ts:54`       | Tests have mocking issues         |
| `__tests__/tab-mobile.test.tsx:5`          | Test skipped - ESM import issues  |
| `__tests__/tab-notifications.test.tsx:5`   | jsdom canvas limitations          |
| `lib/ssrf-protection.ts:121`               | Add DNS resolution check          |

---

## 🔧 Completed Fixes

### 2026-02-21

- Deleted 3 unused duplicate components:
  - `components/chat/new-chat-modal.tsx`
  - `components/chat/new-group-modal.tsx`
  - `components/chat/new-chat-modal-dialog.tsx`
- Fixed 61 TypeScript errors across test files
- Commit: `7893a21`

---

## Appendix: Commands Used

```bash
# File count and lines
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | grep -v node_modules | wc -l
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs wc -l | sort -rn

# TypeScript check
npx tsc --noEmit

# Circular dependencies
npx madge --circular --extensions ts,tsx .

# Console.log audit
grep -r "console\." --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v __tests__

# TODO/FIXME scan
grep -rn "TODO\|FIXME\|HACK\|XXX" --include="*.ts" --include="*.tsx"
```
