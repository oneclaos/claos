'use client'

import { useState } from 'react'
import { Loader2, Trash2, Server } from 'lucide-react'
import { cn, formatRelativeTime } from '@/lib/utils'
import { isGroupSession } from '@/lib/session-utils'
import type { Session, Gateway } from '@/lib/types'

interface SessionsTabProps {
  sessions: Session[]
  gateways: Gateway[]
  loading: boolean
  onDelete: (session: Session) => Promise<void>
  onOpenInMessages: (session: Session) => void
}

export function SessionsTab({
  sessions,
  gateways,
  loading,
  onDelete,
  onOpenInMessages,
}: SessionsTabProps) {
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  const handleDelete = async (session: Session) => {
    setDeletingKey(session.sessionKey)
    await onDelete(session)
    setDeletingKey(null)
  }

  const getGatewayLabel = (session: Session): string => {
    const gw = gateways.find((g) => g.id === session.gateway)
    if (!gw) return session.gatewayName ?? session.gateway
    const port = gw.port ? ` · :${gw.port}` : ''
    return `${gw.name}${port}`
  }

  const getGatewayOnline = (session: Session): boolean =>
    gateways.find((g) => g.id === session.gateway)?.online ?? false

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <Server className="h-12 w-12 mb-3 opacity-40" />
        <p className="text-sm font-medium">No sessions on gateway</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-2 max-w-3xl mx-auto w-full">
      {sessions.map((session) => (
        <div
          key={`${session.gateway}:${session.sessionKey}`}
          className="flex items-center gap-3 p-3 rounded-lg border bg-white hover:bg-gray-50 transition-colors group"
        >
          {/* Online dot */}
          <div
            className={cn(
              'w-2 h-2 rounded-full flex-shrink-0 mt-0.5',
              getGatewayOnline(session) ? 'bg-green-500' : 'bg-gray-300'
            )}
          />

          {/* Main info — clickable */}
          <button
            onClick={() => onOpenInMessages(session)}
            className="flex-1 min-w-0 text-left"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm truncate">{session.sessionKey}</span>
              <span
                className={cn(
                  'text-xs px-1.5 py-0.5 rounded-full flex-shrink-0',
                  isGroupSession(session)
                    ? 'bg-purple-100 text-purple-600'
                    : 'bg-blue-50 text-blue-600'
                )}
              >
                {session.kind ?? (isGroupSession(session) ? 'group' : 'direct')}
              </span>
              {/* Channel badge extracted from rawKey e.g. agent:telegram:xxx → telegram */}
              {session.rawKey && (() => {
                const channelMatch = session.rawKey.match(/^agent:([^:]+):/)
                const ch = channelMatch?.[1]
                if (!ch || ch === 'main') return null
                return (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 flex-shrink-0">
                    {ch}
                  </span>
                )
              })()}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-gray-500">{getGatewayLabel(session)}</span>
              {session.lastActive && (
                <span
                  className="text-xs text-gray-400"
                  title={new Date(session.lastActive).toLocaleString()}
                >
                  · {formatRelativeTime(session.lastActive)}
                  <span className="ml-1 text-gray-300">
                    ({new Date(session.lastActive).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })})
                  </span>
                </span>
              )}
            </div>
          </button>

          {/* Delete button */}
          <button
            onClick={() => handleDelete(session)}
            disabled={deletingKey === session.sessionKey}
            className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50 flex-shrink-0"
            title="Delete session"
          >
            {deletingKey === session.sessionKey ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </div>
      ))}
    </div>
  )
}
