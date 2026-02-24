'use client'

/**
 * ChatContext — persists chat state across page navigation
 * Uses IndexedDB for all persistent storage (migrated from localStorage)
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  ReactNode,
} from 'react'
import type { Session, Gateway, Message } from '@/lib/types'
import * as idb from '@/lib/storage/indexed-db'

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatContextValue {
  // ── State ─────────────────────────────────────────────────────────────────
  sessions: Session[]
  gateways: Gateway[]
  selectedSession: Session | null
  messages: Message[]
  loadingHistory: boolean
  loadingSessions: boolean
  storageReady: boolean // IndexedDB initialized

  // ── Named actions ─────────────────────────────────────────────────────────
  appendSession: (session: Session) => void
  removeSession: (sessionKey: string, gateway: string) => void
  resetSessions: (sessions: Session[]) => void
  setGatewayList: (gateways: Gateway[]) => void
  selectSession: (session: Session | null) => void
  setRawMessages: (msgs: Message[]) => void
  setHistoryLoading: (v: boolean) => void
  setSessionsLoading: (v: boolean) => void

  // ── Raw setters (internal) ────────────────────────────────────────────────
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setGateways: React.Dispatch<React.SetStateAction<Gateway[]>>
  setSelectedSession: React.Dispatch<React.SetStateAction<Session | null>>
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setLoadingHistory: React.Dispatch<React.SetStateAction<boolean>>
  setLoadingSessions: React.Dispatch<React.SetStateAction<boolean>>

  // In-memory cache
  messagesCache: React.MutableRefObject<Map<string, Message[]>>

  // Storage helpers (now async, backed by IndexedDB)
  lsSaveSessions: (sessions: Session[]) => void
  lsSaveMessages: (sessionKey: string, msgs: Message[]) => void
  lsLoadMessages: (sessionKey: string) => Message[]
  lsRemoveMessages: (sessionKey: string) => void
  lsSaveSelectedSession: (session: Session | null) => void
  lsLoadSelectedSession: () => Session | null
  lsSaveGroup: (session: Session) => void
  lsRemoveGroup: (sessionKey: string) => void
  lsLoadGroups: () => Session[]
}

const ChatContext = createContext<ChatContextValue | null>(null)

// ── Legacy keys (for migration) ──────────────────────────────────────────────
export const LS_SESSIONS = 'claos:sessions'
export const LS_LAST_SESSION = 'claos:lastSession'
export const LS_MESSAGES_PREFIX = 'claos:msgs:'
export const LS_GROUPS = 'claos:groups'

// ── Provider ─────────────────────────────────────────────────────────────────

export function ChatProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [storageReady, setStorageReady] = useState(false)

  const messagesCache = useRef<Map<string, Message[]>>(new Map())

  // Sync cache for instant reads (populated from IndexedDB)
  const sessionsCache = useRef<Session[]>([])
  const groupsCache = useRef<Session[]>([])
  const lastSessionCache = useRef<Session | null>(null)
  const messagesCacheIDB = useRef<Map<string, Message[]>>(new Map())

  // ── Initialize IndexedDB and migrate from localStorage ────────────────────
  useEffect(() => {
    let mounted = true

    async function init() {
      try {
        await idb.initStorage()

        if (!mounted) return

        // Load initial data from IndexedDB into cache
        const storedSessions = await idb.getAllSessions()
        const hidden = await idb.getHiddenSessions()
        const validSessions = storedSessions
          .filter((s) => !hidden.includes(s.id))
          .map((s) => ({
            sessionKey: s.sessionKey,
            gateway: s.gateway,
            gatewayName: s.gatewayName,
            gatewayIds: s.gatewayIds,
            kind: s.kind,
            customName: s.customName,
            label: s.label,
            lastActive: s.lastActive,
          }))

        sessionsCache.current = validSessions
        if (mounted) setSessions(validSessions)

        // Load groups
        const storedGroups = await idb.getAllGroups()
        groupsCache.current = storedGroups
          .filter((g) => g.gatewayIds && g.gatewayIds.length >= 2)
          .map((g) => ({
            sessionKey: g.sessionKey,
            gateway: g.gatewayIds[0],
            gatewayName: g.customName ?? g.gatewayIds.join(' + '),
            gatewayIds: g.gatewayIds,
            kind: 'group' as const,
            customName: g.customName,
          }))

        // Load last session
        const lastSession = await idb.getLastSession()
        if (lastSession) {
          lastSessionCache.current = {
            sessionKey: lastSession.sessionKey,
            gateway: lastSession.gateway,
            gatewayName: lastSession.gatewayName,
            gatewayIds: lastSession.gatewayIds,
            kind: lastSession.kind,
            customName: lastSession.customName,
          }
        }

        if (mounted) setStorageReady(true)
        console.log('[ChatContext] IndexedDB initialized, sessions loaded:', validSessions.length)
      } catch (err) {
        console.error('[ChatContext] IndexedDB init failed:', err)
        if (mounted) setStorageReady(true) // Continue anyway
      }
    }

    init()
    return () => {
      mounted = false
    }
  }, [])

  // ── Storage helpers (sync interface, async background writes) ─────────────

  const lsSaveSessions = useCallback((sessions: Session[]) => {
    sessionsCache.current = sessions
    // Async write to IndexedDB
    Promise.all(
      sessions.map((s) => {
        const isGroup = s.sessionKey.startsWith('claos-multiagent-') || s.kind === 'group'
        return idb.saveSession({
          id: `${s.gateway}:${s.sessionKey}`,
          gateway: s.gateway,
          sessionKey: s.sessionKey,
          gatewayName: s.gatewayName,
          gatewayIds: s.gatewayIds,
          kind: s.kind,
          customName: s.customName,
          label: s.label,
          lastActive: s.lastActive,
          isGroup,
          createdAt: Date.now(),
        })
      })
    ).catch((err) => console.error('[ChatContext] Failed to save sessions:', err))
  }, [])

  const lsSaveMessages = useCallback((sessionKey: string, msgs: Message[]) => {
    messagesCache.current.set(sessionKey, msgs)
    messagesCacheIDB.current.set(sessionKey, msgs)
    // Async write to IndexedDB
    idb
      .saveMessages(sessionKey, msgs)
      .catch((err) => console.error('[ChatContext] Failed to save messages:', err))
  }, [])

  const lsLoadMessages = useCallback((sessionKey: string): Message[] => {
    // Return from sync cache first
    const cached = messagesCacheIDB.current.get(sessionKey)
    if (cached) return cached

    // Trigger async load for next time
    idb
      .getMessages(sessionKey)
      .then((msgs) => {
        messagesCacheIDB.current.set(sessionKey, msgs)
      })
      .catch(() => {})

    return []
  }, [])

  const lsRemoveMessages = useCallback((sessionKey: string) => {
    messagesCache.current.delete(sessionKey)
    messagesCacheIDB.current.delete(sessionKey)
    idb
      .deleteMessages(sessionKey)
      .catch((err) => console.error('[ChatContext] Failed to delete messages:', err))
  }, [])

  const lsSaveSelectedSession = useCallback((session: Session | null) => {
    lastSessionCache.current = session
    if (session) {
      const isGroup =
        session.sessionKey.startsWith('claos-multiagent-') || session.kind === 'group'
      idb
        .setLastSession({
          id: `${session.gateway}:${session.sessionKey}`,
          gateway: session.gateway,
          sessionKey: session.sessionKey,
          gatewayName: session.gatewayName,
          gatewayIds: session.gatewayIds,
          kind: session.kind,
          customName: session.customName,
          isGroup,
          createdAt: Date.now(),
        })
        .catch((err) => console.error('[ChatContext] Failed to save selected session:', err))
    } else {
      idb
        .setLastSession(null)
        .catch((err) => console.error('[ChatContext] Failed to clear selected session:', err))
    }
  }, [])

  const lsLoadSelectedSession = useCallback((): Session | null => {
    return lastSessionCache.current
  }, [])

  const lsSaveGroup = useCallback((session: Session) => {
    if (!session.gatewayIds || session.gatewayIds.length < 2) return

    // Update cache
    const idx = groupsCache.current.findIndex((g) => g.sessionKey === session.sessionKey)
    if (idx >= 0) {
      groupsCache.current[idx] = session
    } else {
      groupsCache.current.push(session)
    }

    // Async write to IndexedDB
    idb
      .saveGroup({
        sessionKey: session.sessionKey,
        gatewayIds: session.gatewayIds,
        customName: session.customName ?? undefined,
        createdAt: Date.now(),
      })
      .catch((err) => console.error('[ChatContext] Failed to save group:', err))
  }, [])

  const lsRemoveGroup = useCallback((sessionKey: string) => {
    groupsCache.current = groupsCache.current.filter((g) => g.sessionKey !== sessionKey)
    idb
      .deleteGroup(sessionKey)
      .catch((err) => console.error('[ChatContext] Failed to delete group:', err))
  }, [])

  const lsLoadGroups = useCallback((): Session[] => {
    return groupsCache.current.filter(
      (g) =>
        g.sessionKey.startsWith('claos-multiagent-') &&
        Array.isArray(g.gatewayIds) &&
        g.gatewayIds.length >= 2
    )
  }, [])

  // ── Named actions ──────────────────────────────────────────────────────────

  const appendSession = useCallback((session: Session) => {
    setSessions((prev) => {
      const exists = prev.some(
        (s) => s.sessionKey === session.sessionKey && s.gateway === session.gateway
      )
      return exists ? prev : [...prev, session]
    })
  }, [])

  const removeSession = useCallback((sessionKey: string, gateway: string) => {
    setSessions((prev) =>
      prev.filter((s) => !(s.sessionKey === sessionKey && s.gateway === gateway))
    )
    // Add to hidden list in IndexedDB
    idb.addHiddenSession(`${gateway}:${sessionKey}`).catch(() => {})
  }, [])

  const resetSessions = useCallback((sessions: Session[]) => {
    setSessions(sessions)
  }, [])

  const setGatewayList = useCallback((gateways: Gateway[]) => {
    setGateways(gateways)
  }, [])

  const selectSession = useCallback((session: Session | null) => {
    setSelectedSession(session)
  }, [])

  const setRawMessages = useCallback((msgs: Message[]) => {
    setMessages(msgs)
  }, [])

  const setHistoryLoading = useCallback((v: boolean) => {
    setLoadingHistory(v)
  }, [])

  const setSessionsLoading = useCallback((v: boolean) => {
    setLoadingSessions(v)
  }, [])

  return (
    <ChatContext.Provider
      value={{
        sessions,
        setSessions,
        gateways,
        setGateways,
        selectedSession,
        setSelectedSession,
        messages,
        setMessages,
        loadingHistory,
        setLoadingHistory,
        loadingSessions,
        setLoadingSessions,
        storageReady,
        messagesCache,
        lsSaveSessions,
        lsSaveMessages,
        lsLoadMessages,
        lsRemoveMessages,
        lsSaveSelectedSession,
        lsLoadSelectedSession,
        lsSaveGroup,
        lsRemoveGroup,
        lsLoadGroups,
        // Named actions
        appendSession,
        removeSession,
        resetSessions,
        setGatewayList,
        selectSession,
        setRawMessages,
        setHistoryLoading,
        setSessionsLoading,
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}

export function useChat() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within ChatProvider')
  return ctx
}
