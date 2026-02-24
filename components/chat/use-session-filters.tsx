'use client'

import { useMemo } from 'react'
import type { Session } from '@/lib/types'
import { isGroupSession, deduplicateForDisplay } from '@/lib/session-utils'

interface UseSessionFiltersOptions {
  sessions: Session[]
  selectedSession: Session | null
}

/**
 * Hook that filters and deduplicates sessions for display.
 * Separates app-created sessions from all gateway sessions.
 */
export function useSessionFilters({ sessions, selectedSession }: UseSessionFiltersOptions) {
  // appSessions: Claos-created sessions (for Messages sidebar + count badge)
  const appSessions = useMemo(
    () => sessions.filter((s) =>
      s.sessionKey.startsWith('claos-') && !s.sessionKey.endsWith('-main')
    ),
    [sessions]
  )

  // Dedup by gateway — prefer selected session, then sessions with existing messages, then newest
  const directSessions = useMemo(() => {
    const filtered = appSessions.filter((s) => !isGroupSession(s))
    const byGateway = new Map<string, Session[]>()
    for (const s of filtered) {
      const list = byGateway.get(s.gateway) ?? []
      list.push(s)
      byGateway.set(s.gateway, list)
    }
    return Array.from(byGateway.values()).map((candidates) => {
      // ALWAYS prefer the selected session if it's in this gateway group
      const selected = candidates.find(c => c.sessionKey === selectedSession?.sessionKey)
      if (selected) return selected
      // Prefer the session with messages in localStorage
      const withMessages = candidates.find(
        (s) => typeof window !== 'undefined' && !!localStorage.getItem(`claos:msgs:${s.sessionKey}`)
      )
      if (withMessages) return withMessages
      // Fall back to most recent by timestamp
      return candidates.sort((a, b) => {
        const ta = a.lastActive ? new Date(a.lastActive).getTime() : parseInt(a.sessionKey.match(/-(\d{10,})$/)?.[1] ?? '0')
        const tb = b.lastActive ? new Date(b.lastActive).getTime() : parseInt(b.sessionKey.match(/-(\d{10,})$/)?.[1] ?? '0')
        return tb - ta
      })[0]
    })
  }, [appSessions, selectedSession])

  const groupSessions = useMemo(
    () => deduplicateForDisplay(
      // isGroupSession (sessionKey starts with claos-multiagent-) is the source of truth
      // Don't filter on gatewayIds.length — they may be missing if session came from server without index
      appSessions.filter((s) => isGroupSession(s)),
      (s) => s.sessionKey // sessionKey is the canonical unique id for group sessions
    ),
    [appSessions]
  )

  return {
    appSessions,
    directSessions,
    groupSessions,
  }
}
