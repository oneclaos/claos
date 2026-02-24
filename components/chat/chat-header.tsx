'use client'

import { X } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { formatRelativeTime } from '@/lib/utils'
import { sessionDisplayName, isGroupSession } from '@/lib/session-utils'
import type { Session, Gateway } from '@/lib/types'

interface ChatHeaderProps {
  session: Session
  gateways: Gateway[]
  onDelete: (session: Session) => void
}

export function ChatHeader({ session, gateways, onDelete }: ChatHeaderProps) {
  const isOnline = gateways.find((g) => g.id === session.gateway)?.online ?? false

  return (
    <div className="h-14 border-b border-[var(--color-border)] flex items-center px-4 bg-white justify-between flex-shrink-0">
      <div className="flex items-center gap-3">
        <Avatar
          name={sessionDisplayName(session)}
          size="md"
          isOnline={isOnline}
        />
        <div>
          <h2 className="font-semibold text-sm text-[var(--color-text-primary)]">
            {sessionDisplayName(session)}
          </h2>
          {isGroupSession(session) && session.gatewayIds && session.gatewayIds.length > 0 ? (
            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
              {session.gatewayIds.map(id => {
                const gw = gateways.find(g => g.id === id)
                return gw ? (
                  <span key={id} className="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-elevated)] px-1.5 py-0.5 rounded-full">
                    {gw.name}
                  </span>
                ) : null
              })}
            </div>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)]">
              {isGroupSession(session) ? 'Group session' : 'Direct session'}
              {session.lastActive &&
                ` • ${formatRelativeTime(session.lastActive)}`}
            </p>
          )}
        </div>
      </div>
      <button
        onClick={() => onDelete(session)}
        className="p-1.5 hover:bg-red-50 hover:text-red-500 rounded-lg text-[var(--color-text-muted)] transition-colors"
        title="Delete conversation"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
