/**
 * UI Relay Events
 *
 * Typed CustomEvent system for the Agent UI Relay.
 * Allows FloatingAgentButton to dispatch actions to components
 * that own their own local state (e.g. FilesView) without requiring
 * a full context refactor.
 *
 * Pattern:
 *   FloatingAgentButton  →  dispatchUIRelay(...)  →  window CustomEvent
 *   FilesView            →  addEventListener(...)  →  local state mutation
 */

// ─── Event names ─────────────────────────────────────────────────────────────

export const UI_RELAY = {
  /** Navigate FilesView to a directory path */
  FILES_NAVIGATE_PATH: 'ui-relay:files:navigate-path',
  /** Select a file by filename in the current directory listing */
  FILES_SELECT_FILE:   'ui-relay:files:select-file',
  /** Click the Edit button in the Files preview panel */
  FILES_CLICK_EDIT:    'ui-relay:files:click-edit',
  /** Replace the file editor content */
  FILES_SET_CONTENT:   'ui-relay:files:set-content',
  /** Trigger file save */
  FILES_SAVE:          'ui-relay:files:save',
} as const

export type UIRelayEvent = (typeof UI_RELAY)[keyof typeof UI_RELAY]

// ─── Payload types ────────────────────────────────────────────────────────────

export interface UIRelayPayloads {
  [UI_RELAY.FILES_NAVIGATE_PATH]: { path: string }
  [UI_RELAY.FILES_SELECT_FILE]:   { filename: string }
  [UI_RELAY.FILES_CLICK_EDIT]:    Record<string, never>
  [UI_RELAY.FILES_SET_CONTENT]:   { content: string }
  [UI_RELAY.FILES_SAVE]:          Record<string, never>
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export function dispatchUIRelay<E extends UIRelayEvent>(
  event: E,
  payload: UIRelayPayloads[E]
): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(event, { detail: payload }))
}

// ─── Listener helper ─────────────────────────────────────────────────────────

export function onUIRelay<E extends UIRelayEvent>(
  event: E,
  handler: (payload: UIRelayPayloads[E]) => void
): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<UIRelayPayloads[E]>).detail)
  window.addEventListener(event, listener)
  return () => window.removeEventListener(event, listener)
}
