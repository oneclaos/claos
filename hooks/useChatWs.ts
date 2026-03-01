'use client'

/**
 * useChatWs
 *
 * Wraps useGatewayWs to provide a streaming chat interface over WebSocket.
 * Used for 1-1 sessions (single gateway) to eliminate SSE fragility.
 *
 * Multi-agent sessions (multiple gateways) still use SSE since you can't
 * fan-out a single WS send to multiple gateways in a React-hook-safe way.
 *
 * Protocol:
 *   1. send 'chat.send' via WS
 *   2. listen for 'agent' events filtered by runId
 *   3. accumulate deltas, resolve on lifecycle.end
 */

import { useCallback, useRef } from 'react'
import { useGatewayWs, type GatewayWsState } from './useGatewayWs'
// (no randomId import needed)

export interface StreamChatParams {
  sessionKey: string
  message: string
  idempotencyKey: string
  attachments?: { content: string; mimeType?: string; fileName?: string }[]
  onDelta: (delta: string, accumulated: string) => void
  onDone: (fullText: string) => void
  onError: (error: string, code?: string) => void
}

export interface UseChatWsReturn {
  /** Current WS connection state */
  state: GatewayWsState
  /**
   * Stream a chat message over WebSocket.
   * Resolves with the full assistant response text.
   * Falls back cleanly if WS is disconnected (caller should use SSE fallback).
   */
  streamChat: (params: StreamChatParams) => Promise<string>
}

export function useChatWs(gatewayId: string | null | undefined): UseChatWsReturn {
  const ws = useGatewayWs({ gatewayId })

  // Keep track of active stream request ids → cleanup fns
  const _activeStreamsRef = useRef<Map<string, () => void>>(new Map())

  const streamChat = useCallback(
    async (params: StreamChatParams): Promise<string> => {
      const { sessionKey, message, idempotencyKey, attachments, onDelta, onDone, onError } = params

      if (ws.state !== 'connected') {
        throw new Error('ws_not_connected')
      }

      return new Promise<string>((resolve, reject) => {
        let activeRunId: string | null = null
        let accumulatedText = ''
        let settled = false

        const settle = (fn: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(outerTimeout)
          offAgent()
          fn()
        }

        // 3-minute hard timeout (agent is given plenty of time)
        const outerTimeout = setTimeout(() => {
          settle(() => {
            if (accumulatedText) {
              onDone(accumulatedText)
              resolve(accumulatedText)
            } else {
              onError('Response timeout — agent took too long', 'ws.timeout')
              reject(new Error('ws.timeout'))
            }
          })
        }, 180_000)

        // Listen for agent events from the gateway
        const offAgent = ws.on('agent', (raw: unknown) => {
          if (settled) return
          const p = raw as {
            runId?: string
            stream?: string
            data?: { delta?: string; phase?: string; error?: string }
          }
          const { runId, stream, data } = p

          // Strict: reject events without runId (other sessions like Telegram leaking through)
          if (!runId) return
          // Lock onto the first runId we see for this request
          if (!activeRunId) activeRunId = runId
          // Ignore events from other concurrent runs / sessions
          if (runId !== activeRunId) return

          if (stream === 'assistant' && data?.delta) {
            accumulatedText += data.delta
            onDelta(data.delta, accumulatedText)
          }

          if (stream === 'lifecycle') {
            if (data?.phase === 'end') {
              settle(() => {
                onDone(accumulatedText)
                resolve(accumulatedText)
              })
            } else if (data?.phase === 'error') {
              settle(() => {
                const msg = data.error ?? 'Agent lifecycle error'
                onError(msg, 'agent.error')
                reject(new Error(msg))
              })
            }
          }
        })

        // Send the chat message via WS
        ws.send('chat.send', {
          sessionKey,
          message,
          idempotencyKey,
          ...(attachments?.length ? { attachments } : {}),
        })
      })
    },
    [ws]
  )

  return { state: ws.state, streamChat }
}
