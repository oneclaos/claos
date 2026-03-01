'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useChat } from '@/context/chat-context'
import { useAgentUIControl } from '@/context/agent-ui-control-context'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { Session, Gateway } from '@/lib/types'
import { sessionDisplayName } from '@/lib/session-utils'
import { useSessionLoader } from '@/hooks/useSessionLoader'
import { useMessageSender } from '@/hooks/useMessageSender'
import { useChatSessionManager } from '@/components/chat/chat-session-manager'
import { useUIRelay } from '@/components/chat/use-ui-relay'
import { useSessionFilters } from '@/components/chat/use-session-filters'
import { SessionsSidebar } from '@/components/chat/sessions-sidebar'
import { ChatHeader } from '@/components/chat/chat-header'
import { ChatInput } from '@/components/chat/chat-input'
import { MessageList } from '@/components/chat/message-list'
import { NewChatPanel } from '@/components/chat/new-chat-panel'
import { NewGroupPanel } from '@/components/chat/new-group-panel'
import { SessionsTab } from '@/components/chat/SessionsTab'
import { MessageSquare, Loader2, Server, Search, X, Trash2 } from 'lucide-react'

type ChatTab = 'messages' | 'sessions'

export function ChatSection() {
  const toast = useToast()

  // ── Context state ─────────────────────────────────────────────────────────
  const { sessions, gateways, selectedSession, messages, loadingHistory, loadingSessions } =
    useChat()

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const { loadSessions, loadHistory } = useSessionLoader()
  const {
    input,
    setInput,
    pendingAttachments,
    setPendingAttachments,
    sending,
    queueLength,
    fileInputRef,
    sendMessage,
    handleFileSelect,
  } = useMessageSender()
  const { enabled: uiControlEnabled } = useAgentUIControl()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // ── Session management ────────────────────────────────────────────────────
  const { selectSession, createDirectSession, createGroupSession, deleteSession } =
    useChatSessionManager({
      onSessionSelected: () => {
        setShowNewChat(false)
        setShowNewGroup(false)
      },
    })

  // ── Session filters ───────────────────────────────────────────────────────
  const { appSessions, directSessions, groupSessions } = useSessionFilters({
    sessions,
    selectedSession,
  })

  // ── UI Relay (auto-execute markers) ───────────────────────────────────────
  useUIRelay({
    enabled: uiControlEnabled,
    selectedSession,
    messages,
    sending,
  })

  // ── Local UI state ────────────────────────────────────────────────────────
  const [chatTab, setChatTab] = useState<ChatTab>('messages')
  const [showNewChat, setShowNewChat] = useState(false)
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [selectedGateways, setSelectedGateways] = useState<Gateway[]>([])
  const [msgSearch, setMsgSearch] = useState('')

  // ── Auto-scroll (improved: scroll on message content changes during streaming) ─
  const lastMessageContentRef = useRef<string>('')
  useEffect(() => {
    const lastMsg = messages[messages.length - 1]
    const lastContent = typeof lastMsg?.content === 'string' ? lastMsg.content : ''

    // Always scroll on new messages or when streaming content grows significantly
    const shouldScroll =
      messages.length !== 0 && (lastContent !== lastMessageContentRef.current || sending)

    if (shouldScroll) {
      // Use requestAnimationFrame for smoother scrolling during streaming
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      })
    }
    lastMessageContentRef.current = lastContent
  }, [messages, sending])

  // Reset search when switching session
  const prevSessionKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const key = selectedSession?.sessionKey ?? null
    if (key !== prevSessionKeyRef.current) {
      prevSessionKeyRef.current = key
      setMsgSearch('')
    }
  }, [selectedSession?.sessionKey])

  // Load history when session changes
  useEffect(() => {
    if (selectedSession) {
      loadHistory(selectedSession)
    }
  }, [selectedSession, loadHistory])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleNewChat = useCallback(
    async (gateway: Gateway) => {
      await createDirectSession(gateway)
      setShowNewChat(false)
      setSelectedGateways([])
    },
    [createDirectSession]
  )

  const handleNewGroup = useCallback(async () => {
    try {
      await createGroupSession(selectedGateways)
      setShowNewGroup(false)
      setSelectedGateways([])
    } catch {
      // Error already toasted in hook
    }
  }, [selectedGateways, createGroupSession])

  const openInMessages = useCallback(
    (session: Session) => {
      setChatTab('messages')
      selectSession(session)
    },
    [selectSession]
  )

  const handleCleanup = useCallback(async () => {
    // Cleanup server-side ghost sessions
    const { getCsrfToken } = await import('@/lib/csrf-client')
    const csrf = await getCsrfToken()
    await fetch('/api/sessions/cleanup', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'x-csrf-token': csrf },
    })
    // Cleanup localStorage orphans
    const prefix = 'claos:msgs:'
    const activeKeys = new Set(sessions.map((s) => prefix + s.sessionKey))
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(prefix) && !activeKeys.has(k)) localStorage.removeItem(k)
    }
    // Clear hidden sessions list too
    localStorage.removeItem('claos_hidden_sessions')
    await loadSessions()
    toast.success('Ghost sessions cleaned up')
  }, [sessions, loadSessions, toast])

  // ── Helper computations ────────────────────────────────────────────────────
  const isOnline = (session: Session) =>
    gateways.find((g) => g.id === session.gateway)?.online ?? false

  const filteredMessages = msgSearch.trim()
    ? messages.filter(
        (m) =>
          typeof m.content === 'string' && m.content.toLowerCase().includes(msgSearch.toLowerCase())
      )
    : messages

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {/* ── Tab bar ── */}
      <div className="flex-shrink-0 border-b border-[var(--color-border)]/50 bg-white px-4 flex items-center gap-1 h-11">
        <button
          onClick={() => setChatTab('messages')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-100',
            chatTab === 'messages'
              ? 'bg-[var(--primary-light)] text-[var(--primary)]'
              : 'text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--background-secondary)]'
          )}
        >
          <MessageSquare className="h-4 w-4" />
          Messages
        </button>
        <button
          onClick={() => setChatTab('sessions')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-100',
            chatTab === 'sessions'
              ? 'bg-[var(--primary-light)] text-[var(--primary)]'
              : 'text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--background-secondary)]'
          )}
        >
          <Server className="h-4 w-4" />
          Sessions
          {appSessions.length > 0 && (
            <span className="ml-1 text-xs bg-[var(--background-secondary)] text-[var(--foreground-muted)] rounded-full px-1.5 py-0.5 leading-none">
              {appSessions.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* ════════════ MESSAGES TAB ════════════ */}
        {chatTab === 'messages' && (
          <div className="flex-1 flex min-h-0">
            <div className="flex-1 flex min-h-0 bg-white">
              {/* Sessions Sidebar */}
              <div className="flex-shrink-0 border-r border-[var(--color-border)]/50">
                <SessionsSidebar
                  directSessions={directSessions}
                  groupSessions={groupSessions}
                  selectedSession={selectedSession}
                  loadingSessions={loadingSessions}
                  isOnline={isOnline}
                  displayName={sessionDisplayName}
                  onSelect={selectSession}
                  onDelete={deleteSession}
                  onNewChat={() => {
                    setShowNewChat(true)
                    setShowNewGroup(false)
                  }}
                  onNewGroup={() => {
                    setShowNewGroup(true)
                    setShowNewChat(false)
                  }}
                />
              </div>

              {/* Main panel */}
              <div className="flex-1 flex flex-col min-w-0">
                {showNewChat ? (
                  <NewChatPanel
                    gateways={gateways}
                    onSelectGateway={handleNewChat}
                    onCancel={() => setShowNewChat(false)}
                  />
                ) : showNewGroup ? (
                  <NewGroupPanel
                    gateways={gateways}
                    selectedGateways={selectedGateways}
                    onToggle={(gw) =>
                      setSelectedGateways((prev) =>
                        prev.find((g) => g.id === gw.id)
                          ? prev.filter((g) => g.id !== gw.id)
                          : [...prev, gw]
                      )
                    }
                    onCreate={handleNewGroup}
                    onCancel={() => {
                      setShowNewGroup(false)
                      setSelectedGateways([])
                    }}
                  />
                ) : selectedSession ? (
                  <>
                    <ChatHeader
                      session={selectedSession}
                      gateways={gateways}
                      onDelete={deleteSession}
                    />
                    {/* Search bar in conversation */}
                    <div className="flex-shrink-0 border-b border-[var(--color-border)]/40 bg-white px-3 py-2">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                        <input
                          type="text"
                          value={msgSearch}
                          onChange={(e) => setMsgSearch(e.target.value)}
                          placeholder="Search in conversation…"
                          className="w-full pl-8 pr-8 py-1.5 text-xs bg-[var(--color-bg-elevated)] rounded-xl border border-transparent focus:border-[var(--color-border)] focus:outline-none text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-colors"
                        />
                        {msgSearch && (
                          <button
                            onClick={() => setMsgSearch('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <MessageList
                      messages={filteredMessages}
                      sending={sending}
                      loadingHistory={loadingHistory}
                      selectedSession={selectedSession}
                      messagesEndRef={messagesEndRef}
                      searchQuery={msgSearch}
                    />
                    <ChatInput
                      input={input}
                      setInput={setInput}
                      sending={sending}
                      queueLength={queueLength}
                      pendingAttachments={pendingAttachments}
                      setPendingAttachments={setPendingAttachments}
                      sendMessage={sendMessage}
                      selectedSession={selectedSession}
                      fileInputRef={fileInputRef}
                      handleFileSelect={handleFileSelect}
                    />
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 rounded-2xl bg-[oklch(0.70_0.20_46_/_0.08)] flex items-center justify-center mx-auto mb-4">
                        <MessageSquare className="h-8 w-8 text-[var(--color-primary)]" />
                      </div>
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                        Select a conversation
                      </h2>
                      <p className="text-sm text-[var(--color-text-muted)]">
                        Or start a new chat with an agent
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ════════════ SESSIONS TAB ════════════ */}
        {chatTab === 'sessions' && (
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 flex items-center justify-between max-w-3xl mx-auto">
              <h2 className="text-sm font-semibold text-gray-600">All Gateway Sessions</h2>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleCleanup}>
                  <Trash2 className="h-3 w-3 mr-1" />
                  Clean up
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadSessions}
                  disabled={loadingSessions}
                >
                  {loadingSessions ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Refresh
                </Button>
              </div>
            </div>
            <SessionsTab
              sessions={sessions}
              gateways={gateways}
              loading={loadingSessions}
              onDelete={deleteSession}
              onOpenInMessages={openInMessages}
            />
          </div>
        )}
      </div>
    </div>
  )
}
