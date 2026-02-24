'use client'

import { useEffect, useRef } from 'react'
import { useAgentUIControl } from '@/context/agent-ui-control-context'
import { useTabContext } from '@/context/tab-context'
import { useTerminals } from '@/context/terminal-context'
import { useChat } from '@/context/chat-context'
import { fetchWithCsrf } from '@/lib/csrf-client'
import type { Session, Message } from '@/lib/types'
import type { TabView } from '@/lib/tab-types'
import {
  parseUIActions,
  executeActions as executeUIActions,
  type ExecuteActionsContext,
  type UIAction,
} from '@/lib/ui-relay-actions'

interface UseUIRelayOptions {
  enabled: boolean
  selectedSession: Session | null
  messages: Message[]
  sending: boolean
}

/**
 * UI Relay Hook
 *
 * LOGIC:
 * - Only process messages while `sending` is true (= agent is responding)
 * - Track message count at start of send to know which are "new"
 * - Scan ALL new messages for UI markers
 */
export function useUIRelay({ enabled, selectedSession, messages, sending }: UseUIRelayOptions) {
  const { setPendingNavPath } = useAgentUIControl()
  const { navigateActiveTab } = useTabContext()
  const { windows, createTerminal } = useTerminals()
  const { sessions, selectSession: ctxSelectSession } = useChat()

  const windowsRef = useRef(windows)
  const sessionsRef = useRef(sessions)

  // Track message count when sending started
  const msgCountAtSendStartRef = useRef<number>(0)
  const wasSendingRef = useRef<boolean>(false)
  // Track processed content hashes to avoid double-execution
  const processedRef = useRef<Set<string>>(new Set())
  const lastSessionKeyRef = useRef<string | null>(null)

  useEffect(() => {
    windowsRef.current = windows
  }, [windows])
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    if (!enabled || !selectedSession) return

    // Reset on session change
    if (lastSessionKeyRef.current !== selectedSession.sessionKey) {
      lastSessionKeyRef.current = selectedSession.sessionKey
      processedRef.current.clear()
      msgCountAtSendStartRef.current = messages.length
      wasSendingRef.current = sending
      return
    }

    // Detect start of sending
    if (sending && !wasSendingRef.current) {
      msgCountAtSendStartRef.current = messages.length
      console.log('[UIRelay] Send started, baseline message count:', messages.length)
    }
    wasSendingRef.current = sending

    // Only scan while sending (= agent is actively responding)
    if (!sending) return

    // Scan messages that arrived AFTER send started
    const allActions: UIAction[] = []

    for (let i = msgCountAtSendStartRef.current; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.role !== 'assistant') continue

      const content = typeof msg.content === 'string' ? msg.content : ''
      if (!content.trim()) continue

      const hash = `${content.length}:${content.slice(-100)}`
      if (processedRef.current.has(hash)) continue

      const actions = parseUIActions(content)
      if (actions.length > 0) {
        console.log('[UIRelay] Found', actions.length, 'actions in message', i)
        allActions.push(...actions)
      }

      processedRef.current.add(hash)
    }

    if (allActions.length === 0) return

    console.log('[UIRelay] Executing', allActions.length, 'total actions')

    const abort = new AbortController()

    const context: ExecuteActionsContext = {
      abort,
      navigateToTab: (tab: string) => {
        const validViews: TabView[] = ['chat', 'terminal', 'files', 'status', 'settings']
        if (validViews.includes(tab as TabView)) {
          navigateActiveTab(tab as TabView)
        }
      },
      ensureTerminal: async (): Promise<string | null> => {
        navigateActiveTab('terminal')
        if (windowsRef.current.length === 0) {
          await createTerminal()
          await new Promise((r) => setTimeout(r, 500))
        }
        return windowsRef.current[0]?.sessionId ?? null
      },
      typeCommand: async (cmd: string, sessionId: string): Promise<void> => {
        const chars = (cmd + '\r').split('')
        for (const char of chars) {
          if (abort.signal.aborted) return
          await fetchWithCsrf(`/api/terminal/${sessionId}/write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: char }),
          })
          await new Promise((r) => setTimeout(r, 20))
        }
      },
      selectSessionByKey: (key: string) => {
        const target = sessionsRef.current.find((s) => s.sessionKey === key)
        if (target) ctxSelectSession(target)
      },
      initialTerminalSessionId: windowsRef.current[0]?.sessionId ?? null,
      setPendingNavPath,
    }

    executeUIActions(allActions, context).catch(console.error)

    return () => abort.abort()
  }, [
    messages,
    sending,
    selectedSession,
    enabled,
    navigateActiveTab,
    createTerminal,
    ctxSelectSession,
    setPendingNavPath,
  ])
}
