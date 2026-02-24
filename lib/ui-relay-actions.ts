/**
 * UI Relay Actions
 *
 * Shared logic for parsing and executing <!--ui:*--> markers
 * in agent responses. Used by both FloatingAgentButton (UI control popup)
 * and the main chat message list (when uiControlEnabled is ON).
 */

import { dispatchUIRelay, UI_RELAY } from '@/lib/ui-relay-events'

// ─── Types ────────────────────────────────────────────────────────────────────

export type UIActionType =
  | 'navigate'
  | 'open-terminal'
  | 'cmd'
  | 'notify'
  | 'navigate-path'
  | 'select-file'
  | 'click-edit'
  | 'set-content'
  | 'save'
  | 'open-session'

export interface UIAction {
  type: UIActionType
  value?: string
}

/**
 * Context required by executeActions.
 * Callers (FloatingAgentButton, ChatSection, etc.) provide these callbacks
 * so that the shared executor can drive navigation, terminals, and file ops.
 */
export interface ExecuteActionsContext {
  /** AbortController to stop mid-execution */
  abort: AbortController
  /** Navigate the app to a given tab view */
  navigateToTab: (tab: string) => void
  /** Ensure a terminal is open; returns its sessionId or null on failure */
  ensureTerminal: () => Promise<string | null>
  /** Type a command into a terminal session character-by-character */
  typeCommand: (cmd: string, sessionId: string) => Promise<void>
  /** Select a chat session by its sessionKey */
  selectSessionByKey: (key: string) => void
  /** Seed value for the current terminal session (if any) */
  initialTerminalSessionId?: string | null
  /**
   * Store a pending navigation path in context so FilesView can consume it
   * on mount — avoids the CustomEvent race condition where FilesView
   * hasn't registered its listener yet when the event fires.
   */
  setPendingNavPath?: (path: string | null) => void
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Extract all <!--ui:TYPE[:VALUE]--> markers from text, in order of appearance.
 * Unknown marker types are silently ignored.
 */
export function parseUIActions(text: string): UIAction[] {
  const actions: UIAction[] = []

  // Pattern: <!--ui:TYPE[:VALUE]--> where VALUE can contain any char except -->
  const markerRe = /<!--ui:([\w-]+)(?::([\s\S]*?))?-->/g
  let match: RegExpExecArray | null

  while ((match = markerRe.exec(text)) !== null) {
    const rawType = match[1]
    const rawValue = match[2]?.trim()

    switch (rawType) {
      case 'navigate':
      case 'navigate-path':
      case 'select-file':
      case 'set-content':
      case 'open-session':
      case 'cmd':
      case 'notify':
        if (rawValue !== undefined && rawValue !== '') {
          actions.push({ type: rawType as UIActionType, value: rawValue })
        }
        break
      case 'open-terminal':
      case 'click-edit':
      case 'save':
        actions.push({ type: rawType as UIActionType })
        break
      default:
        // Unknown marker — skip silently
        break
    }
  }

  return actions
}

// ─── Stripper ─────────────────────────────────────────────────────────────────

/**
 * Remove all <!--ui:*--> markers from text so they do not re-execute
 * on the next chunk or appear in the rendered UI.
 */
export function stripMarkers(text: string): string {
  return text.replace(/<!--ui:[\w-]+(?::[^>]*)?-->/g, '')
}

// ─── Executor ─────────────────────────────────────────────────────────────────

/**
 * Execute a list of parsed UI actions in order.
 * Respects abort.signal — bails out between steps if aborted.
 */
export async function executeActions(
  actions: UIAction[],
  context: ExecuteActionsContext
): Promise<void> {
  let terminalSessionId: string | null = context.initialTerminalSessionId ?? null

  for (const action of actions) {
    if (context.abort.signal.aborted) break

    switch (action.type) {
      case 'navigate':
        context.navigateToTab(action.value ?? '')
        // Allow tab to render before next action
        await new Promise(r => setTimeout(r, 300))
        break

      case 'open-terminal':
        terminalSessionId = await context.ensureTerminal()
        break

      case 'cmd':
        if (!terminalSessionId) {
          terminalSessionId = await context.ensureTerminal()
        }
        if (terminalSessionId && action.value) {
          await context.typeCommand(action.value, terminalSessionId)
        }
        break

      case 'notify':
        // No-op: the message text serves as the notification in the chat response
        break

      case 'navigate-path':
        if (action.value) {
          // Store in context so FilesView can consume on mount (race-condition safe).
          // Also dispatch CustomEvent for cases where FilesView is already mounted.
          context.setPendingNavPath?.(action.value)
          dispatchUIRelay(UI_RELAY.FILES_NAVIGATE_PATH, { path: action.value })
          await new Promise(r => setTimeout(r, 800))
        }
        break

      case 'select-file':
        if (action.value) {
          dispatchUIRelay(UI_RELAY.FILES_SELECT_FILE, { filename: action.value })
          await new Promise(r => setTimeout(r, 400))
        }
        break

      case 'click-edit':
        dispatchUIRelay(UI_RELAY.FILES_CLICK_EDIT, {})
        await new Promise(r => setTimeout(r, 150))
        break

      case 'set-content':
        if (action.value !== undefined) {
          dispatchUIRelay(UI_RELAY.FILES_SET_CONTENT, { content: action.value })
          await new Promise(r => setTimeout(r, 100))
        }
        break

      case 'save':
        dispatchUIRelay(UI_RELAY.FILES_SAVE, {})
        await new Promise(r => setTimeout(r, 300))
        break

      case 'open-session': {
        context.navigateToTab('chat')
        await new Promise(r => setTimeout(r, 300))
        if (action.value) {
          context.selectSessionByKey(action.value)
        }
        break
      }
    }
  }
}
