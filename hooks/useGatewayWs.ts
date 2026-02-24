'use client'

/**
 * useGatewayWs
 *
 * Browser WebSocket hook that connects to the server-side gateway WS bridge.
 * Endpoint: wss://<host>/api/gateway/ws?gatewayId=<id>
 *
 * Features:
 *  - Auto-reconnects with exponential backoff (1s → 2s → 4s → 8s → 16s → 30s)
 *  - Queues outgoing frames during reconnection and flushes on reconnect
 *  - Exposes send(method, params) to send req frames to the gateway
 *  - Exposes on(event, handler) to subscribe to gateway events
 *  - Reports connection state: 'connecting' | 'connected' | 'disconnected'
 *  - Internal bridge events (__bridge__) are translated to typed hook events:
 *      'gateway:connected', 'gateway:disconnected', 'gateway:connecting', 'gateway:error'
 *
 * The SSE fallback (app/api/chat/stream/route.ts) is NOT touched by this hook.
 */

import { useEffect, useRef, useCallback, useState } from 'react'

export type GatewayWsState = 'connecting' | 'connected' | 'disconnected'

export type GatewayEventHandler = (payload: unknown) => void

export interface UseGatewayWsOptions {
  /** Gateway ID to connect to.  Pass null/undefined to disable the hook. */
  gatewayId: string | null | undefined
  /** Whether the hook should be active.  Defaults to true. */
  enabled?: boolean
}

export interface UseGatewayWsReturn {
  /** Current connection state */
  state: GatewayWsState
  /**
   * Send a request frame to the gateway.
   * @returns A generated request id (can be used to correlate responses).
   * If the socket is not connected the frame is queued and sent on reconnect.
   */
  send: (method: string, params?: unknown) => string
  /**
   * Subscribe to gateway events.
   * @param event Gateway event name (e.g. 'agent'), or '*' for all events.
   * @returns A cleanup function that removes the handler.
   */
  on: (event: string, handler: GatewayEventHandler) => () => void
}

// Backoff schedule in ms (capped at 30s)
const BACKOFF_DELAYS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]

export function useGatewayWs({
  gatewayId,
  enabled = true,
}: UseGatewayWsOptions): UseGatewayWsReturn {
  const [state, setState] = useState<GatewayWsState>('disconnected')

  // Stable refs — never trigger re-renders
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptRef = useRef(0)
  const mountedRef = useRef(false)
  const queueRef = useRef<string[]>([])
  // Map of event name → set of handlers
  const handlersRef = useRef<Map<string, Set<GatewayEventHandler>>>(new Map())
  // Forward-declare so connect/scheduleReconnect can cross-reference via ref
  const connectRef = useRef<() => void>(() => {})
  const scheduleReconnectRef = useRef<() => void>(() => {})

  // ── Emit a named event to registered handlers ───────────────────────────────
  const emit = useCallback((event: string, payload: unknown) => {
    const set = handlersRef.current.get(event)
    if (set) for (const h of set) { try { h(payload) } catch { /* ignore */ } }
    // Wildcard handlers receive all events
    const all = handlersRef.current.get('*')
    if (all) for (const h of all) { try { h({ event, payload }) } catch { /* ignore */ } }
  }, [])

  // ── Flush queued frames over an open WebSocket ──────────────────────────────
  const flushQueue = useCallback((ws: WebSocket) => {
    const pending = queueRef.current.splice(0)
    for (const msg of pending) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(msg) } catch { /* ignore */ }
      }
    }
  }, [])

  // ── Core connect logic ──────────────────────────────────────────────────────
  useEffect(() => {
    // Define connect inside the effect so it always captures current values.
    // Store it in a ref so scheduleReconnect can call it without circular deps.

    const connect = () => {
      if (!mountedRef.current || !gatewayId || !enabled) return

      // Determine WS URL based on current page location
      const proto =
        typeof window !== 'undefined' && window.location.protocol === 'https:'
          ? 'wss'
          : 'ws'
      const host =
        typeof window !== 'undefined' ? window.location.host : 'localhost'
      const url = `${proto}://${host}/api/gateway/ws?gatewayId=${encodeURIComponent(gatewayId)}`

      setState('connecting')

      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch (err) {
        console.error('[useGatewayWs] WebSocket constructor failed:', err)
        scheduleReconnectRef.current()
        return
      }

      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(1000); return }
        reconnectAttemptRef.current = 0
        setState('connected')
        flushQueue(ws)
      }

      ws.onmessage = (evt) => {
        let frame: {
          type?: string
          event?: string
          payload?: unknown
        }
        try { frame = JSON.parse(evt.data) } catch { return }

        if (frame.type === 'event' && frame.event) {
          if (frame.event === '__bridge__') {
            // Translate internal bridge events to typed hook events
            const p = frame.payload as { type?: string; gatewayId?: string; message?: string } | null
            if (p?.type === 'gateway_connected') emit('gateway:connected', p)
            else if (p?.type === 'gateway_disconnected') emit('gateway:disconnected', p)
            else if (p?.type === 'gateway_connecting') emit('gateway:connecting', p)
            else if (p?.type === 'error') emit('gateway:error', p)
            return
          }
          emit(frame.event, frame.payload)
        }

        // Also forward response frames (type === 'res') keyed by event name 'res'
        if (frame.type === 'res') {
          emit('res', frame)
        }
      }

      ws.onclose = (evt) => {
        if (!mountedRef.current) return
        wsRef.current = null
        setState('disconnected')
        // 4001 = unauthorized (don't retry — credentials won't change)
        // 1000 = normal close (intentional — don't retry)
        if (evt.code !== 1000 && evt.code !== 4001) {
          scheduleReconnectRef.current()
        }
      }

      ws.onerror = () => {
        // onclose will fire after onerror — scheduleReconnect is called there
      }
    }

    const scheduleReconnect = () => {
      if (!mountedRef.current) return
      const delay =
        BACKOFF_DELAYS[Math.min(reconnectAttemptRef.current, BACKOFF_DELAYS.length - 1)]
      reconnectAttemptRef.current++
      console.log(
        `[useGatewayWs] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current})`
      )
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect()
      }, delay)
    }

    // Wire up the refs so ws callbacks can call them
    connectRef.current = connect
    scheduleReconnectRef.current = scheduleReconnect

    mountedRef.current = true
    reconnectAttemptRef.current = 0

    if (gatewayId && enabled) {
      connect()
    }

    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      const ws = wsRef.current
      wsRef.current = null
      if (ws) {
        try { ws.close(1000) } catch { /* ignore */ }
      }
    }
  // Re-run when gatewayId or enabled changes — this re-connects to the correct gateway.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayId, enabled])

  // ── Public API ────────────────────────────────────────────────────────────

  const send = useCallback((method: string, params?: unknown): string => {
    const id = `${Math.random().toString(36).slice(2)}-${Date.now()}`
    const frame = JSON.stringify({ type: 'req', id, method, params })
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      try { ws.send(frame) } catch { queueRef.current.push(frame) }
    } else {
      // Queue for when connection is restored
      queueRef.current.push(frame)
    }
    return id
  }, [])

  const on = useCallback((event: string, handler: GatewayEventHandler): (() => void) => {
    const map = handlersRef.current
    if (!map.has(event)) map.set(event, new Set())
    map.get(event)!.add(handler)
    return () => {
      map.get(event)?.delete(handler)
    }
  }, [])

  return { state, send, on }
}
