# Module: ChatContext (`context/chat-context.tsx`)

## Rôle
React context that owns and persists the entire chat domain state — sessions, gateways, selected session, messages, and loading indicators — across tab navigation for the dashboard lifetime.

## Responsabilités principales
- **State storage**: sessions list, gateways list, selected session, messages array, loading booleans
- **In-memory message cache**: `messagesCache` (Map, survives re-renders; per-sessionKey message arrays)
- **localStorage persistence**: sessions, per-session messages, last selected session, group session index
- **Named actions** (preferred API): `appendSession`, `removeSession`, `resetSessions`, `setGatewayList`, `selectSession`, `setRawMessages`, `setHistoryLoading`, `setSessionsLoading`
- **Raw setters** (internal / hook use): raw `setState` dispatchers exposed for hooks that need functional update patterns
- **localStorage helpers**: `lsSaveSessions`, `lsSaveMessages`, `lsLoadMessages`, `lsRemoveMessages`, `lsSaveSelectedSession`, `lsLoadSelectedSession`, `lsSaveGroup`, `lsRemoveGroup`, `lsLoadGroups`
- **Session hydration on mount**: reads `claos:sessions` from localStorage into state immediately (avoids blank flash on page refresh)
- **Input validation on LS reads**: all `JSON.parse` calls are wrapped with type guards; corrupted entries are purged

## Dépendances internes
- `lib/types.ts` — `Session`, `Gateway`, `Message` types

## Dépendances externes
- `react` (createContext, useContext, useState, useCallback, useRef, useEffect)
- Browser `localStorage` API

## Ce qui dépend de lui
- `hooks/useMessageSender.ts` — reads/writes messages, sessions, gateways
- `hooks/useSessionLoader.ts` — loads sessions from server, manages history
- `components/chat/ChatSection.tsx` — renders the active chat view
- `components/chat/conversation-list.tsx` — renders the session list
- `components/chat/SessionsTab.tsx` — session sidebar tab

## Flux de données entrants
- Server session list (via `useSessionLoader`)
- Server message history (via `useSessionLoader`)
- User-sent messages (via `useMessageSender`)
- Streaming gateway responses (via `useMessageSender`)
- localStorage on mount (session hydration)

## Flux de données sortants
- Renders sessions list to `ConversationList`
- Renders messages to `MessageList`
- Persists to localStorage on every relevant state change

## Risques / Couplages forts

1. **Dual API surface** — both named actions (`appendSession`, `selectSession`, etc.) AND raw setState dispatchers are exposed on the context. The `@internal` annotation is only a comment, not enforced. Components can (and might) accidentally use raw setters, bypassing named action semantics.

2. **localStorage helpers are defined IN the context** — the context file is 200+ lines. These helpers would be better extracted to a `lib/chat-storage.ts` module, making the context leaner and testable independently.

3. **No size cap on localStorage messages** — `lsSaveMessages` stores the full message array per session without size limits. Long sessions with many messages or large attachments can fill localStorage (typically 5–10MB quota), causing silent write failures (`try {}` catch ignores errors).

4. **Group sessions dual-persistence** — group sessions are stored both in the main sessions list (`lsSaveSessions`) AND in the separate group index (`lsSaveGroup`). The merge logic in `useSessionLoader` is complex and fragile — server reloads can overwrite `gatewayIds` if the index is not consulted.

5. **`messagesCache` survives re-renders but not navigation** — but it IS backed by localStorage. The architecture comment says it "survives re-renders, not navigation" — but it IS populated from localStorage on every `loadHistory` call. The description is misleading.

## Suggestions d'amélioration architecturale
- **Remove raw setters from context** — only expose named actions. Force hooks to use the action API.
- **Extract localStorage helpers** to `lib/chat-storage.ts` with proper size limits (e.g., trim oldest messages when approaching quota).
- **Cap message list size** — keep only last N messages (e.g., 200) in memory and localStorage; fetch older history on scroll.
- **Simplify group session management** — use a single source of truth (the group index), not two overlapping stores.
