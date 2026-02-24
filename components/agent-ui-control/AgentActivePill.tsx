'use client'

/**
 * AgentActivePill
 *
 * Persistent indicator shown when UI Control is running.
 * Stays visible even when the user switches tabs.
 */

import { useAgentUIControl } from '@/context/agent-ui-control-context'
import { cn } from '@/lib/utils'

export function AgentActivePill() {
  const { status, stop, enabled } = useAgentUIControl()

  if (!enabled || status === 'idle') return null

  const config = {
    running: {
      label: 'Agent actif',
      dot: 'bg-green-400 animate-pulse',
      pill: 'bg-[var(--background-secondary)] border-green-500/40 text-green-400',
    },
    done: {
      label: 'Terminé',
      dot: 'bg-blue-400',
      pill: 'bg-[var(--background-secondary)] border-blue-500/40 text-blue-400',
    },
    stopped: {
      label: 'Arrêté',
      dot: 'bg-yellow-400',
      pill: 'bg-[var(--background-secondary)] border-yellow-500/40 text-yellow-400',
    },
    error: {
      label: 'Erreur',
      dot: 'bg-red-400',
      pill: 'bg-[var(--background-secondary)] border-red-500/40 text-red-400',
    },
  }[status]

  return (
    <div
      className={cn(
        'fixed top-3 left-1/2 -translate-x-1/2 z-50',
        'flex items-center gap-2 px-3 py-1.5 rounded-full',
        'border text-xs font-medium shadow-lg backdrop-blur-sm',
        'transition-all duration-300',
        config.pill,
      )}
    >
      <span className={cn('w-2 h-2 rounded-full flex-shrink-0', config.dot)} />
      <span>⚡ {config.label}</span>
      {status === 'running' && (
        <button
          onClick={stop}
          className="ml-1 hover:text-white transition-colors text-xs underline underline-offset-2"
        >
          Stop
        </button>
      )}
    </div>
  )
}
