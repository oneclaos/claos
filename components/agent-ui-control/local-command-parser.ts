/**
 * Local command parser (no AI needed for simple navigation)
 */

import type { UIAction } from '@/lib/ui-relay-actions'

const NAV_KEYWORDS: Record<string, string> = {
  terminal: 'terminal',
  terminale: 'terminal',
  terme: 'terminal',
  files: 'files',
  fichiers: 'files',
  file: 'files',
  status: 'status',
  statut: 'status',
  état: 'status',
  settings: 'settings',
  setting: 'settings',
  paramètres: 'settings',
  parametres: 'settings',
  config: 'settings',
  chat: 'chat',
  messages: 'chat',
  conversation: 'chat',
}

/**
 * Attempts to parse a command locally without AI.
 * Returns UIAction[] if successful, null if AI is needed.
 */
export function tryParseLocally(command: string): UIAction[] | null {
  const lower = command.toLowerCase().trim()

  const hasTerminal = /terminal|terminale/.test(lower)
  const hasOpen = /open|ouvr|lance|start|démarre|demarr/.test(lower)

  // Check for navigation keywords
  for (const [keyword, tab] of Object.entries(NAV_KEYWORDS)) {
    const re = new RegExp(`\\b${keyword}\\b`)
    if (re.test(lower)) {
      const actions: UIAction[] = [{ type: 'navigate', value: tab }]
      if (tab === 'terminal' && hasOpen) {
        actions.push({ type: 'open-terminal' })
      }
      return actions
    }
  }

  // Special case: "open terminal" without specific tab keyword
  if (hasTerminal && hasOpen) {
    return [{ type: 'navigate', value: 'terminal' }, { type: 'open-terminal' }]
  }

  return null
}
