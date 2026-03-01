'use client'

/**
 * FloatingAgentButton
 *
 * Persistent ⚡ button (fixed bottom-right).
 * Hidden when:
 *   - UI Control is disabled
 *
 * Opens a popup with:
 *   - Agent selector (auto-hidden if single agent)
 *   - Command input
 *   - Launch + Stop buttons
 *
 * On launch:
 *   - Optionally parses command locally (no AI needed for simple nav)
 *   - Sends command to agent via /api/chat/stream
 *   - Parses SSE for <!--ui:*--> markers in order of appearance
 *   - Executes actions with appropriate delays between steps
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useAgentUIControl } from '@/context/agent-ui-control-context'
import { useTabContext } from '@/context/tab-context'
import { useTerminals } from '@/context/terminal-context'
import { useChat } from '@/context/chat-context'
import { getCsrfToken, fetchWithCsrf } from '@/lib/csrf-client'
import {
  parseUIActions,
  stripMarkers,
  executeActions as executeUIActions,
  type UIAction,
  type ExecuteActionsContext,
} from '@/lib/ui-relay-actions'
import { buildUIControlMessage } from './ui-control-prompt'
// import { tryParseLocally } from './local-command-parser'
import type { TabView } from '@/lib/tab-types'
import { cn } from '@/lib/utils'
import { Zap, X, Send, Square, Mic, MicOff } from 'lucide-react'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'

const DEFAULT_UI_AGENT_KEY = 'ui-control-default-agent-id'

// ─── Component ───────────────────────────────────────────────────────────────

export function FloatingAgentButton() {
  const {
    enabled,
    status,
    setStatus,
    agents,
    selectedAgentId,
    setSelectedAgentId,
    abortRef,
    stop,
    speechLang,
    filesCurrentPath,
    setPendingNavPath,
  } = useAgentUIControl()

  const { activeTab, navigateActiveTab } = useTabContext()
  const { windows, createTerminal } = useTerminals()
  const { sessions, selectSession } = useChat()
  const windowsRef = useRef(windows)
  windowsRef.current = windows
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const [open, setOpen] = useState(false)
  const [command, setCommand] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null)

  // Load default agent from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(DEFAULT_UI_AGENT_KEY)
    if (saved) {
      setDefaultAgentId(saved)
      setSelectedAgentId(saved)
    }
  }, [setSelectedAgentId])

  const preSpeechCommandRef = useRef('')
  const {
    isListening,
    isSupported: micSupported,
    toggle: _toggleMic,
    startListening: _startListeningFAB,
    stopListening: _stopListening,
    errorMessage: micError,
  } = useSpeechRecognition(
    (text) =>
      setCommand(preSpeechCommandRef.current + (preSpeechCommandRef.current ? ' ' : '') + text),
    speechLang
  )
  // Wrap to capture pre-speech text + refocus input after listening ends
  const toggleMic = useCallback(() => {
    if (!isListening) preSpeechCommandRef.current = command.trim()
    _toggleMic()
  }, [isListening, command, _toggleMic])
  const startListening = useCallback(() => {
    preSpeechCommandRef.current = command.trim()
    _startListeningFAB()
  }, [command, _startListeningFAB])
  // Refocus input when mic stops so Enter submits immediately
  const prevListeningFABRef = useRef(false)
  useEffect(() => {
    if (prevListeningFABRef.current && !isListening) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
    prevListeningFABRef.current = isListening
  }, [isListening])
  const popupRef = useRef<HTMLDivElement>(null)

  // Focus input when popup opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  // Close popup on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Stable refs for Alt+A handler
  const activeTabRef = useRef(activeTab)
  const openRef = useRef(open)
  const micSupportedRef = useRef(micSupported)
  const isListeningRef2 = useRef(isListening)
  const startListeningRef2 = useRef(startListening)
  activeTabRef.current = activeTab
  openRef.current = open
  micSupportedRef.current = micSupported
  isListeningRef2.current = isListening
  startListeningRef2.current = startListening

  // Alt+A shortcut — mounted once, stable via refs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.code !== 'KeyA') return
      if (activeTabRef.current?.view === 'chat') return
      e.preventDefault()
      if (!openRef.current) setOpen(true)
      setTimeout(() => {
        if (micSupportedRef.current && !isListeningRef2.current) startListeningRef2.current()
      }, 100)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ─── UI Tool Executors ──────────────────────────────────────────────────

  const navigateToTab = useCallback(
    (tab: string) => {
      const validViews: TabView[] = ['chat', 'terminal', 'files', 'status', 'settings']
      if (validViews.includes(tab as TabView)) {
        navigateActiveTab(tab as TabView)
      }
    },
    [navigateActiveTab]
  )

  const ensureTerminal = useCallback(async (): Promise<string | null> => {
    navigateActiveTab('terminal')
    const current = windowsRef.current
    if (current.length === 0) {
      await createTerminal()
      await new Promise((r) => setTimeout(r, 500))
    }
    const latest = windowsRef.current
    return latest[0]?.sessionId ?? null
  }, [navigateActiveTab, createTerminal])

  const typeCommand = useCallback(
    async (cmd: string, sessionId: string) => {
      const chars = (cmd + '\r').split('')
      for (const char of chars) {
        if (abortRef.current?.signal.aborted) return
        await fetchWithCsrf(`/api/terminal/${sessionId}/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: char }),
        })
        await new Promise((r) => setTimeout(r, 20))
      }
    },
    [abortRef]
  )

  // ─── Execute a list of parsed actions in order ───────────────────────────

  const executeActions = useCallback(
    async (actions: UIAction[], abort: AbortController): Promise<void> => {
      const context: ExecuteActionsContext = {
        abort,
        navigateToTab,
        ensureTerminal,
        typeCommand,
        selectSessionByKey: (key: string) => {
          const target = sessionsRef.current.find((s) => s.sessionKey === key)
          if (target) selectSession(target)
        },
        initialTerminalSessionId: windowsRef.current[0]?.sessionId ?? null,
        setPendingNavPath,
      }
      await executeUIActions(actions, context)
    },
    [navigateToTab, ensureTerminal, typeCommand, selectSession, setPendingNavPath]
  )

  // ─── Execute ────────────────────────────────────────────────────────────

  const execute = useCallback(async () => {
    if (!command.trim() || status === 'running') return

    const agent = agents.find((a) => a.id === selectedAgentId) ?? agents[0]
    if (!agent) return

    setOpen(false)
    setStatus('running')

    const abort = new AbortController()
    abortRef.current = abort

    // ── Send to AI for all commands (local parser removed) ───────────────
    const uiSessionKey = `ui-control-${Date.now()}`

    const killUISession = async () => {
      try {
        await fetchWithCsrf(
          `/api/sessions/${encodeURIComponent(uiSessionKey)}?gatewayId=${encodeURIComponent(agent.gatewayId)}&rawKey=${encodeURIComponent(`agent:main:${uiSessionKey}`)}`,
          { method: 'DELETE' }
        )
      } catch {
        // non-fatal — session will expire naturally
      }
    }

    try {
      const csrfToken = await getCsrfToken()
      const message = buildUIControlMessage(command, {
        activeTab: activeTab?.view ?? 'unknown',
        openTerminals: windowsRef.current.map((w) => ({
          name: w.name,
          sessionId: w.sessionId,
          dead: w.dead,
        })),
        filesCurrentPath,
      })

      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          gatewayId: agent.gatewayId,
          sessionKey: uiSessionKey,
          message,
          idempotencyKey: `ui-ctrl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        }),
        signal: abort.signal,
      })

      if (!res.ok || !res.body) {
        setStatus('error')
        setTimeout(() => setStatus('idle'), 3000)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = '' // Accumulate complete response to handle markers spanning chunk boundaries

      while (true) {
        const { done, value } = await reader.read()
        if (done || abort.signal.aborted) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: string
              text?: string
            }

            if (event.type === 'delta' && event.text) {
              fullText += event.text
              // Parse markers in order from accumulated text
              const actions = parseUIActions(fullText)
              if (actions.length > 0) {
                await executeActions(actions, abort)
                // Clear processed markers so they don't re-execute on next chunk
                fullText = stripMarkers(fullText)
              }
            }

            if (event.type === 'done') {
              if (!abort.signal.aborted) {
                setStatus('done')
                setTimeout(() => setStatus('idle'), 2000)
              }
              killUISession()
              return
            }

            if (event.type === 'error') {
              setStatus('error')
              setTimeout(() => setStatus('idle'), 3000)
              killUISession()
              return
            }
          } catch {
            // ignore JSON parse errors
          }
        }
      }

      if (!abort.signal.aborted) {
        setStatus('done')
        setTimeout(() => setStatus('idle'), 2000)
      }
      killUISession()
    } catch (err) {
      killUISession()
      if ((err as Error)?.name === 'AbortError') {
        setStatus('stopped')
      } else {
        setStatus('error')
      }
      setTimeout(() => setStatus('idle'), 3000)
    }
  }, [
    command,
    status,
    agents,
    selectedAgentId,
    setStatus,
    abortRef,
    activeTab,
    filesCurrentPath,
    executeActions,
  ])

  // ─── Visibility guards ───────────────────────────────────────────────────

  if (!enabled) return null
  // Hide in chat view - UI Control works via markers in chat responses, not the button
  if (activeTab?.view === 'chat') return null

  const isRunning = status === 'running'
  const multipleAgents = agents.length > 1

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => {
          if (isRunning) {
            stop()
          } else {
            setOpen((prev) => {
              const next = !prev
              if (next && micSupported) {
                setTimeout(() => startListening(), 100)
              }
              return next
            })
          }
        }}
        className={cn(
          'fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50',
          'w-12 h-12 rounded-full shadow-lg flex items-center justify-center',
          'transition-all duration-200 active:scale-95',
          isRunning
            ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
            : 'gradient-primary  text-white'
        )}
        aria-label={isRunning ? 'Stop agent' : 'Launch agent'}
        title={isRunning ? 'Stop' : 'Agent UI Control (⚡)'}
      >
        {isRunning ? <Square className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
      </button>

      {/* Popup */}
      {open && !isRunning && (
        <div
          ref={popupRef}
          className={cn(
            'fixed bottom-36 right-4 md:bottom-24 md:right-6 z-[60]',
            'w-80 rounded-xl shadow-2xl border',
            'bg-[var(--background)] border-[var(--border)]',
            'p-4 flex flex-col gap-3'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[var(--primary)]" />
              <span className="text-sm font-semibold">Agent UI Control</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-[var(--foreground-muted)] hover:text-[var(--foreground)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Agent selector — only shown if multiple agents */}
          {multipleAgents && (
            <div className="space-y-1">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    setSelectedAgentId(a.id)
                    localStorage.setItem(DEFAULT_UI_AGENT_KEY, a.id)
                    setDefaultAgentId(a.id)
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left',
                    selectedAgentId === a.id
                      ? 'bg-[var(--primary)] text-white'
                      : 'bg-[var(--background-secondary)] border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--background-tertiary,var(--background-secondary))]'
                  )}
                >
                  <span>{a.avatar}</span>
                  <span className="flex-1">{a.name}</span>
                  {defaultAgentId === a.id && <span className="text-xs opacity-70">✓</span>}
                </button>
              ))}
            </div>
          )}

          {/* Single agent name */}
          {!multipleAgents && agents.length === 1 && (
            <div className="flex items-center gap-2 text-sm text-[var(--foreground-muted)]">
              <span>{agents[0].avatar}</span>
              <span>{agents[0].name}</span>
              <span className="ml-auto text-xs text-green-400">● Online</span>
            </div>
          )}

          {/* No agents */}
          {agents.length === 0 && (
            <p className="text-xs text-[var(--foreground-muted)] text-center py-1">
              No agents available
            </p>
          )}

          {/* Command input */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    execute()
                  }
                  if (e.key === 'Escape') setOpen(false)
                }}
                placeholder="E.g.: check prod logs, open terminal..."
                className={cn(
                  'w-full rounded-lg pl-3 pr-8 py-2 text-sm',
                  'bg-[var(--background-secondary)] border border-[var(--border)]',
                  'text-[var(--foreground)] placeholder:text-[var(--foreground-muted)]',
                  'focus:outline-none focus:ring-1 focus:ring-[var(--primary)]',
                  isListening && 'ring-1 ring-red-400 border-red-300'
                )}
              />
              {micSupported && (
                <button
                  type="button"
                  onClick={toggleMic}
                  title={isListening ? 'Stop' : 'Dictate'}
                  className={cn(
                    'absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded transition-colors',
                    isListening
                      ? 'text-red-500 animate-pulse'
                      : 'text-[var(--foreground-muted)] hover:text-[var(--primary)]'
                  )}
                >
                  {isListening ? (
                    <MicOff className="h-3.5 w-3.5" />
                  ) : (
                    <Mic className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              {micError && (
                <div className="absolute bottom-full left-0 mb-1 w-56 text-[11px] bg-red-50 text-red-700 border border-red-200 rounded-lg px-2 py-1 shadow-sm z-10">
                  {micError}
                </div>
              )}
            </div>
            <button
              onClick={execute}
              disabled={!command.trim() || agents.length === 0}
              className={cn(
                'flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center',
                'gradient-primary text-white',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                'active:scale-95 transition-all'
              )}
              aria-label="Run"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>

          {/* Hint */}
          <p className="text-xs text-[var(--foreground-muted)] text-center">
            Enter to run · Esc to close
          </p>
        </div>
      )}
    </>
  )
}
