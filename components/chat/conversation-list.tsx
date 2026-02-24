'use client'

import { useMemo } from 'react'
import { cn, formatRelativeTime } from '@/lib/utils'
import type { Session } from '@/lib/types'
import { MessageSquare, Pencil, Trash2 } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

interface ConversationListProps {
  sessions: Session[]
  selectedId: string | null
  onSelect: (session: Session) => void
  onRename: (sessionKey: string, currentName: string) => void
  onDelete: (sessionKey: string) => void
  searchQuery?: string
  isLoading?: boolean
}

export function ConversationList({
  sessions,
  selectedId,
  onSelect,
  onRename,
  onDelete,
  searchQuery = '',
  isLoading = false,
}: ConversationListProps) {
  // Filter sessions based on search
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions

    const query = searchQuery.toLowerCase()
    return sessions.filter((session) => {
      const name = session.customName || session.gatewayName || session.sessionKey
      return (
        name.toLowerCase().includes(query) ||
        session.channel?.toLowerCase().includes(query) ||
        session.lastMessage?.toLowerCase().includes(query)
      )
    })
  }, [sessions, searchQuery])

  // Sort by last activity (most recent first)
  const sortedSessions = useMemo(() => {
    return [...filteredSessions].sort((a, b) => {
      const dateA = new Date(a.lastActive || 0).getTime()
      const dateB = new Date(b.lastActive || 0).getTime()
      return dateB - dateA
    })
  }, [filteredSessions])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--primary)]" />
      </div>
    )
  }

  if (sortedSessions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-[var(--muted)] flex items-center justify-center mb-4">
          <MessageSquare className="w-8 h-8 text-[var(--foreground-muted)]" />
        </div>
        <h3 className="text-lg font-medium text-[var(--foreground)] mb-1">
          {searchQuery ? 'No results found' : 'No conversations yet'}
        </h3>
        <p className="text-sm text-[var(--foreground-muted)]">
          {searchQuery ? 'Try a different search term' : 'Start a new chat to begin'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <ul className="divide-y divide-[var(--border)]" role="listbox">
        {sortedSessions.map((session) => {
          const displayName = session.customName || session.gatewayName || session.sessionKey
          const isSelected = session.sessionKey === selectedId

          return (
            <li key={session.sessionKey}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    data-conversation
                    data-selected={isSelected}
                    onClick={() => onSelect(session)}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 text-left',
                      'transition-colors duration-150',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]',
                      'hover:bg-[var(--muted)]',
                      isSelected && 'bg-[var(--primary)]/10 border-l-3 border-l-[var(--primary)]'
                    )}
                    role="option"
                    aria-selected={isSelected}
                  >
                    {/* Avatar */}
                    <div
                      className={cn(
                        'w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 text-white font-semibold text-lg',
                        'bg-gradient-to-br',
                        'from-blue-500 to-blue-600'
                      )}
                    >
                      {displayName.charAt(0).toUpperCase()}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="font-medium text-[var(--foreground)] truncate">
                          {displayName}
                        </span>
                        {session.lastActive && (
                          <span className="text-xs text-[var(--foreground-muted)] tabular-nums flex-shrink-0">
                            {formatRelativeTime(session.lastActive)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-[var(--foreground-muted)] truncate">
                          {session.lastMessage || session.channel || 'No messages'}
                        </p>
                        {session.messageCount && session.messageCount > 0 && (
                          <span className="flex-shrink-0 text-xs bg-[var(--primary)] text-white rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                            {session.messageCount > 99 ? '99+' : session.messageCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </ContextMenuTrigger>

                <ContextMenuContent className="w-48">
                  <ContextMenuItem
                    onClick={() => onRename(session.sessionKey, displayName)}
                    className="gap-2"
                  >
                    <Pencil className="w-4 h-4" />
                    Rename
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() => onDelete(session.sessionKey)}
                    className="gap-2 text-red-600 dark:text-red-400 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
