'use client'

import { RefObject, Dispatch, SetStateAction, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, Paperclip, FileText, Music, X, Mic, MicOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sessionDisplayName } from '@/lib/session-utils'
import type { Session, PendingAttachment } from '@/lib/types'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { useAgentUIControl } from '@/context/agent-ui-control-context'

const QUICK_COMMANDS = ['/status', '/reset', '/new', '/help']

interface ChatInputProps {
  pendingAttachments: PendingAttachment[]
  setPendingAttachments: Dispatch<SetStateAction<PendingAttachment[]>>
  input: string
  setInput: Dispatch<SetStateAction<string>>
  sendMessage: () => void
  sending: boolean
  queueLength: number
  selectedSession: Session
  fileInputRef: RefObject<HTMLInputElement | null>
  handleFileSelect: (files: FileList | null) => void
}

export function ChatInput({
  pendingAttachments,
  setPendingAttachments,
  input,
  setInput,
  sendMessage,
  sending,
  queueLength,
  selectedSession,
  fileInputRef,
  handleFileSelect,
}: ChatInputProps) {
  const { speechLang } = useAgentUIControl()
  // Capture text that existed before speech started so we can append (not replace)
  const preSpeechTextRef = useRef('')
  const {
    isListening,
    isSupported,
    toggle: _toggle,
    startListening: _startListening,
    stopListening,
    errorMessage,
  } = useSpeechRecognition((text) => {
    setInput(preSpeechTextRef.current + (preSpeechTextRef.current ? ' ' : '') + text)
  }, speechLang)

  // Wrap startListening/toggle to capture pre-speech text first
  const startListening = useCallback(() => {
    preSpeechTextRef.current = input.trim()
    _startListening()
  }, [input, _startListening])

  const toggle = useCallback(() => {
    if (!isListening) preSpeechTextRef.current = input.trim()
    _toggle()
  }, [isListening, input, _toggle])

  // Textarea ref for focus management + height reset
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Reset textarea height when input is cleared (after send)
  useEffect(() => {
    if (!input && textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input])

  // FIX 1: Refocus textarea when mic stops so Enter sends message, not re-triggers mic
  const prevListeningRef = useRef(false)
  useEffect(() => {
    if (prevListeningRef.current && !isListening) {
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
    prevListeningRef.current = isListening
  }, [isListening])

  // Stable refs so the event listener never goes stale
  const startListeningRef = useRef(startListening)
  const stopListeningRef = useRef(stopListening)
  const isListeningRef = useRef(isListening)
  startListeningRef.current = startListening
  stopListeningRef.current = stopListening
  isListeningRef.current = isListening

  // FIX 4: Alt+A / Option+A shortcut — mounted once, never re-registers
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.code !== 'KeyA') return
      e.preventDefault()
      if (isListeningRef.current) stopListeningRef.current()
      else startListeningRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, []) // empty deps — stable via refs

  return (
    <div className="px-4 pt-2.5 pb-3 border-t border-[var(--color-border)] bg-[var(--color-bg-surface)] flex-shrink-0">
      {/* Attachment preview chips */}
      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {pendingAttachments.map((att) => (
            <div
              key={att.id}
              className="rounded-full bg-[var(--color-bg-elevated)] text-xs px-2 py-1 flex items-center gap-1 border border-[var(--color-border)]"
            >
              {att.type === 'image' && att.preview ? (
                <img
                  src={att.preview}
                  alt={att.name}
                  className="w-8 h-8 rounded object-cover -ml-1 mr-0.5"
                />
              ) : att.type === 'audio' ? (
                <Music className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
              ) : (
                <FileText className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
              )}
              <span className="max-w-[120px] truncate text-[var(--color-text-secondary)]">
                {att.name}
              </span>
              {att.status === 'loading' && (
                <Loader2 className="h-3 w-3 animate-spin ml-1 text-[var(--color-text-muted)]" />
              )}
              <button
                type="button"
                onClick={() => setPendingAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                className="ml-1 text-[var(--color-text-muted)] hover:text-red-500 transition-colors"
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          sendMessage()
        }}
      >
        {/* Main input bar */}
        <div className="flex items-end gap-2 bg-white rounded-2xl px-3 py-2 border border-[var(--color-border)] shadow-sm focus-within:border-[oklch(0.70_0.20_46_/_0.4)] focus-within:ring-2 focus-within:ring-[oklch(0.70_0.20_46_/_0.1)] transition-all">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-1 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors mb-0.5 flex-shrink-0"
            title="Attach file or image"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder={`Message ${sessionDisplayName(selectedSession)}…`}
            rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] py-0.5 min-h-[20px] max-h-[120px] leading-relaxed"
            autoFocus
          />
          {/* Mic button — only shown if Web Speech API is supported */}
          {isSupported && (
            <div className="relative flex-shrink-0 mb-0.5">
              <button
                type="button"
                onClick={toggle}
                title={isListening ? 'Stop dictation' : 'Dictate message'}
                className={cn(
                  'p-2 rounded-xl transition-all',
                  isListening
                    ? 'bg-[var(--color-primary)] text-white animate-pulse'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[oklch(0.70_0.20_46_/_0.08)]'
                )}
              >
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              {/* Error tooltip */}
              {errorMessage && (
                <div className="absolute bottom-full right-0 mb-1.5 w-60 text-[11px] bg-red-50 text-red-700 border border-red-200 rounded-lg px-2.5 py-1.5 shadow-sm z-10">
                  {errorMessage}
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={!input.trim() && pendingAttachments.length === 0}
            className={cn(
              'relative p-2 rounded-xl transition-all flex-shrink-0 mb-0.5',
              input.trim() || pendingAttachments.length > 0
                ? 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-dark)] hover:shadow-[0_0_20px_oklch(0.70_0.20_46_/_0.20)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] cursor-not-allowed'
            )}
          >
            {sending && queueLength === 0 ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {queueLength > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-orange-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                +{queueLength}
              </span>
            )}
          </button>
        </div>
      </form>

      {/* Quick commands — below form, visually attached */}
      <div className="flex gap-1.5 mt-1.5 flex-wrap">
        {QUICK_COMMANDS.map((cmd) => (
          <button
            key={cmd}
            type="button"
            onClick={() => setInput((prev) => (prev ? `${prev} ${cmd}` : cmd))}
            className="text-[11px] px-2 py-0.5 rounded-md bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[oklch(0.70_0.20_46_/_0.08)] transition-colors border border-[var(--color-border)] font-mono"
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,audio/*,.txt,.md,.pdf,.csv,.json,.js,.ts,.py,.html,.css"
        className="hidden"
        onChange={(e) => {
          handleFileSelect(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
