'use client'

/**
 * ChatView — Chat interface for a specific session.
 *
 * Rendered by the dashboard page when activeTab.section === 'chat'.
 * Encapsulates the message list, input, and header for one chat session.
 */

import { useRef } from 'react'
import { ChatHeader } from '@/components/chat/chat-header'
import { ChatInput } from '@/components/chat/chat-input'
import { MessageList } from '@/components/chat/message-list'
import { useChat } from '@/context/chat-context'
import { useMessageSender } from '@/hooks/useMessageSender'
import type { Session, Gateway } from '@/lib/types'

interface ChatViewProps {
  session: Session
  gateways: Gateway[]
  onDelete: (session: Session) => void | Promise<void>
}

export function ChatView({ session, gateways, onDelete }: ChatViewProps) {
  const { messages, loadingHistory } = useChat()
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

  const messagesEndRef = useRef<HTMLDivElement>(null)

  return (
    <>
      <ChatHeader session={session} gateways={gateways} onDelete={onDelete} />
      <MessageList
        messages={messages}
        sending={sending}
        loadingHistory={loadingHistory}
        selectedSession={session}
        messagesEndRef={messagesEndRef}
      />
      <ChatInput
        input={input}
        setInput={setInput}
        sending={sending}
        queueLength={queueLength}
        pendingAttachments={pendingAttachments}
        setPendingAttachments={setPendingAttachments}
        sendMessage={sendMessage}
        selectedSession={session}
        fileInputRef={fileInputRef}
        handleFileSelect={handleFileSelect}
      />
    </>
  )
}
