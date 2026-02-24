'use client'

import { useCallback, useRef } from 'react'
import { useChat } from '@/context/chat-context'
import { useToast } from '@/components/ui/toast'
import { fetchWithCsrf } from '@/lib/csrf-client'
import type { Session, Gateway } from '@/lib/types'
import { isGroupSession } from '@/lib/session-utils'
import { useSessionLoader } from '@/hooks/useSessionLoader'

interface ChatSessionManagerProps {
  onSessionSelected?: (session: Session) => void
}

export function useChatSessionManager({ onSessionSelected }: ChatSessionManagerProps = {}) {
  const toast = useToast()
  const {
    sessions,
    selectedSession,
    messagesCache,
    lsSaveSessions,
    lsRemoveMessages,
    lsSaveSelectedSession,
    lsLoadSelectedSession,
    lsSaveGroup,
    lsRemoveGroup,
    appendSession,
    removeSession,
    selectSession: ctxSelectSession,
  } = useChat()

  const { localSessionsRef } = useSessionLoader()

  // ── Select session with optional callback ────────────────────────────────
  const selectSession = useCallback(
    (session: Session | null) => {
      ctxSelectSession(session)
      if (session && onSessionSelected) {
        onSessionSelected(session)
      }
    },
    [ctxSelectSession, onSessionSelected]
  )

  // ── Create a fresh session for a single agent ────────────────────────────
  const createDirectSession = useCallback(
    async (gateway: Gateway): Promise<Session> => {
      // ALWAYS create a new session with unique sessionKey
      // This ensures complete isolation between conversations
      const targetKey = `claos-${gateway.id}-${Date.now()}`
      const virtualSession: Session = {
        sessionKey: targetKey,
        gateway: gateway.id,
        gatewayName: gateway.name,
        kind: 'direct',
      }
      localSessionsRef.current.set(targetKey, virtualSession)
      appendSession(virtualSession)
      lsSaveSessions([...sessions, virtualSession])
      selectSession(virtualSession)
      return virtualSession
    },
    [selectSession, lsSaveSessions, localSessionsRef, appendSession, sessions]
  )

  // ── Create group session ──────────────────────────────────────────────────
  const createGroupSession = useCallback(
    async (gateways: Gateway[]): Promise<Session> => {
      if (gateways.length < 2) {
        toast.error('Select at least 2 agents for a group')
        throw new Error('Insufficient gateways for group')
      }

      const groupSessionKey = `claos-multiagent-${Date.now()}`

      try {
        // Sequential spawns to avoid CSRF token collision on parallel requests
        for (const gw of gateways) {
          const res = await fetchWithCsrf('/api/sessions/spawn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gatewayId: gw.id, sessionKey: groupSessionKey }),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error((err as { error?: string }).error || `Failed to create session on ${gw.name}`)
          }
        }

        const groupSession: Session = {
          sessionKey: groupSessionKey,
          gateway: gateways[0].id,
          gatewayName: gateways.map(g => g.name).join(' + '),
          kind: 'group',
          customName: gateways.map(g => g.name).join(' + '),
          gatewayIds: gateways.map(g => g.id),
        }
        localSessionsRef.current.set(groupSessionKey, groupSession)
        lsSaveGroup(groupSession)
        appendSession(groupSession)
        lsSaveSessions([...sessions, groupSession])
        selectSession(groupSession)
        toast.success('Group session created')
        return groupSession
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to create group session')
        throw err
      }
    },
    [toast, lsSaveSessions, lsSaveGroup, localSessionsRef, appendSession, sessions, selectSession]
  )

  // ── Delete session ────────────────────────────────────────────────────────
  const deleteSession = useCallback(
    async (session: Session) => {
      const dedupKey = `${session.gateway}:${session.sessionKey}`
      try {
        if (isGroupSession(session) && session.gatewayIds && session.gatewayIds.length > 1) {
          // Delete from all gateways in parallel for group sessions
          await Promise.allSettled(
            session.gatewayIds.map(gwId =>
              fetchWithCsrf(
                `/api/sessions/${encodeURIComponent(session.sessionKey)}?gatewayId=${encodeURIComponent(gwId)}`,
                { method: 'DELETE' }
              )
            )
          )
        } else {
          const rawKeyParam = session.rawKey
            ? `&rawKey=${encodeURIComponent(session.rawKey)}`
            : ''
          await fetchWithCsrf(
            `/api/sessions/${encodeURIComponent(session.sessionKey)}?gatewayId=${encodeURIComponent(session.gateway)}${rawKeyParam}`,
            { method: 'DELETE' }
          )
        }
        removeSession(session.sessionKey, session.gateway)
        try {
          const hiddenRaw = localStorage.getItem('claos_hidden_sessions') ?? '[]'
          const hidden: string[] = JSON.parse(hiddenRaw)

          // Hide the deleted session
          if (!hidden.includes(dedupKey)) hidden.push(dedupKey)
          lsRemoveMessages(session.sessionKey)
          lsRemoveGroup(session.sessionKey)

          // Also hide + delete all other claos sessions for the same gateway
          // (directSessions deduplicates, so orphaned sessions would reappear on refresh)
          const siblingSessions = sessions.filter(
            (s) =>
              s.gateway === session.gateway &&
              s.sessionKey !== session.sessionKey &&
              s.sessionKey.startsWith('claos-') &&
              !isGroupSession(s)
          )
          for (const s of siblingSessions) {
            const sibKey = `${s.gateway}:${s.sessionKey}`
            if (!hidden.includes(sibKey)) hidden.push(sibKey)
            lsRemoveMessages(s.sessionKey)
            fetchWithCsrf(
              `/api/sessions/${encodeURIComponent(s.sessionKey)}?gatewayId=${encodeURIComponent(s.gateway)}`,
              { method: 'DELETE' }
            ).catch(() => {})
            removeSession(s.sessionKey, s.gateway)
          }

          localStorage.setItem('claos_hidden_sessions', JSON.stringify(hidden))

          const updatedSessions = sessions.filter(
            (s) => !(s.sessionKey === session.sessionKey && s.gateway === session.gateway)
              && !siblingSessions.some((sib) => sib.sessionKey === s.sessionKey && sib.gateway === s.gateway)
          )
          lsSaveSessions(updatedSessions)
          const lastSession = lsLoadSelectedSession()
          if (lastSession?.sessionKey === session.sessionKey) {
            lsSaveSelectedSession(null)
          }
        } catch { /* ignore localStorage errors */ }
        messagesCache.current.delete(session.sessionKey)
        if (selectedSession?.sessionKey === session.sessionKey && selectedSession?.gateway === session.gateway) {
          ctxSelectSession(null)
        }
        toast.success('Session deleted')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to delete session')
      }
    },
    [
      selectedSession,
      sessions,
      toast,
      lsRemoveMessages,
      lsRemoveGroup,
      lsSaveSessions,
      lsLoadSelectedSession,
      lsSaveSelectedSession,
      removeSession,
      ctxSelectSession,
      messagesCache,
    ]
  )

  return {
    selectSession,
    createDirectSession,
    createGroupSession,
    deleteSession,
  }
}
