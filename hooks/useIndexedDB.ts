'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  initStorage,
  saveSession,
  getAllSessions,
  deleteSession as dbDeleteSession,
  saveMessages,
  getMessages,
  deleteMessages,
  saveGroup,
  getAllGroups,
  deleteGroup,
  getLastSession,
  setLastSession,
  getHiddenSessions,
  addHiddenSession,
  type StoredSession,
  type StoredMessage,
  type StoredGroup,
} from '@/lib/storage/indexed-db'
import type { Session, Message } from '@/lib/types'

/**
 * Hook for IndexedDB storage operations
 * Replaces all localStorage usage in chat context
 */
export function useIndexedDB() {
  const [ready, setReady] = useState(false)
  const initRef = useRef(false)

  // Initialize storage on mount
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    initStorage()
      .then(() => setReady(true))
      .catch((err) => {
        console.error('[useIndexedDB] Failed to initialize:', err)
        setReady(true) // Continue anyway, operations will fail gracefully
      })
  }, [])

  // ── Session operations ────────────────────────────────────────────────────

  const idbSaveSessions = useCallback(async (sessions: Session[]): Promise<void> => {
    try {
      for (const s of sessions) {
        const isGroup = s.sessionKey.startsWith('claos-multiagent-') || s.kind === 'group'
        await saveSession({
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
      }
    } catch (err) {
      console.error('[useIndexedDB] Failed to save sessions:', err)
    }
  }, [])

  const idbLoadSessions = useCallback(async (): Promise<Session[]> => {
    try {
      const stored = await getAllSessions()
      const hidden = await getHiddenSessions()

      return stored
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
    } catch (err) {
      console.error('[useIndexedDB] Failed to load sessions:', err)
      return []
    }
  }, [])

  const idbDeleteSession = useCallback(
    async (gateway: string, sessionKey: string): Promise<void> => {
      try {
        await dbDeleteSession(gateway, sessionKey)
        await addHiddenSession(`${gateway}:${sessionKey}`)
      } catch (err) {
        console.error('[useIndexedDB] Failed to delete session:', err)
      }
    },
    []
  )

  // ── Message operations ────────────────────────────────────────────────────

  const idbSaveMessages = useCallback(
    async (sessionKey: string, messages: Message[]): Promise<void> => {
      try {
        await saveMessages(sessionKey, messages as StoredMessage[])
      } catch (err) {
        console.error('[useIndexedDB] Failed to save messages:', err)
      }
    },
    []
  )

  const idbLoadMessages = useCallback(async (sessionKey: string): Promise<Message[]> => {
    try {
      const stored = await getMessages(sessionKey)
      return stored.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        attachments: m.attachments,
        error: m.error,
        errorCode: m.errorCode,
        retryable: m.retryable,
      }))
    } catch (err) {
      console.error('[useIndexedDB] Failed to load messages:', err)
      return []
    }
  }, [])

  const idbDeleteMessages = useCallback(async (sessionKey: string): Promise<void> => {
    try {
      await deleteMessages(sessionKey)
    } catch (err) {
      console.error('[useIndexedDB] Failed to delete messages:', err)
    }
  }, [])

  // ── Group operations ──────────────────────────────────────────────────────

  const idbSaveGroup = useCallback(async (session: Session): Promise<void> => {
    try {
      if (!session.gatewayIds || session.gatewayIds.length < 2) return
      await saveGroup({
        sessionKey: session.sessionKey,
        gatewayIds: session.gatewayIds,
        customName: session.customName ?? undefined,
        createdAt: Date.now(),
      })
    } catch (err) {
      console.error('[useIndexedDB] Failed to save group:', err)
    }
  }, [])

  const idbLoadGroups = useCallback(async (): Promise<Session[]> => {
    try {
      const stored = await getAllGroups()
      return stored
        .filter((g) => g.gatewayIds && g.gatewayIds.length >= 2)
        .map((g) => ({
          sessionKey: g.sessionKey,
          gateway: g.gatewayIds[0],
          gatewayName: g.customName ?? g.gatewayIds.join(' + '),
          gatewayIds: g.gatewayIds,
          kind: 'group' as const,
          customName: g.customName,
        }))
    } catch (err) {
      console.error('[useIndexedDB] Failed to load groups:', err)
      return []
    }
  }, [])

  const idbDeleteGroup = useCallback(async (sessionKey: string): Promise<void> => {
    try {
      await deleteGroup(sessionKey)
    } catch (err) {
      console.error('[useIndexedDB] Failed to delete group:', err)
    }
  }, [])

  // ── Selected session ──────────────────────────────────────────────────────

  const idbSaveSelectedSession = useCallback(async (session: Session | null): Promise<void> => {
    try {
      if (!session) {
        await setLastSession(null)
        return
      }
      const isGroup =
        session.sessionKey.startsWith('claos-multiagent-') || session.kind === 'group'
      await setLastSession({
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
    } catch (err) {
      console.error('[useIndexedDB] Failed to save selected session:', err)
    }
  }, [])

  const idbLoadSelectedSession = useCallback(async (): Promise<Session | null> => {
    try {
      const stored = await getLastSession()
      if (!stored) return null
      return {
        sessionKey: stored.sessionKey,
        gateway: stored.gateway,
        gatewayName: stored.gatewayName,
        gatewayIds: stored.gatewayIds,
        kind: stored.kind,
        customName: stored.customName,
      }
    } catch (err) {
      console.error('[useIndexedDB] Failed to load selected session:', err)
      return null
    }
  }, [])

  return {
    ready,
    // Sessions
    idbSaveSessions,
    idbLoadSessions,
    idbDeleteSession,
    // Messages
    idbSaveMessages,
    idbLoadMessages,
    idbDeleteMessages,
    // Groups
    idbSaveGroup,
    idbLoadGroups,
    idbDeleteGroup,
    // Selected session
    idbSaveSelectedSession,
    idbLoadSelectedSession,
  }
}
