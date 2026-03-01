'use client'

import { useState, useCallback, useRef } from 'react'
import { useChat } from '@/context/chat-context'
import { useTabContext } from '@/context/tab-context'
import { useAgentUIControl } from '@/context/agent-ui-control-context'
import { useTerminals } from '@/context/terminal-context'
import { getCsrfToken } from '@/lib/csrf-client'
import type { Message, PendingAttachment, Session } from '@/lib/types'
import { isGroupSession, sessionDisplayName } from '@/lib/session-utils'
import { notificationRef } from '@/context/notification-context'
import { useChatWs } from './useChatWs'

// Simplified UI Control context for chat messages (not as strict as the ⚡ button prompt)
function buildChatUIContext(
  activeTab: string,
  filesPath: string | null,
  terminalCount: number
): string {
  return `[CRITICAL: UI_CONTROL_ACTIVE]
⚠️ YOU MUST INCLUDE HTML COMMENT MARKERS TO CONTROL THE UI. Without them, nothing happens!

Current: tab=${activeTab}, files=${filesPath ?? 'none'}, terminals=${terminalCount}

REQUIRED MARKERS (copy EXACTLY as shown, including <!-- and -->):
<!--ui:navigate:files--> = switch to Files tab
<!--ui:navigate:terminal--> = switch to Terminal tab
<!--ui:navigate:chat--> = switch to Chat tab
<!--ui:navigate:settings--> = switch to Settings tab
<!--ui:open-terminal--> = create new terminal
<!--ui:cmd:COMMAND--> = type command in terminal
<!--ui:navigate-path:/path--> = browse to directory
<!--ui:notify:message--> = show notification

CORRECT RESPONSES:
User: "go to files" → You MUST respond: <!--ui:navigate:files-->Switching to files!
User: "open terminal" → You MUST respond: <!--ui:navigate:terminal--><!--ui:open-terminal-->Opening terminal!
User: "run ls" → You MUST respond: <!--ui:cmd:ls-->Running ls...

❌ WRONG: "Done!" (no marker = nothing happens)
✅ RIGHT: "<!--ui:navigate:files-->Done!" (marker triggers the action)

The markers are invisible to the user but REQUIRED for the UI to respond.
For normal questions without UI actions, respond normally without markers.
`
}

/**
 * useMessageSender
 *
 * Handles:
 *  - Input text state
 *  - Pending file attachments state
 *  - Per-session sending state
 *  - Image compression
 *  - File selection (image / audio / text)
 *  - Message sending with SSE streaming
 *  - Multi-gateway group brainstorm rounds
 *
 * Returns all state + callbacks needed by the chat input and message list.
 */
export function useMessageSender() {
  const { selectedSession, gateways, setMessages, messagesCache, lsSaveMessages } = useChat()

  const selectedSessionRef = useRef(selectedSession)
  selectedSessionRef.current = selectedSession

  // ── WS chat for 1-1 sessions (persistent connection, no SSE fragility) ────
  // DISABLED: WS bridge endpoint not implemented yet - use SSE for all sessions
  // TODO: Implement /api/gateway/ws server-side route to re-enable
  // const singleGatewayId =
  //   selectedSession && !isGroupSession(selectedSession) ? selectedSession.gateway : null
  const chatWs = useChatWs(null) // Disabled - always use SSE fallback

  // ── Tab context (Phase 3: unread badges + browser notifications) ──────────
  const { tabs, markTabUnread, activeTab } = useTabContext()

  // ── UI Control context (for injecting UI markers capability) ───────────────
  const { enabled: uiControlEnabled, filesCurrentPath } = useAgentUIControl()
  const { windows: terminalWindows } = useTerminals()
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const markTabUnreadRef = useRef(markTabUnread)
  markTabUnreadRef.current = markTabUnread

  // ── Local state ───────────────────────────────────────────────────────────
  const [input, setInput] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [sendingKeys, setSendingKeys] = useState<Set<string>>(new Set())
  const [queueLength, setQueueLength] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Message queue (per-session, keyed by sessionKey) ─────────────────────
  // Each item carries the exact session it was queued for — prevents cross-session
  // message delivery when the user switches sessions while a message is in-flight.
  const messageQueues = useRef<
    Map<string, Array<{ text: string; attachments: PendingAttachment[]; session: Session }>>
  >(new Map())
  const processingQueues = useRef<Map<string, boolean>>(new Map())

  const sending = sendingKeys.has(selectedSession?.sessionKey ?? '')

  const setSending = useCallback((key: string, active: boolean) => {
    setSendingKeys((prev) => {
      const next = new Set(prev)
      if (active) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  // ── Image compression (stay within gateway 512KB WS frame limit) ──────────
  const compressImage = useCallback((dataUrl: string, maxBytes = 380_000): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height
        const MAX_DIM = 1920
        if (width > MAX_DIM || height > MAX_DIM) {
          const ratio = Math.min(MAX_DIM / width, MAX_DIM / height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, width, height)
        const qualities = [0.85, 0.7, 0.55, 0.4]
        for (const q of qualities) {
          const compressed = canvas.toDataURL('image/jpeg', q)
          const bytes = (compressed.length * 3) / 4
          if (bytes <= maxBytes || q === qualities[qualities.length - 1]) {
            resolve(compressed)
            return
          }
        }
        resolve(dataUrl)
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    })
  }, [])

  // ── Handle file attachment selection ─────────────────────────────────────
  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files) return
      for (const file of Array.from(files)) {
        const id = Math.random().toString(36).slice(2) + Date.now()
        const isImage = file.type.startsWith('image/')
        const isAudio = file.type.startsWith('audio/')
        const type: PendingAttachment['type'] = isImage ? 'image' : isAudio ? 'audio' : 'text'

        const pending: PendingAttachment = {
          id,
          file,
          type,
          mimeType: file.type || 'application/octet-stream',
          name: file.name,
          status: 'loading',
        }
        setPendingAttachments((prev) => [...prev, pending])

        const reader = new FileReader()

        if (isImage) {
          reader.readAsDataURL(file)
          reader.onload = async () => {
            const originalDataUrl = reader.result as string
            const dataUrl = await compressImage(originalDataUrl)
            setPendingAttachments((prev) =>
              prev.map((a) =>
                a.id === id
                  ? {
                      ...a,
                      preview: dataUrl,
                      content: dataUrl,
                      mimeType: 'image/jpeg',
                      status: 'ready',
                    }
                  : a
              )
            )
          }
          reader.onerror = () => {
            setPendingAttachments((prev) =>
              prev.map((a) => (a.id === id ? { ...a, status: 'error' } : a))
            )
          }
        } else if (isAudio) {
          setPendingAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, status: 'ready' } : a))
          )
        } else {
          reader.readAsText(file)
          reader.onload = () => {
            const text = reader.result as string
            setPendingAttachments((prev) =>
              prev.map((a) => (a.id === id ? { ...a, content: text, status: 'ready' } : a))
            )
          }
          reader.onerror = () => {
            setPendingAttachments((prev) =>
              prev.map((a) => (a.id === id ? { ...a, status: 'error' } : a))
            )
          }
        }
      }
    },
    [compressImage]
  )

  // ── Core message sender ────────────────────────────────────────────────────
  // Accepts an explicit targetSession so queued messages always go to the right
  // session, regardless of which session the user has selected at drain time.
  // User message is already displayed by sendMessage() before this is called
  const sendMessageCore = useCallback(
    async (
      text: string,
      capturedAttachments: PendingAttachment[],
      targetSession?: Session,
      _skipUserMsg = false
    ) => {
      const session = targetSession ?? selectedSession
      if (!session) return

      setSending(session.sessionKey, true)

      const textAdditions = capturedAttachments
        .filter((a) => a.type !== 'image' && a.status === 'ready')
        .map((a) => {
          if (a.type === 'audio') return `\n\n[🎵 Audio file: ${a.name}]`
          return `\n\n[📄 File: ${a.name}]\n\`\`\`\n${a.content ?? ''}\n\`\`\``
        })
        .join('')
      const message =
        text.trim() + textAdditions || capturedAttachments.map((a) => `[📎 ${a.name}]`).join(' ')

      const imageAttachments = capturedAttachments
        .filter((a) => a.type === 'image' && a.status === 'ready' && a.content)
        .map((a) => ({ content: a.content!, mimeType: a.mimeType, fileName: a.name }))

      // Generate unique requestId for this conversation turn
      // This prevents message mixing between sessions
      const requestId = `req-${session.sessionKey}-${Date.now()}-${Math.random().toString(36).slice(2)}`

      // Update cache + visible messages (only if still on this session)
      const addMessages = (updater: (prev: Message[]) => Message[]) => {
        const currentCached = messagesCache.current.get(session.sessionKey) ?? []
        const next = updater(currentCached)
        messagesCache.current.set(session.sessionKey, next)
        lsSaveMessages(session.sessionKey, next)
        if (selectedSessionRef.current?.sessionKey === session.sessionKey) {
          setMessages(next)
        }
      }

      // User message is already displayed by sendMessage() - don't duplicate
      // (skipUserMsg is true when called from sendMessage)

      // ── Stream one gateway response into a new placeholder message ─────────
      const streamOneGateway = async (
        gwId: string,
        label: string | null,
        csrfToken: string,
        priorContext: string = '',
        isFollowUp = false,
        imgAttachments?: { content: string; mimeType?: string; fileName?: string }[]
      ): Promise<string> => {
        // CRITICAL: Validate gwId before making any request
        if (!gwId || typeof gwId !== 'string' || gwId.trim() === '') {
          console.error('[streamOneGateway] Invalid gatewayId:', {
            gwId,
            label,
            sessionKey: session.sessionKey,
          })
          return '' // Return empty instead of making a bad request
        }

        // Generate idempotency key once — reused across retries so gateway deduplicates
        const idempotencyKey = `web-${Date.now()}-${Math.random().toString(36).slice(2)}`

        addMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: label ? `**${label}**: ` : '',
            timestamp: new Date().toISOString(),
            requestId, // Same requestId as the user message to track the pair
          },
        ])

        const isGroupMsg = isGroupSession(session)
        const groupContext = isGroupMsg
          ? (() => {
              const others = (session.gatewayIds ?? [])
                .filter((id) => id !== gwId)
                .map((id) => {
                  const gw = gateways.find((g) => g.id === id)
                  return gw ? `${gw.name} (gateway: ${id})` : id
                })
              const myName = gateways.find((g) => g.id === gwId)?.name ?? gwId
              return `[📋 GROUP CHAT: You are ${myName} in a shared conversation with ${others.join(', ')}. ⚠️ DO NOT use sessions_send or any external tool to communicate with the other agents — ALL communication must happen through your response here. You will see their responses and they will see yours in this conversation.]\n\n`
            })()
          : ''

        // Inject UI Control context when enabled (allows agent to control dashboard)
        const uiContext = uiControlEnabled
          ? buildChatUIContext(
              activeTab?.view ?? 'chat',
              filesCurrentPath,
              terminalWindows.length
            ) + '\n\n'
          : ''

        const messageWithContext = isFollowUp
          ? `${uiContext}${groupContext}---\n*Conversation so far:*\n${priorContext}\n\n---\n📢 **Discussion round**: You've all responded. Now react to each other if you have something to add — agree, disagree, build on ideas, or joke around. Keep it brief (1-2 sentences). If you have nothing to add, just say "👍" or stay silent.`
          : priorContext
            ? `${uiContext}${groupContext}${message}\n\n---\n*Other agents already responded:*\n${priorContext}\n\nNow it's your turn.`
            : `${uiContext}${groupContext}${message}`

        let accumulatedText = ''
        const prefix = label ? `**${label}**: ` : ''
        const MAX_RETRIES = 3
        let attempt = 0

        // ── SSE fetch with auto-retry on network drops ─────────────────────
        // We reuse the same idempotencyKey across retries: the gateway deduplicates
        // requests with the same key, so the agent receives the message only once.
        const attemptStream = async (): Promise<boolean> => {
          // Silent retry with exponential backoff (no UI indication to avoid flicker)
          if (attempt > 0) {
            // Exponential backoff: 1s, 2s, 4s
            await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 8000)))
          }

          try {
            const res = await fetch('/api/chat/stream', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
              credentials: 'include',
              body: JSON.stringify({
                gatewayId: gwId,
                sessionKey: session.sessionKey,
                message: messageWithContext,
                idempotencyKey,
                ...(imgAttachments?.length ? { attachments: imgAttachments } : {}),
              }),
              signal: AbortSignal.timeout(130000),
            })

            if (!res.ok || !res.body) {
              const errText = await res.text().catch(() => `HTTP ${res.status}`)

              // Retry on 400/502/503/504 errors (transient issues) - silent retry
              const isRetriableStatus = [400, 502, 503, 504].includes(res.status)
              if (isRetriableStatus && attempt < MAX_RETRIES) {
                return false // signal: retry
              }

              addMessages((prev) => {
                const next = [...prev]
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  content: `${prefix}⚠️ Error: ${errText}`,
                }
                return next
              })
              return true // non-retriable HTTP error
            }

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split('\n')
              buffer = lines.pop() ?? ''

              for (const line of lines) {
                if (!line.startsWith('data: ')) continue
                try {
                  const event = JSON.parse(line.slice(6)) as {
                    type: string
                    text?: string
                    error?: string
                    code?: string
                    retryable?: boolean
                  }
                  if (event.type === 'delta' && event.text) {
                    accumulatedText += event.text
                    if (selectedSessionRef.current?.sessionKey === session.sessionKey) {
                      addMessages((prev) => {
                        const next = [...prev]
                        next[next.length - 1] = {
                          ...next[next.length - 1],
                          content: prefix + accumulatedText,
                        }
                        return next
                      })
                    }
                  } else if (event.type === 'done') {
                    accumulatedText = event.text || accumulatedText
                    addMessages((prev) => {
                      const next = [...prev]
                      next[next.length - 1] = {
                        ...next[next.length - 1],
                        content: prefix + (accumulatedText || '✓'),
                      }
                      return next
                    })
                    // ── Notifications: tab badge + document.title + OS notif ──
                    const matchingTab =
                      tabsRef.current.find((t) => t.sessionKey === session.sessionKey) ??
                      tabsRef.current.find((t) => t.view === 'chat' && t.isActive)

                    const notifTitle = label || sessionDisplayName(session)
                    const notifBody = accumulatedText.slice(0, 200)

                    if (matchingTab) {
                      if (!matchingTab.isActive) markTabUnreadRef.current(matchingTab.id, 1)
                      notificationRef.current(notifTitle, notifBody, matchingTab.id)
                    }

                    if (typeof document !== 'undefined' && !document.hasFocus()) {
                      const prev = document.title.replace(/^\(\d+\)\s*/, '')
                      const match = document.title.match(/^\((\d+)\)/)
                      const count = match ? parseInt(match[1]) + 1 : 1
                      document.title = `(${count}) ${prev}`
                    }
                    return true // success
                  } else if (event.type === 'error') {
                    const errorMsg = event.error ?? 'Unknown error'
                    addMessages((prev) => {
                      const next = [...prev]
                      next[next.length - 1] = {
                        ...next[next.length - 1],
                        content: `${prefix}⚠️ ${errorMsg}`,
                        error: true,
                        errorCode: event.code,
                        retryable: event.retryable,
                      }
                      return next
                    })
                    return true // gateway-level error, don't retry
                  }
                } catch {
                  /* ignore parse errors */
                }
              }
            }

            // Stream ended without 'done' event (partial response)
            if (accumulatedText) {
              addMessages((prev) => {
                const next = [...prev]
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  content: prefix + accumulatedText,
                }
                return next
              })
              return true
            }

            if (!accumulatedText) {
              addMessages((prev) => {
                const next = [...prev]
                if (
                  next[next.length - 1]?.content === prefix ||
                  next[next.length - 1]?.content === ''
                ) {
                  next[next.length - 1] = {
                    ...next[next.length - 1],
                    content: prefix + '(no response)',
                  }
                }
                return next
              })
              return true
            }

            return true
          } catch (err) {
            // If we already got partial text, keep it and consider success
            if (accumulatedText) {
              addMessages((prev) => {
                const next = [...prev]
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  content: prefix + accumulatedText,
                }
                return next
              })
              return true
            }

            const raw = err instanceof Error ? err.message : 'Unknown error'
            const isNetworkError =
              /network error|failed to fetch|load failed|bodystreambuffer|aborted|abort/i.test(raw)
            const isTimeout = /timeout/i.test(raw)

            // Retry on network errors (not timeouts or other errors)
            if (isNetworkError && attempt < MAX_RETRIES) {
              return false // signal: retry
            }

            // Final failure — show human-readable error
            const humanMsg = isNetworkError
              ? 'Connection interrupted — server may be restarting, please retry'
              : isTimeout
                ? 'No response from agent (timeout) — please retry'
                : raw

            addMessages((prev) => {
              const next = [...prev]
              next[next.length - 1] = {
                ...next[next.length - 1],
                content: `${prefix}⚠️ ${humanMsg}`,
                error: true,
                retryable: true,
              }
              return next
            })
            return true // give up
          }
        }

        // Retry loop
        while (attempt <= MAX_RETRIES) {
          const done = await attemptStream()
          if (done) break
          attempt++
        }

        return accumulatedText
      }

      // ── Orchestrate single vs multi-gateway ───────────────────────────────
      const isGroup = isGroupSession(session)
      const rawGatewayIds: string[] =
        isGroup && session.gatewayIds?.length ? session.gatewayIds : [session.gateway]

      // Filter out any undefined/null/empty values
      // NOTE: We no longer filter by "gateway exists in gateways list" because gateways
      // may not be loaded yet. The backend will handle gateway.not_found errors gracefully.
      const gatewayIds = rawGatewayIds.filter((id): id is string => {
        if (!id || typeof id !== 'string' || id.trim() === '') {
          console.warn(`[GroupSession] Filtering out invalid gatewayId: "${id}"`)
          return false
        }
        return true
      })

      // Guard: warn if group session lost its gatewayIds
      if (isGroup && gatewayIds.length < 2) {
        console.warn(
          '[GroupSession] gatewayIds missing or single — group will not work as expected',
          session.sessionKey
        )
        addMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: '⚠️ Group session configuration lost. Please delete and recreate this group.',
            timestamp: new Date().toISOString(),
            error: true,
          },
        ])
        setSending(session.sessionKey, false)
        return
      }

      try {
        const csrfToken = await getCsrfToken()

        // Warmup gateways before first message to avoid 400 errors
        // This pre-connects the WS so the message can be sent immediately
        try {
          await fetch('/api/chat/warmup', { signal: AbortSignal.timeout(3000) })
        } catch {
          // Warmup failed, continue anyway - retry logic will handle it
        }

        if (isGroup && gatewayIds.length > 1) {
          // Helper: call agent with retry on failure (400, empty response, etc.)
          const AGENT_DELAY_MS = 500 // Delay between agents to avoid WS congestion
          const AGENT_RETRIES = 2

          const callAgentWithRetry = async (
            gwId: string,
            label: string,
            context: string,
            isFollowUp: boolean,
            attachments?: { content: string; mimeType?: string; fileName?: string }[]
          ): Promise<string> => {
            for (let retry = 0; retry <= AGENT_RETRIES; retry++) {
              if (retry > 0) {
                // Silent backoff: 1s, 2s
                const backoffMs = 1000 * retry
                await new Promise((r) => setTimeout(r, backoffMs))
              }

              const response = await streamOneGateway(
                gwId,
                label,
                csrfToken,
                context,
                isFollowUp,
                attachments
              )

              // Success if we got a non-empty response
              if (response && response.trim()) {
                return response
              }
              // Empty response or error — silent retry
            }
            return '' // All retries exhausted
          }

          // Round 1: each agent responds to user message (sequential with delay)
          let dialogueLog = ''
          for (let i = 0; i < gatewayIds.length; i++) {
            const gwId = gatewayIds[i]

            // Double-check gwId is valid before making request
            if (!gwId || typeof gwId !== 'string') {
              console.error('[GroupSession] Invalid gwId in loop:', gwId)
              continue
            }

            // Add delay between agents (not before first one)
            if (i > 0) {
              await new Promise((r) => setTimeout(r, AGENT_DELAY_MS))
            }

            const gw = gateways.find((g) => g.id === gwId)
            const label = gw?.name || gwId
            const response = await callAgentWithRetry(
              gwId,
              label,
              dialogueLog,
              false,
              imageAttachments.length ? imageAttachments : undefined
            )
            if (response) {
              dialogueLog += (dialogueLog ? '\n' : '') + `**${label}**: ${response}`
            }
          }

          // Brainstorm round: agents see all responses and can react to each other
          // Skip for slash commands (those are typically one-shot)
          const maxRounds = message.startsWith('/') ? 0 : 1
          for (let round = 0; round < maxRounds; round++) {
            for (let i = 0; i < gatewayIds.length; i++) {
              const gwId = gatewayIds[i]

              // Double-check gwId is valid before making request
              if (!gwId || typeof gwId !== 'string') continue

              // Add delay between agents
              if (i > 0) {
                await new Promise((r) => setTimeout(r, AGENT_DELAY_MS))
              }

              const gw = gateways.find((g) => g.id === gwId)
              const label = gw?.name || gwId
              const response = await callAgentWithRetry(gwId, label, dialogueLog, true)
              if (response) dialogueLog += `\n**${label}**: ${response}`
            }
          }
        } else {
          // Direct: single gateway — prefer WS (persistent, resilient), fall back to SSE
          const gwId = gatewayIds[0]
          const idempotencyKey = `web-${Date.now()}-${Math.random().toString(36).slice(2)}`

          if (chatWs.state === 'connected') {
            // ── WS path ──────────────────────────────────────────────────────
            addMessages((prev) => [
              ...prev,
              {
                role: 'assistant',
                content: '',
                timestamp: new Date().toISOString(),
                requestId,
              },
            ])

            try {
              const fullText = await chatWs.streamChat({
                sessionKey: session.sessionKey,
                message,
                idempotencyKey,
                attachments: imageAttachments.length ? imageAttachments : undefined,
                onDelta: (_delta, accumulated) => {
                  if (selectedSessionRef.current?.sessionKey === session.sessionKey) {
                    addMessages((prev) => {
                      const next = [...prev]
                      next[next.length - 1] = { ...next[next.length - 1], content: accumulated }
                      return next
                    })
                  }
                },
                onDone: (text) => {
                  addMessages((prev) => {
                    const next = [...prev]
                    next[next.length - 1] = { ...next[next.length - 1], content: text || '✓' }
                    return next
                  })
                  // Notifications
                  const matchingTab =
                    tabsRef.current.find((t) => t.sessionKey === session.sessionKey) ??
                    tabsRef.current.find((t) => t.view === 'chat' && t.isActive)
                  if (matchingTab) {
                    if (!matchingTab.isActive) markTabUnreadRef.current(matchingTab.id, 1)
                    notificationRef.current(
                      sessionDisplayName(session),
                      text.slice(0, 200),
                      matchingTab.id
                    )
                  }
                  if (typeof document !== 'undefined' && !document.hasFocus()) {
                    const prev = document.title.replace(/^\(\d+\)\s*/, '')
                    const match = document.title.match(/^\((\d+)\)/)
                    const count = match ? parseInt(match[1]) + 1 : 1
                    document.title = `(${count}) ${prev}`
                  }
                },
                onError: (error, code) => {
                  addMessages((prev) => {
                    const next = [...prev]
                    next[next.length - 1] = {
                      ...next[next.length - 1],
                      content: `⚠️ ${error}`,
                      error: true,
                      errorCode: code,
                      retryable: true,
                    }
                    return next
                  })
                },
              })
              if (!fullText) {
                addMessages((prev) => {
                  const next = [...prev]
                  if (!next[next.length - 1]?.content) {
                    next[next.length - 1] = { ...next[next.length - 1], content: '(no response)' }
                  }
                  return next
                })
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Unknown error'
              if (msg === 'ws_not_connected') {
                // WS dropped mid-stream — fall back to SSE
                await streamOneGateway(
                  gwId,
                  null,
                  csrfToken,
                  '',
                  false,
                  imageAttachments.length ? imageAttachments : undefined
                )
              } else if (msg !== 'ws.timeout') {
                addMessages((prev) => {
                  const next = [...prev]
                  next[next.length - 1] = {
                    ...next[next.length - 1],
                    content: `⚠️ ${msg}`,
                    error: true,
                    retryable: true,
                  }
                  return next
                })
              }
            }
          } else {
            // ── SSE fallback (WS not connected yet) ──────────────────────────
            await streamOneGateway(
              gwId,
              null,
              csrfToken,
              '',
              false,
              imageAttachments.length ? imageAttachments : undefined
            )
          }
        }
      } catch (err) {
        addMessages((prev) => {
          const next = [...prev]
          next[next.length - 1] = {
            ...next[next.length - 1],
            content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          }
          return next
        })
      } finally {
        setSending(session.sessionKey, false)
      }
    },
    [
      selectedSession,
      gateways,
      messagesCache,
      lsSaveMessages,
      setMessages,
      setSending,
      chatWs,
      uiControlEnabled,
      filesCurrentPath,
      terminalWindows,
      activeTab,
    ]
  )

  // ── Queue processor (per-session) ────────────────────────────────────────
  const processNext = useCallback(
    async (sessionKey: string) => {
      const queue = messageQueues.current.get(sessionKey) ?? []
      const next = queue.shift()
      if (!next) {
        processingQueues.current.set(sessionKey, false)
        // Update queueLength only if this is still the selected session
        if (selectedSessionRef.current?.sessionKey === sessionKey) setQueueLength(0)
        return
      }
      if (selectedSessionRef.current?.sessionKey === sessionKey) {
        setQueueLength(queue.length)
      }
      await sendMessageCore(next.text, next.attachments, next.session, true) // skipUserMsg - already displayed
      await processNext(sessionKey)
      // processNext is stable - sendMessageCore dep tracked below
    },
    [sendMessageCore]
  )

  // ── Helper to display user message immediately ────────────────────────────
  const displayUserMessage = useCallback(
    (text: string, attachments: PendingAttachment[], session: Session) => {
      const displayAttachments = attachments
        .filter((a) => a.type === 'image' && a.preview)
        .map((a) => ({
          type: 'image' as const,
          name: a.name,
          preview: a.preview,
          mimeType: a.mimeType,
        }))

      const userMsg: Message = {
        role: 'user',
        content: text || attachments.map((a) => `[📎 ${a.name}]`).join(' '),
        timestamp: new Date().toISOString(),
        attachments: displayAttachments.length > 0 ? displayAttachments : undefined,
      }

      // Add to cache and display
      const currentCached = messagesCache.current.get(session.sessionKey) ?? []
      const next = [...currentCached, userMsg]
      messagesCache.current.set(session.sessionKey, next)
      lsSaveMessages(session.sessionKey, next)
      if (selectedSessionRef.current?.sessionKey === session.sessionKey) {
        setMessages(next)
      }
    },
    [messagesCache, lsSaveMessages, setMessages]
  )

  // ── Public sendMessage: captures input, queues or sends immediately ───────
  const sendMessage = useCallback(() => {
    if (!selectedSession || (!input.trim() && pendingAttachments.length === 0)) return

    const sessionKey = selectedSession.sessionKey
    const capturedText = input.trim()
    const capturedAttachments = [...pendingAttachments]
    // Slash command = starts with /word (e.g. /abort, /status, /help)
    // Not a command: paths like "check /home/user" or "ratio 1/2"
    const isSlashCommand = /^\/[a-zA-Z]/.test(capturedText)

    // Clear input immediately (visual feedback)
    setInput('')
    setPendingAttachments([])

    // ALWAYS display user message immediately in chat (no more hidden queue)
    displayUserMessage(capturedText, capturedAttachments, selectedSession)

    // Slash commands bypass the queue entirely — they run in parallel
    if (isSlashCommand) {
      sendMessageCore(capturedText, capturedAttachments, selectedSession, true) // skipUserMsg=true
      return
    }

    if (processingQueues.current.get(sessionKey)) {
      // Queue it for this session, capturing the exact session object
      const queue = messageQueues.current.get(sessionKey) ?? []
      queue.push({ text: capturedText, attachments: capturedAttachments, session: selectedSession })
      messageQueues.current.set(sessionKey, queue)
      setQueueLength(queue.length)
      return
    }

    // Send immediately for this session, passing the captured session explicitly
    processingQueues.current.set(sessionKey, true)
    if (!messageQueues.current.has(sessionKey)) {
      messageQueues.current.set(sessionKey, [])
    }
    sendMessageCore(capturedText, capturedAttachments, selectedSession, true).then(() => {
      processNext(sessionKey)
    })
  }, [selectedSession, input, pendingAttachments, sendMessageCore, processNext, displayUserMessage])

  return {
    input,
    setInput,
    pendingAttachments,
    setPendingAttachments,
    sending,
    queueLength,
    fileInputRef,
    sendMessage,
    handleFileSelect,
    compressImage,
  }
}
