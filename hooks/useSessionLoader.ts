'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useChat, LS_SESSIONS } from '@/context/chat-context'
import type { Session, Gateway, Message } from '@/lib/types'

/**
 * useSessionLoader
 *
 * Handles:
 *  - Gateway discovery (fetch + exponential-backoff retry)
 *  - Session loading from API (merged with local virtual sessions + group index)
 *  - History loading (memory cache → localStorage → server)
 *  - Session selection (data side; UI panels are handled by the page)
 *  - Session auto-restore from localStorage on first render
 *
 * Returns: { loadSessions, loadHistory, selectSession, localSessionsRef }
 */
export function useSessionLoader() {
  const {
    sessions,
    setSessions,
    setGateways,
    selectedSession,
    setSelectedSession,
    setMessages,
    setLoadingHistory,
    setLoadingSessions,
    messagesCache,
    lsSaveSessions,
    lsSaveMessages,
    lsLoadMessages,
    lsSaveSelectedSession,
    lsLoadSelectedSession,
    lsLoadGroups,
    lsSaveGroup,
  } = useChat()

  // Local sessions that haven't hit the server yet (virtual / pending)
  const localSessionsRef = useRef<Map<string, Session>>(new Map())

  // ── Load gateways with exponential-backoff retry ──────────────────────────
  useEffect(() => {
    let cancelled = false
    let attempt = 0
    const load = async () => {
      while (!cancelled) {
        try {
          const r = await fetch('/api/gateways', { signal: AbortSignal.timeout(8000) })
          const data: { gateways?: Gateway[] } = await r.json()
          const list = data.gateways ?? []
          if (!cancelled) setGateways(list)
          if (list.length > 0) {
            fetch('/api/chat/warmup').catch(() => {})
            return
          }
        } catch (e) {
          if (!cancelled) console.warn('Gateways fetch attempt', attempt + 1, 'failed:', e)
        }
        attempt++
        if (cancelled) return
        await new Promise((r) =>
          setTimeout(r, Math.min(2000 * Math.pow(2, Math.min(attempt - 1, 2)), 15000))
        )
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [setGateways])

  // ── Load sessions from API — merge with local virtual sessions ─────────────
  const loadSessions = useCallback(async (): Promise<Session[]> => {
    setLoadingSessions(true)
    try {
      const res = await fetch('/api/sessions', { signal: AbortSignal.timeout(10000) })
      const data = (await res.json()) as { sessions?: Session[] }

      // Filter out sessions the user has deleted (persisted in localStorage)
      const hiddenRaw = localStorage.getItem('claos_hidden_sessions') ?? '[]'
      const hidden: string[] = JSON.parse(hiddenRaw)
      const serverList = (data.sessions ?? []).filter(
        (s) => !hidden.includes(`${s.gateway}:${s.sessionKey}`)
      )

      // Promote confirmed sessions (remove from localRef if server has them)
      // Exception: never delete group sessions from localRef — managed by the group index
      for (const s of serverList) {
        if (!s.sessionKey.startsWith('claos-multiagent-') && s.kind !== 'group') {
          localSessionsRef.current.delete(s.sessionKey)
        }
      }

      const isGroupKey = (s: Session) =>
        s.sessionKey.startsWith('claos-multiagent-') || s.kind === 'group'

      // Always inject saved group sessions from index (guarantees gatewayIds survival)
      const savedGroups = lsLoadGroups()
      const savedGroupMap = new Map(savedGroups.map((g) => [g.sessionKey, g]))

      // Merge: local (pending) sessions first, then override with server data
      const localList = Array.from(localSessionsRef.current.values()).filter((s) => !isGroupKey(s))
      const serverNonGroup = serverList.filter((s) => !isGroupKey(s))

      // Deduplicate: server sessions override local ones (server has rawKey for deletion)
      const seen = new Map<string, Session>()

      // First pass: add all local sessions
      for (const s of localList) {
        const key = `${s.gateway}:${s.sessionKey}`
        seen.set(key, s)
      }

      // Second pass: override with server sessions (preserve customName if missing)
      for (const s of serverNonGroup) {
        const key = `${s.gateway}:${s.sessionKey}`
        const existing = seen.get(key)
        if (existing?.customName && !s.customName) {
          seen.set(key, { ...s, customName: existing.customName })
        } else {
          seen.set(key, s)
        }
      }

      // Merge group sessions from index — always authoritative for customName + gatewayIds
      const serverGroupGwNames = new Map<string, string[]>()
      const serverGroupGwIds = new Map<string, string[]>()
      for (const s of serverList) {
        if (isGroupKey(s)) {
          const ids = serverGroupGwIds.get(s.sessionKey) ?? []
          if (!ids.includes(s.gateway)) ids.push(s.gateway)
          serverGroupGwIds.set(s.sessionKey, ids)
          if (s.gatewayName) {
            const names = serverGroupGwNames.get(s.sessionKey) ?? []
            if (!names.includes(s.gatewayName)) names.push(s.gatewayName)
            serverGroupGwNames.set(s.sessionKey, names)
          }
        }
      }
      for (const [key, group] of savedGroupMap.entries()) {
        const serverIds = serverGroupGwIds.get(key) ?? []
        const mergedIds = Array.from(
          new Set([...(group.gatewayIds ?? [group.gateway]), ...serverIds])
        )
        seen.set(key, { ...group, gatewayIds: mergedIds })
      }
      // Also add group sessions from server that aren't in our index yet (edge case)
      for (const [key, ids] of serverGroupGwIds.entries()) {
        if (!savedGroupMap.has(key)) {
          const names = serverGroupGwNames.get(key) ?? []
          const s = serverList.find((x) => x.sessionKey === key)
          if (s) seen.set(key, { ...s, customName: names.join(' + '), gatewayIds: ids })
        }
      }

      const merged = Array.from(seen.values())
      setSessions(merged)
      lsSaveSessions(merged)
      return merged
    } catch (e) {
      console.error('Failed to load sessions:', e)
      return []
    } finally {
      setLoadingSessions(false)
    }
  }, [lsSaveSessions, lsLoadGroups, setSessions, setLoadingSessions])

  // Track the active session key for async guards
  const activeHistorySessionRef = useRef<string | null>(null)

  // ── Load history (memory cache → localStorage → server) ──────────────────
  const loadHistory = useCallback(
    async (session: Session) => {
      const sessionKey = session.sessionKey
      activeHistorySessionRef.current = sessionKey

      // 1. Memory cache — instant (no flicker on tab switch)
      const inMemory = messagesCache.current.get(sessionKey)
      if (inMemory && inMemory.length > 0) {
        if (activeHistorySessionRef.current === sessionKey) setMessages(inMemory)
        return
      }

      // For group sessions: skip server fetch — group messages live in localStorage only.
      // The gateway would return the primary session's history (wrong), since group sessions
      // are created lazily and have no server-side history until a message is sent.
      const isGroup = sessionKey.startsWith('claos-multiagent-')
      if (isGroup) {
        const fromLS = lsLoadMessages(sessionKey).filter((m) => {
          if (
            m.role === 'user' &&
            (m.content.includes('[📋 GROUP CHAT:') ||
              m.content.includes('*Other agents already responded:*') ||
              /\*Conversation so far:\*/.test(m.content))
          )
            return false
          return true
        })
        messagesCache.current.set(sessionKey, fromLS)
        if (activeHistorySessionRef.current === sessionKey) setMessages(fromLS)
        return
      }

      const isInjectedContextMsg = (role: string, content: string): boolean => {
        // Filter injected group chat context messages
        if (
          role === 'user' &&
          (content.includes('[📋 GROUP CHAT:') ||
            content.includes('*Other agents already responded:*') ||
            content.includes('---\n*Conversation so far:*') ||
            /\*Other agents already responded:\*/.test(content))
        )
          return true
        // Filter gateway system/metadata messages not meant for display
        if (content.startsWith('Conversation info (untrusted metadata)')) return true
        if (role === 'system') return true
        return false
      }

      // 2. localStorage — instant on page refresh
      const fromLS = lsLoadMessages(sessionKey)
      const fromLSClean = fromLS.filter((m) => !isInjectedContextMsg(m.role, m.content))
      if (fromLSClean.length > 0 && activeHistorySessionRef.current === sessionKey) {
        setMessages(fromLSClean)
        messagesCache.current.set(sessionKey, fromLSClean)
      }

      // 3. Server — refresh in background
      if (activeHistorySessionRef.current === sessionKey) {
        setLoadingHistory(fromLSClean.length === 0)
      }

      const normalizeContent = (content: unknown): string => {
        if (typeof content === 'string') return content
        if (Array.isArray(content)) {
          return content
            .map((block: unknown) => {
              if (typeof block === 'string') return block
              if (block && typeof block === 'object' && 'text' in block)
                return String((block as { text: unknown }).text)
              return ''
            })
            .join('')
        }
        if (content && typeof content === 'object' && 'text' in content)
          return String((content as { text: unknown }).text)
        return String(content ?? '')
      }

      try {
        const res = await fetch(
          `/api/sessions/history?gatewayId=${encodeURIComponent(session.gateway)}&sessionKey=${encodeURIComponent(sessionKey)}`,
          { signal: AbortSignal.timeout(20000) }
        )
        if (activeHistorySessionRef.current !== sessionKey) return

        if (!res.ok) {
          console.warn(`History fetch failed for ${sessionKey}: HTTP ${res.status}`)
          return
        }

        const data = (await res.json()) as { messages?: Message[] }
        const msgs = (data.messages ?? [])
          .map((m) => ({ ...m, content: normalizeContent(m.content) }))
          .filter((m) => !isInjectedContextMsg(m.role, m.content))

        if (activeHistorySessionRef.current !== sessionKey) return

        if (msgs.length > 0) {
          messagesCache.current.set(sessionKey, msgs)
          lsSaveMessages(sessionKey, msgs)
          setMessages(msgs)
        } else if (fromLSClean.length === 0) {
          setMessages([])
        }
      } catch (e) {
        if (activeHistorySessionRef.current !== sessionKey) return
        console.error('Failed to load history:', e)
        if (fromLSClean.length === 0) setMessages([])
      } finally {
        if (activeHistorySessionRef.current === sessionKey) setLoadingHistory(false)
      }
    },
    [lsLoadMessages, lsSaveMessages, messagesCache, setMessages, setLoadingHistory]
  )

  // ── Select session (data side only — UI panels handled by page) ──────────
  const selectSession = useCallback(
    (session: Session) => {
      // For group sessions, ensure gatewayIds are preserved from the saved groups index
      let finalSession = session
      if (session.kind === 'group' || session.sessionKey.startsWith('claos-multiagent-')) {
        const savedGroups = lsLoadGroups()
        const savedGroup = savedGroups.find((g) => g.sessionKey === session.sessionKey)

        // Priority: savedGroup.gatewayIds > session.gatewayIds > error
        if (savedGroup?.gatewayIds && savedGroup.gatewayIds.length >= 2) {
          // Best case: restore from saved groups index
          finalSession = { ...session, gatewayIds: savedGroup.gatewayIds }
          console.log(
            '[selectSession] Restored gatewayIds from groups index:',
            session.sessionKey,
            savedGroup.gatewayIds
          )
        } else if (session.gatewayIds && session.gatewayIds.length >= 2) {
          // Session already has valid gatewayIds - use them and save to groups index
          finalSession = session
          lsSaveGroup(session) // Persist for future restores
          console.log(
            '[selectSession] Using existing gatewayIds, saved to groups index:',
            session.sessionKey,
            session.gatewayIds
          )
        } else {
          // No valid gatewayIds found - log error but proceed (useMessageSender will catch this)
          console.error(
            '[selectSession] Group session has no valid gatewayIds:',
            session.sessionKey
          )
        }
      }
      setSelectedSession(finalSession)
      loadHistory(finalSession)
      lsSaveSelectedSession(finalSession)
    },
    [loadHistory, lsSaveSelectedSession, setSelectedSession, lsLoadGroups, lsSaveGroup]
  )

  // ── Hydrate localSessionsRef + initial loadSessions on mount ──────────────
  useEffect(() => {
    try {
      const cached = localStorage.getItem(LS_SESSIONS)
      if (cached) {
        const cachedSessions: Session[] = JSON.parse(cached)
        for (const s of cachedSessions) {
          localSessionsRef.current.set(s.sessionKey, s)
        }
      }
    } catch {
      /* ignore */
    }
    loadSessions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Auto-restore last selected session ────────────────────────────────────
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || sessions.length === 0 || selectedSession) return
    restoredRef.current = true
    const saved = lsLoadSelectedSession()
    if (!saved) return
    const found = sessions.find(
      (s) => s.sessionKey === saved.sessionKey && s.gateway === saved.gateway
    )

    // For group sessions: ALWAYS preserve gatewayIds from saved session
    // The sessions list (from server/cache) often lacks gatewayIds
    const isGroup = saved.sessionKey.startsWith('claos-multiagent-')
    if (isGroup && saved.gatewayIds?.length) {
      // Merge: use found session but preserve gatewayIds from saved
      const sessionToRestore = found ? { ...found, gatewayIds: saved.gatewayIds } : saved
      selectSession(sessionToRestore)
    } else if (found) {
      selectSession(found)
    } else if (saved.sessionKey) {
      selectSession(saved)
    }
  }, [sessions, selectedSession, selectSession, lsLoadSelectedSession])

  return { loadSessions, loadHistory, selectSession, localSessionsRef }
}
