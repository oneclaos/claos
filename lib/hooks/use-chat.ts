'use client'

import { useState, useCallback, useRef } from 'react'
import { fetchWithCsrf } from '@/lib/csrf-client'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
}

export interface Gateway {
  id: string
  name: string
}

export interface ChatSession {
  key: string
  kind?: string
  displayName?: string
  lastActive?: string
  gateway: string
}

interface UseChatOptions {
  gatewayId: string
  sessionKey?: string
  onMessage?: (message: ChatMessage) => void
  onError?: (error: string) => void
}

interface UseChatReturn {
  messages: ChatMessage[]
  isLoading: boolean
  isSending: boolean
  error: string | null
  sendMessage: (content: string) => Promise<void>
  loadHistory: () => Promise<void>
  clearMessages: () => void
}

export function useChat(options: UseChatOptions): UseChatReturn {
  const { gatewayId, sessionKey, onMessage, onError } = options

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messageIdCounter = useRef(0)

  const generateId = useCallback(() => {
    return `msg-${Date.now()}-${++messageIdCounter.current}`
  }, [])

  const loadHistory = useCallback(async () => {
    if (!sessionKey) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetchWithCsrf(
        `/api/chat/history?gatewayId=${encodeURIComponent(gatewayId)}&sessionKey=${encodeURIComponent(sessionKey)}`
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to load history')
      }

      const data = await response.json()
      const history: ChatMessage[] = (data.messages || []).map(
        (m: { role: string; content: string; timestamp?: string }, _i: number) => ({
          id: generateId(),
          role: m.role,
          content: m.content,
          timestamp: m.timestamp || new Date().toISOString(),
        })
      )

      setMessages(history)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load history'
      setError(message)
      onError?.(message)
    } finally {
      setIsLoading(false)
    }
  }, [gatewayId, sessionKey, generateId, onError])

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isSending) return

      setIsSending(true)
      setError(null)

      // Add user message immediately
      const userMessage: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: content.trim(),
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMessage])
      onMessage?.(userMessage)

      try {
        const response = await fetchWithCsrf('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gatewayId,
            sessionKey,
            message: content.trim(),
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to send message')
        }

        const data = await response.json()

        // Add assistant response
        const assistantMessage: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: data.response || '(no response)',
          timestamp: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, assistantMessage])
        onMessage?.(assistantMessage)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send message'
        setError(message)
        onError?.(message)

        // Add error message
        const errorMessage: ChatMessage = {
          id: generateId(),
          role: 'system',
          content: `Error: ${message}`,
          timestamp: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, errorMessage])
      } finally {
        setIsSending(false)
      }
    },
    [gatewayId, sessionKey, isSending, generateId, onMessage, onError]
  )

  const clearMessages = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return {
    messages,
    isLoading,
    isSending,
    error,
    sendMessage,
    loadHistory,
    clearMessages,
  }
}

// Hook to fetch available gateways
export function useGateways() {
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchGateways = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetchWithCsrf('/api/chat')
      if (!response.ok) {
        throw new Error('Failed to fetch gateways')
      }
      const data = await response.json()
      setGateways(data.gateways || [])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch gateways'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { gateways, isLoading, error, fetchGateways }
}

// Hook to fetch sessions for a gateway
export function useGatewaySessions(gatewayId: string | null) {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSessions = useCallback(async () => {
    if (!gatewayId) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetchWithCsrf(
        `/api/chat/sessions?gatewayId=${encodeURIComponent(gatewayId)}`
      )
      if (!response.ok) {
        throw new Error('Failed to fetch sessions')
      }
      const data = await response.json()
      const sessionList: ChatSession[] = (data.sessions || []).map(
        (s: { key: string; kind?: string; displayName?: string; lastActive?: string }) => ({
          ...s,
          gateway: gatewayId,
        })
      )
      setSessions(sessionList)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch sessions'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [gatewayId])

  return { sessions, isLoading, error, fetchSessions }
}
