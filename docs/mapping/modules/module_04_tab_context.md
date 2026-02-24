# Module: TabContext (`context/tab-context.tsx`)

## Rôle
React context managing the multi-tab navigation system — tab lifecycle (open, close, activate, navigate), localStorage persistence with debounce, unread badge tracking, keyboard navigation, and closed-tab restoration.

## Responsabilités principales
- **Tab CRUD**: `openTab`, `closeTab`, `activateTab`, `navigateActiveTab`
- **Persistence**: debounced (200ms) `localStorage.setItem(TAB_STORAGE_KEY, ...)` on every tabs/activeTabId change; reads on mount (SSR-safe)
- **Schema validation**: `TabStorageSchema.safeParse()` on localStorage read — corrupt state is discarded gracefully
- **Keyboard navigation**: `goToNextTab`, `goToPrevTab` (also wrapped by `useTabKeyboard` hook)
- **Closed-tab stack**: `reopenLastClosedTab()` — bounded ring buffer of last 10 closed tabs
- **Unread tracking**: `markTabUnread(id, count)`, `clearTabUnread(id)` — active tab is never marked unread
- **Default state**: always initializes with a single 'chat' tab if localStorage is empty or corrupt
- **Hydration**: builds state from localStorage on first mount (client-side only), shows empty state during SSR

## Dépendances internes
- `lib/tab-types.ts` — `Tab`, `TabView`, `TabStorage`, `createTab`, `TabStorageSchema`, constants

## Dépendances externes
- `react` (createContext, useCallback, useContext, useEffect, useRef, useState)
- Browser `localStorage` + `crypto.randomUUID()`

## Ce qui dépend de lui
- `app/(dashboard)/page.tsx` — renders `TabInstance` per tab
- `components/tabs/TabBar.tsx` — renders the tab bar
- `components/tabs/TabItem.tsx` — individual tab UI
- `components/tabs/TabOverflowMenu.tsx` — overflow tab list
- `hooks/useTabKeyboard.ts` — wraps `goToNextTab`/`goToPrevTab` for keyboard shortcuts
- `hooks/useTabNotifications.ts` — calls `markTabUnread`
- `hooks/useMessageSender.ts` — reads `tabs`, `markTabUnread` for notification badges

## Flux de données entrants
- User interactions (click to open/close/switch tabs)
- Keyboard events (via `useTabKeyboard`)
- Notification triggers from `useMessageSender` (unread badge updates)
- localStorage on mount (tab state restoration)

## Flux de données sortants
- Current `tabs` array and `activeTab` to all consumers
- localStorage write on every change (debounced 200ms)
- `isActive`, `hasUnread`, `unreadCount` on each `Tab` object

## Risques / Couplages forts

1. **Schema versioning mismatch** — `lib/tab-types.ts` defines v1, v2, v3 Zod schemas but `tab-context.tsx` uses `TAB_STORAGE_VERSION = 1` and `TabStorageSchema` (v1). Users who had data saved in v2 or v3 format would silently get a default tab (fresh state) instead of their restored tabs — migration code from v2/v3 is never called.

2. **`setTabsWithActive` declared but never called** — it's defined in the provider and then explicitly suppressed with `void setTabsWithActive` in the dependency array comment. It appears to be dead code that was never removed after a refactor.

3. **`openTab` does not debounce or deduplicate** — rapidly opening the same tab view creates multiple identical tabs. There is no deduplication logic (e.g., "don't open a second 'chat' tab if one already exists").

4. **`activateTab` clears unread in the same setter** — combining tab activation with unread clearing makes it difficult to track "when did the user first see this message" precisely.

## Suggestions d'amélioration architecturale
- **Add migration path** from v1 → current storage format; check the persisted `version` field and migrate gracefully rather than falling back to default.
- **Remove `setTabsWithActive`** if it's truly unused.
- **Add tab deduplication** for single-section tabs (e.g., only one terminal tab, one files tab).
- **Expose `findOrOpenTab(view)`** — opens a tab if it doesn't exist, otherwise activates the existing one.
