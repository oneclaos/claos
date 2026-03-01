'use client'

import React, { RefObject } from 'react'
import { MessageSquare, Loader2, User } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { cn, formatRelativeTime } from '@/lib/utils'
import { sessionDisplayName, isGroupSession, parseGroupMessage } from '@/lib/session-utils'
import { MarkdownContent } from './MarkdownContent'
import { useAgentUIControl } from '@/context/agent-ui-control-context'
import { stripMarkers } from '@/lib/ui-relay-actions'
import type { Session, Message } from '@/lib/types'

interface MessageListProps {
  loadingHistory: boolean
  messages: Message[]
  sending: boolean
  selectedSession: Session
  messagesEndRef: RefObject<HTMLDivElement | null>
  searchQuery?: string
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark
        key={i}
        className="bg-[oklch(0.90_0.15_85)] text-[var(--color-text-primary)] rounded px-0.5"
      >
        {part}
      </mark>
    ) : (
      part
    )
  )
}

export function MessageList({
  loadingHistory,
  messages,
  sending,
  selectedSession,
  messagesEndRef,
  searchQuery = '',
}: MessageListProps) {
  const { enabled: uiControlEnabled } = useAgentUIControl()

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[var(--color-bg-base)]">
      {loadingHistory ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-text-muted)]" />
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full py-16 gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[oklch(0.70_0.20_46_/_0.08)] flex items-center justify-center">
            <MessageSquare className="h-6 w-6 text-[var(--color-primary)]" />
          </div>
          <p className="text-sm text-[var(--color-text-muted)]">No messages yet. Say something!</p>
        </div>
      ) : (
        messages.map((msg, i) => {
          const rawContent =
            typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          const parsed =
            msg.role === 'assistant' && isGroupSession(selectedSession)
              ? parseGroupMessage(rawContent)
              : { agent: null, text: rawContent }
          // Strip UI markers from the display text (original state is untouched)
          const displayText =
            msg.role === 'assistant' && uiControlEnabled ? stripMarkers(parsed.text) : parsed.text
          return (
            <div
              key={i}
              className={cn(
                'flex gap-2.5 animate-fade-in',
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              )}
              style={{ animationDelay: `${Math.min(i * 20, 200)}ms` }}
            >
              {msg.role === 'assistant' && (
                <Avatar
                  name={sessionDisplayName(selectedSession)}
                  size="sm"
                  className="mt-5 flex-shrink-0"
                />
              )}
              <div className="max-w-[72%]">
                {parsed.agent && <p className="msg-agent-label px-1">{parsed.agent}</p>}
                <div
                  className={cn(
                    'px-4 py-2.5 overflow-hidden',
                    msg.role === 'user'
                      ? 'msg-user rounded-2xl rounded-tr-sm'
                      : msg.error
                        ? 'rounded-2xl rounded-tl-sm border border-red-500/30 bg-red-500/10 text-red-400'
                        : 'msg-agent rounded-2xl rounded-tl-sm'
                  )}
                >
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {msg.attachments.map((att, j) =>
                        att.type === 'image' && att.preview ? (
                          <img
                            key={j}
                            src={att.preview}
                            alt={att.name}
                            className="max-w-[200px] max-h-[200px] rounded-lg object-cover"
                          />
                        ) : (
                          <span key={j} className="text-xs opacity-70">
                            📎 {att.name}
                          </span>
                        )
                      )}
                    </div>
                  )}
                  {msg.role === 'assistant' ? (
                    <MarkdownContent content={displayText} />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-primary)]">
                      {highlightText(parsed.text, searchQuery)}
                    </p>
                  )}
                  {msg.timestamp && (
                    <p className="text-[10px] mt-1 text-[var(--color-text-muted)]">
                      {formatRelativeTime(msg.timestamp)}
                    </p>
                  )}
                </div>
              </div>
              {msg.role === 'user' && (
                <div className="w-6 h-6 rounded-full bg-[var(--color-primary)] flex items-center justify-center flex-shrink-0 mt-1">
                  <User className="h-3.5 w-3.5 text-white" />
                </div>
              )}
            </div>
          )
        })
      )}

      {/* Typing indicator — show while sending and assistant hasn't started streaming yet */}
      {/* Also show for groups when content is just the label prefix like "**James**: " */}
      {sending &&
        (messages.length === 0 ||
          messages[messages.length - 1]?.role !== 'assistant' ||
          !messages[messages.length - 1]?.content?.trim() ||
          /^\*\*[^*]+\*\*:\s*$/.test(messages[messages.length - 1]?.content?.trim() ?? '')) && (
          <div className="flex gap-2.5 justify-start">
            <Avatar
              name={sessionDisplayName(selectedSession)}
              size="sm"
              className="flex-shrink-0"
            />
            <div className="msg-agent rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1 items-center h-4">
                <span
                  className="w-1.5 h-1.5 bg-[var(--color-text-muted)] rounded-full animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="w-1.5 h-1.5 bg-[var(--color-text-muted)] rounded-full animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className="w-1.5 h-1.5 bg-[var(--color-text-muted)] rounded-full animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </div>
            </div>
          </div>
        )}
      <div ref={messagesEndRef} />
    </div>
  )
}
