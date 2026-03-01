# Module: useMessageSender (`hooks/useMessageSender.ts`)

## Rôle

The central orchestration hook for all message sending — manages input state, attachment processing, message queuing, WS/SSE dual-path streaming, multi-gateway group brainstorming, and post-send notifications.

## Responsabilités principales

- **Input state**: `input` text and `pendingAttachments` array
- **Image compression**: client-side JPEG compression to stay within 380KB WS frame limit (canvas-based, tries quality 0.85→0.7→0.55→0.4)
- **File reading**: FileReader for image (data URL), text (raw text), audio (pass-through) attachments
- **Message queuing**: per-session FIFO queue (Map of arrays) — prevents concurrent sends to the same session; queued items carry their exact target session to prevent cross-session delivery
- **Sending state**: per-session `sendingKeys` Set (tracks which sessions are currently sending)
- **WS path**: uses `useChatWs.streamChat()` for single-gateway sessions when WebSocket is connected
- **SSE fallback**: `fetch('/api/chat/stream')` with retry-on-network-error (up to 3 retries, exponential backoff 1s/2s/4s); uses shared `idempotencyKey` across retries for gateway deduplication
- **Group orchestration**: sequential per-agent streaming + optional follow-up brainstorm rounds; injects GROUP CHAT context header into each message
- **Notifications**: marks tab unread, sends browser Notification, updates document.title (unread count) when assistant responds while tab is inactive
- **Message cache**: updates ChatContext messages AND localStorage on every delta (streaming update)

## Dépendances internes

- `context/chat-context.tsx` — sessions, gateways, messages, cache, localStorage helpers
- `context/tab-context.tsx` — tab list and `markTabUnread`
- `context/notification-context.tsx` — `notificationRef.current` (imperative notification trigger)
- `lib/csrf-client.ts` — `getCsrfToken()` for SSE requests
- `lib/types.ts` — `Message`, `Session`, `PendingAttachment`
- `lib/session-utils.ts` — `isGroupSession`, `sessionDisplayName`
- `hooks/useChatWs.ts` — streaming chat over browser WebSocket

## Dépendances externes

- `react` (useState, useCallback, useRef)
- Browser `fetch` API (SSE streaming)
- Browser `FileReader` API
- Browser `HTMLCanvasElement` (image compression)
- Browser `AbortSignal.timeout` (SSE request timeout)

## Ce qui dépend de lui

- `components/chat/chat-input.tsx` — `input`, `setInput`, `sendMessage`, `handleFileSelect`, `pendingAttachments`, `sending`
- `components/chat/ChatSection.tsx` (indirectly through chat-input)

## Flux de données entrants

- User text input + selected files
- `selectedSession` from ChatContext
- `gateways` list from ChatContext
- Agent events from `useChatWs` (WS path)
- SSE events from `/api/chat/stream` (SSE path)

## Flux de données sortants

- User + assistant messages appended to ChatContext + localStorage
- Tab unread badge updates
- Browser Notification API calls
- Document title updates
- `sending` boolean (disables send button during active stream)
- `queueLength` number (shows queue depth in UI)

## Risques / Couplages forts

1. **God hook (500+ lines)** — violates Single Responsibility. Mixes concerns: input state, file processing, image compression, queuing, retry logic, SSE streaming, WS streaming, group brainstorming, notifications. A bug in any one path can silently corrupt unrelated state.

2. **`sendMessageCore` has 40+ callback captures** — the `useCallback` dependency array is effectively suppressed with an eslint-disable comment. This means callbacks may use stale closures for `gateways`, `messagesCache`, `lsSaveMessages`, and `setMessages`. Race conditions during rapid session switching are possible.

3. **`addMessages` is a closure inside `sendMessageCore`** — it captures the `session` from the outer `sendMessageCore` call. If the user switches sessions mid-stream, messages from the old stream are written to the new session's cache under certain timing conditions. The `selectedSessionRef.current === session.sessionKey` guard only affects the visible display, not the cache write.

4. **SSE retry uses the same `accumulatedText` closure** — if a retry happens mid-stream, `accumulatedText` still holds partial text from the previous attempt. Combined with the gateway's idempotency key deduplication, this should be safe, but only if the gateway correctly deduplicates.

5. **Group brainstorm sequential blocking** — each agent's response is awaited before the next agent starts. In a 3-agent group with 1 brainstorm round, this means 6 sequential requests. No parallelization is attempted for the initial round.

6. **Image compression uses `document.createElement('canvas')`** — this breaks in server-side contexts. The hook is `'use client'` so this is safe today, but the canvas usage is not guarded by `typeof document !== 'undefined'`.

## Architecture Improvements

- **Split into smaller hooks**: `useMessageInput` (text + attachments + compression), `useSendStream` (SSE/WS stream management), `useMessageQueue` (per-session queue), `useGroupOrchestrator` (multi-agent rounds).
- **Fix stale closure risk**: use `useReducer` for message updates instead of nested `useCallback` with captures.
- **Add explicit dependency tracking**: document which state each `addMessages` closure captures and guard against cross-session writes.
- **Parallelize group round 1**: the initial responses can be fetched in parallel since they all respond to the same user message.
