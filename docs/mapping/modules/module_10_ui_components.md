# Module: UI Components (`components/`)

## Rôle

React presentation layer — all UI components from primitive atoms to complex feature panels, organized by domain (chat, layout, tabs, views, terminal, ui primitives, agent control, notifications, gateways).

## Sub-module Inventory

### `components/ui/` — Design System Primitives (shadcn/ui pattern)

| Component          | Role                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| `button.tsx`       | CVA-based button with variants (default, outline, ghost, destructive) |
| `input.tsx`        | Styled text input                                                     |
| `dialog.tsx`       | Radix UI dialog wrapper                                               |
| `context-menu.tsx` | Radix UI context menu (right-click)                                   |
| `select.tsx`       | Radix UI select dropdown                                              |
| `avatar.tsx`       | Avatar with fallback initials                                         |
| `badge.tsx`        | Status/label badge                                                    |
| `card.tsx`         | Content card container                                                |
| `skeleton.tsx`     | Loading skeleton animation                                            |
| `spinner.tsx`      | Loading spinner                                                       |
| `toast.tsx`        | Toast notification system                                             |
| `file-dialogs.tsx` | Reusable file create/rename/delete modal dialogs                      |

### `components/chat/` — Chat Feature

| Component                                          | Role                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `ChatSection.tsx`                                  | Top-level chat layout (sessions sidebar + message area)                |
| `chat-header.tsx`                                  | Current session header with name, gateway badge, actions               |
| `chat-input.tsx`                                   | Message input with attachments, send button, voice input               |
| `message-list.tsx`                                 | Scrollable message history with auto-scroll                            |
| `MarkdownContent.tsx`                              | Renders assistant messages as markdown (react-markdown + highlight.js) |
| `conversation-list.tsx`                            | Left sidebar list of sessions                                          |
| `sessions-sidebar.tsx`                             | Sidebar container with tabs (sessions / groups)                        |
| `SessionsTab.tsx`                                  | Sessions tab content                                                   |
| `new-chat-modal.tsx` / `new-chat-modal-dialog.tsx` | New session dialog (agent picker)                                      |
| `new-chat-panel.tsx`                               | Inline new session form                                                |
| `new-group-modal.tsx` / `new-group-panel.tsx`      | Multi-agent group creation                                             |
| `rename-dialog.tsx`                                | Session rename dialog                                                  |

### `components/layout/` — Shell Layout

| Component              | Role                                                       |
| ---------------------- | ---------------------------------------------------------- |
| `dashboard-layout.tsx` | Dashboard shell (tabbar + main + mobile nav)               |
| `sidebar.tsx`          | Left sidebar navigation (shows different content per view) |
| `mobile-nav.tsx`       | Bottom navigation bar (mobile)                             |
| `page-header.tsx`      | Section page header                                        |

### `components/tabs/` — Tab System

| Component             | Role                                                          |
| --------------------- | ------------------------------------------------------------- |
| `TabBar.tsx`          | Horizontal tab bar (pinned + scrollable tabs + overflow menu) |
| `TabItem.tsx`         | Individual tab with close button, unread badge                |
| `TabOverflowMenu.tsx` | Dropdown for overflow tabs                                    |
| `WelcomeScreen.tsx`   | "New tab" welcome screen with section shortcuts               |

### `components/views/` — Section View Wrappers

| Component          | Role                                                  |
| ------------------ | ----------------------------------------------------- |
| `ChatView.tsx`     | Chat section container                                |
| `FilesView.tsx`    | File manager section (directory browser, file editor) |
| `TerminalView.tsx` | Terminal section with window management               |
| `StatusView.tsx`   | Gateway status dashboard                              |

### `components/terminal/`

| Component      | Role                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------- |
| `terminal.tsx` | xterm.js integration — mounts Terminal, FitAddon, WebLinksAddon; streams PTY output via SSE |

### `components/gateways/`

| Component             | Role                                                        |
| --------------------- | ----------------------------------------------------------- |
| `gateway-manager.tsx` | Gateway list with status indicators and add/remove controls |

### `components/agent-ui-control/`

| Component                 | Role                                                  |
| ------------------------- | ----------------------------------------------------- |
| `FloatingAgentButton.tsx` | Floating microphone/agent button for voice UI control |
| `AgentActivePill.tsx`     | Status pill showing agent is active/running           |

### `components/notifications/`

| Component              | Role                                                           |
| ---------------------- | -------------------------------------------------------------- |
| `NotificationBell.tsx` | Bell icon with unread count badge; triggers permission request |

### `components/error-boundary.tsx`

- React class ErrorBoundary — catches render errors and shows fallback UI

## Dépendances internes (composites)

- `ChatSection` → `useMessageSender`, `useSessionLoader`, `ChatContext`, `TabContext`, `GatewayWsContext`
- `terminal.tsx` → `TerminalContext`, xterm addons
- `FilesView` → `/api/files/*` routes (direct fetch), `ChatContext` (gateway selection)
- `conversation-list.tsx` → `ChatContext`, `useSessionLoader`

## Dépendances externes

- `@radix-ui/*` — dialog, select, context-menu, scroll-area, tabs
- `lucide-react` — icons throughout
- `react-markdown` + `remark-gfm` + `rehype-highlight` — markdown rendering in `MarkdownContent`
- `highlight.js` — syntax highlighting
- `xterm` + addons — terminal emulator

## Risques / Couplages forts

1. **`ChatSection.tsx` is a god component** — it imports `useMessageSender`, `useSessionLoader`, manages the WS connection state display, handles group creation, and coordinates between the sidebar and the message area. Likely >200 lines.

2. **`FilesView` does direct `fetch()` calls** — instead of using a dedicated data hook, file operations are done inline in the component. This mixes data-fetching concerns with rendering.

3. **`message-list.tsx` auto-scrolls on every message update** — the auto-scroll logic (scroll to bottom on new assistant messages) can conflict with the user manually scrolling up to read history. A "scroll lock" pattern is needed.

4. **`MarkdownContent.tsx` uses `highlight.js`** — which requires `unsafe-eval` in the CSP. This is documented in `middleware.ts` but the coupling is implicit.

5. **No component-level error boundaries below `ErrorBoundary`** — the single `ErrorBoundary` wraps all children of the dashboard. A render error in `ChatSection` takes down the terminal and file manager too.

## Architecture Improvements

- **Add section-level error boundaries** — one per `TabInstance` section so a crash in chat doesn't affect terminal.
- **Extract `FilesView` data fetching** to a `useFiles` hook.
- **Implement scroll-lock** in `message-list` — auto-scroll only when the user is already at the bottom; show "new messages ↓" button otherwise.
- **Split `ChatSection`** into `ChatPane` (layout) + `ChatActions` (hook integration).
