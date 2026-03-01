'use client'

import { useState } from 'react'
import { cn, formatRelativeTime } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Plus, Users, Search } from 'lucide-react'
import type { Session } from '@/lib/types'

interface SessionItemProps {
  session: Session
  isSelected: boolean
  isOnline: boolean
  displayName: string
  onClick: () => void
  onDelete: (session: Session) => void
  isGroup?: boolean
}

// Read last message preview from localStorage when session.lastMessage is absent
function getLastMsgPreview(sessionKey: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(`claos:msgs:${sessionKey}`)
    if (!raw) return null
    const msgs = JSON.parse(raw)
    if (!Array.isArray(msgs) || msgs.length === 0) return null
    // Find last non-empty assistant or user message
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (typeof m?.content === 'string' && m.content.trim()) {
        return m.content.slice(0, 80)
      }
    }
    return null
  } catch {
    return null
  }
}

function SessionItem({
  session,
  isSelected,
  isOnline,
  displayName,
  onClick,
  isGroup = false,
}: Omit<SessionItemProps, 'onDelete'>) {
  const lastMsg = session.lastMessage || getLastMsgPreview(session.sessionKey)
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2.5 rounded-xl mb-1 transition-all duration-150',
        'flex items-center gap-3',
        isSelected
          ? 'bg-[oklch(0.70_0.20_46_/_0.08)] border border-[oklch(0.70_0.20_46_/_0.15)]'
          : 'hover:bg-[var(--color-bg-elevated)] border border-transparent'
      )}
    >
      <Avatar name={displayName} size="md" isOnline={isOnline} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span
            className={cn(
              'text-sm font-medium truncate',
              isSelected ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
            )}
          >
            {displayName}
          </span>
          {session.lastActive && (
            <span className="text-[10px] text-[var(--color-text-muted)] flex-shrink-0">
              {formatRelativeTime(session.lastActive)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          {lastMsg ? (
            <p className="text-xs text-[var(--color-text-muted)] truncate flex-1">{lastMsg}</p>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)] italic flex-1">No messages yet</p>
          )}
          {isGroup && (
            <Badge variant="info" className="flex-shrink-0">
              group
            </Badge>
          )}
        </div>
      </div>
    </button>
  )
}

interface SessionsSidebarProps {
  directSessions: Session[]
  groupSessions: Session[]
  selectedSession: Session | null
  loadingSessions: boolean
  isOnline: (session: Session) => boolean
  displayName: (session: Session) => string
  onSelect: (session: Session) => void
  onDelete: (session: Session) => void
  onNewChat: () => void
  onNewGroup: () => void
}

export function SessionsSidebar({
  directSessions,
  groupSessions,
  selectedSession,
  loadingSessions,
  isOnline,
  displayName,
  onSelect,
  onDelete: _onDelete,
  onNewChat,
  onNewGroup,
}: SessionsSidebarProps) {
  const [search, setSearch] = useState('')

  const filterSession = (s: Session) => {
    if (!search.trim()) return true
    return displayName(s).toLowerCase().includes(search.toLowerCase())
  }

  const filteredDirect = directSessions.filter(filterSession)
  const filteredGroups = groupSessions.filter(filterSession)
  const hasAny = filteredDirect.length > 0 || filteredGroups.length > 0

  return (
    <div className="w-72 h-full border-r border-[var(--color-border)] flex flex-col bg-white flex-shrink-0">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[var(--color-border)] flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Messages</h2>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onNewChat}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-dark)] transition-colors"
              title="New Chat"
            >
              <Plus className="h-3 w-3" />
              New
            </button>
            <button
              onClick={onNewGroup}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
              title="New Group"
            >
              <Users className="h-3 w-3" />
              Group
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--color-bg-elevated)] rounded-xl border border-transparent focus:border-[var(--color-border)] focus:outline-none text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-colors"
          />
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto p-2">
        {loadingSessions && directSessions.length === 0 && groupSessions.length === 0 && (
          <p className="text-center text-[var(--color-text-muted)] py-8 text-xs">Loading…</p>
        )}

        {!loadingSessions && !hasAny && (
          <p className="text-center text-[var(--color-text-muted)] py-8 text-xs">
            {search ? 'No results' : 'No conversations yet'}
          </p>
        )}

        {filteredDirect.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest px-3 pb-1">
              Direct
            </p>
            {filteredDirect.map((session) => (
              <SessionItem
                key={`${session.gateway}:${session.sessionKey}`}
                session={session}
                isSelected={
                  selectedSession?.sessionKey === session.sessionKey &&
                  selectedSession?.gateway === session.gateway
                }
                isOnline={isOnline(session)}
                displayName={displayName(session)}
                onClick={() => onSelect(session)}
              />
            ))}
          </div>
        )}

        {filteredGroups.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest px-3 pb-1">
              Groups
            </p>
            {filteredGroups.map((session) => (
              <SessionItem
                key={`${session.gateway}:${session.sessionKey}`}
                session={session}
                isSelected={
                  selectedSession?.sessionKey === session.sessionKey &&
                  selectedSession?.gateway === session.gateway
                }
                isOnline={isOnline(session)}
                displayName={displayName(session)}
                onClick={() => onSelect(session)}
                isGroup
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
