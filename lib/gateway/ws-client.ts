/**
 * Gateway WebSocket Client
 *
 * Handles the WebSocket connection to Clawdbot Gateway with proper auth handshake.
 * Protocol: connect.challenge → connect → hello-ok → ready for requests
 * Supports streaming responses via agent events.
 * Auto-reconnects with exponential backoff on unexpected disconnect.
 * Sends a keepalive ping every 20s to prevent idle disconnects.
 */

import { WebSocket } from 'ws'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { GatewayError, toGatewayError } from './errors'
import { log } from '../logger'
export { GatewayError } from './errors'

export interface GatewayClientOptions {
  url?: string
  token: string
  clientId?: string
  clientVersion?: string
  gatewayType?: 'clawdbot' | 'openclaw' // openclaw requires 'openclaw-control-ui' client id
  onMessage?: (event: string, payload: unknown) => void
  onError?: (error: Error) => void
  onClose?: (code: number, reason: string) => void
  onReady?: () => void
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

interface StreamingResponse {
  text: string
  resolve: (value: { response: string }) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

const KEEPALIVE_INTERVAL_MS = 20_000  // ping every 20s to prevent idle disconnect
const CONNECT_TIMEOUT_MS    = 10_000

export class GatewayWsClient extends EventEmitter {
  private ws: WebSocket | null = null
  private opts: Required<Omit<GatewayClientOptions, 'onMessage' | 'onError' | 'onClose' | 'onReady'>> &
    Pick<GatewayClientOptions, 'onMessage' | 'onError' | 'onClose' | 'onReady'>
  private pending  = new Map<string, PendingRequest>()
  private streaming = new Map<string, StreamingResponse>()
  private ready    = false
  private connectNonce: string | null = null
  private connectSent  = false

  // Reconnect state
  private reconnectAttempt = 0
  private intentionalClose  = false
  private reconnectTimer: NodeJS.Timeout | null = null

  // Keepalive
  private pingTimer: NodeJS.Timeout | null = null

  constructor(opts: GatewayClientOptions) {
    super()
    this.opts = {
      url: opts.url ?? 'ws://127.0.0.1:18789',
      token: opts.token,
      clientId: opts.clientId ?? 'claos-dashboard',
      gatewayType: opts.gatewayType ?? 'clawdbot',
      clientVersion: opts.clientVersion ?? '1.0.0',
      onMessage: opts.onMessage,
      onError: opts.onError,
      onClose: opts.onClose,
      onReady: opts.onReady,
    }
  }

  connect(): Promise<void> {
    this.intentionalClose = false
    this.reconnectAttempt = 0

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.opts.url, {
          maxPayload: 25 * 1024 * 1024,
          headers: { Origin: 'http://127.0.0.1' },
        })
        this.ws = ws

        const timeout = setTimeout(() => {
          reject(new GatewayError('gateway.timeout'))
          // Don't call this.close() — that sets intentionalClose=true which kills reconnection.
          // Just close the underlying socket; the 'close' event will trigger scheduleReconnect().
          try { ws.terminate() } catch { ws.close() }
        }, CONNECT_TIMEOUT_MS)

        ws.on('open', () => {
          // Wait for connect.challenge
        })

        ws.on('message', (data) => {
          this.handleMessage(data.toString(), ws, () => {
            clearTimeout(timeout)
            resolve()
          })
        })

        ws.on('pong', () => {
          // Gateway is alive — nothing to do
        })

        ws.on('error', (err) => {
          clearTimeout(timeout)
          const gwErr = toGatewayError(err, 'gateway.unreachable')
          this.opts.onError?.(gwErr)
          reject(gwErr)
        })

        ws.on('close', (code, reason) => {
          this.stopPing()
          this.ready = false
          this.flushPendingErrors(new Error(`Connection closed: ${code}`))
          this.opts.onClose?.(code, reason.toString())

          if (!this.intentionalClose) {
            this.scheduleReconnect()
          }
        })

      } catch (err) {
        reject(err)
      }
    })
  }

  // ── Keepalive ──────────────────────────────────────────────────────────────

  private startPing() {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try { this.ws.ping() } catch { /* ignore */ }
      }
    }, KEEPALIVE_INTERVAL_MS)
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  // ── Reconnect ──────────────────────────────────────────────────────────────

  private scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30000)
    const jitter = Math.random() * 1000
    log.info('Reconnecting', { delaySeconds: Math.round((delay + jitter) / 1000), attempt: this.reconnectAttempt + 1 })

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempt++
      try {
        this.connectSent = false // reset to allow a new handshake
        await this.connect()
        this.reconnectAttempt = 0
        log.info('Reconnected successfully')
      } catch (err) {
        log.error('Reconnect failed', { error: err instanceof Error ? err.message : String(err) })
        if (!this.intentionalClose) {
          this.scheduleReconnect()
        }
      }
    }, delay + jitter)
  }

  // ── Message handler ────────────────────────────────────────────────────────

  private handleMessage(raw: string, ws: WebSocket, onReady?: () => void) {
    try {
      const parsed = JSON.parse(raw)

      // Event frame
      if (parsed.type === 'event') {
        if (parsed.event === 'connect.challenge') {
          this.connectNonce = parsed.payload?.nonce ?? null
          this.sendConnect(ws)
          return
        }

        // Handle streaming agent responses
        if (parsed.event === 'agent') {
          const { runId, stream, data } = parsed.payload || {}
          const streamingReq = this.streaming.get(runId)

          if (streamingReq) {
            if (stream === 'assistant' && data?.delta) {
              streamingReq.text += data.delta
            }
            if (stream === 'lifecycle' && data?.phase === 'end') {
              clearTimeout(streamingReq.timeout)
              this.streaming.delete(runId)
              streamingReq.resolve({ response: streamingReq.text })
            }
          }
        }

        this.opts.onMessage?.(parsed.event, parsed.payload)
        this.emit(parsed.event, parsed.payload)
        return
      }

      // Response frame
      if (parsed.type === 'res') {
        // hello-ok → connection is fully established
        if (parsed.payload?.type === 'hello-ok') {
          this.ready = true
          this.startPing()       // ← start keepalive once ready
          this.opts.onReady?.()
          onReady?.()
        }

        const pending = this.pending.get(parsed.id)
        if (pending) {
          clearTimeout(pending.timeout)
          this.pending.delete(parsed.id)
          if (parsed.ok) {
            pending.resolve(parsed.payload)
          } else {
            pending.reject(new Error(parsed.error?.message ?? 'Unknown error'))
          }
        }
      }
    } catch (err) {
      log.error('Gateway message parse error', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  // ── Auth handshake ─────────────────────────────────────────────────────────

  private sendConnect(ws: WebSocket) {
    if (this.connectSent) return
    if (ws.readyState !== 1) return // OPEN = 1
    this.connectSent = true

    // openclaw gateways require 'openclaw-control-ui' client id + allowInsecureAuth on server
    // clawdbot gateways use 'cli' with no origin restrictions
    const isOpenClaw = this.opts.gatewayType === 'openclaw'
    const clientId   = isOpenClaw ? 'openclaw-control-ui' : 'cli'
    const clientMode = isOpenClaw ? 'backend' : 'cli'

    const frame = {
      type: 'req',
      id: randomUUID(),
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: clientId,
          displayName: 'Claos Dashboard',
          version: this.opts.clientVersion,
          platform: 'linux',
          mode: clientMode,
        },
        ...(this.opts.token ? { auth: { token: this.opts.token } } : {}),
        role: 'operator',
        // Explicitly list all operator scopes — some gateways (e.g. OpenClaw) do not
        // treat 'operator.admin' as a superset and require explicit scope enumeration.
        scopes: ['operator.read', 'operator.write', 'operator.admin'],
      },
    }

    ws.send(JSON.stringify(frame))
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async request<T = unknown>(method: string, params?: unknown, timeoutMs = 30000): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new GatewayError('gateway.disconnected')
    }

    if (!this.ready && method !== 'connect') {
      throw new GatewayError('gateway.not_ready')
    }

    const id    = randomUUID()
    const frame = { type: 'req', id, method, params }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new GatewayError('gateway.request_timeout', method))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      })

      this.ws!.send(JSON.stringify(frame))
    })
  }

  /**
   * Send chat message and wait for streaming response
   */
  async sendChat(
    params: { sessionKey: string; message: string; idempotencyKey: string },
    timeoutMs = 60000,
  ): Promise<{ response: string }> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new GatewayError('gateway.disconnected')
    }

    if (!this.ready) {
      throw new GatewayError('gateway.not_ready')
    }

    const id    = randomUUID()
    const frame = { type: 'req', id, method: 'chat.send', params }

    return new Promise((resolve, reject) => {
      let cleaned = false

      const cleanup = () => {
        if (cleaned) return
        cleaned = true
        clearTimeout(timeout)
        this.off('agent', agentHandler)
      }

      const timeout = setTimeout(() => {
        // Partial response? Return it rather than failing.
        for (const [runId, stream] of this.streaming) {
          if (stream.text) {
            this.streaming.delete(runId)
            cleanup()
            resolve({ response: stream.text })
            return
          }
        }
        cleanup()
        reject(new Error('Chat response timeout'))
      }, timeoutMs)

      const handleRunId = (runId: string) => {
        this.streaming.set(runId, {
          text: '',
          resolve: (val) => { cleanup(); resolve(val) },
          reject:  (err) => { cleanup(); reject(err) },
          timeout,
        })
      }

      const agentHandler = (payload: { runId?: string; stream?: string }) => {
        if (payload.runId && !this.streaming.has(payload.runId)) {
          handleRunId(payload.runId)
        }
      }

      this.on('agent', agentHandler)
      this.ws!.send(JSON.stringify(frame))
    })
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private flushPendingErrors(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timeout)
      p.reject(err)
    }
    this.pending.clear()

    for (const [, s] of this.streaming) {
      clearTimeout(s.timeout)
      s.reject(err)
    }
    this.streaming.clear()
  }

  close() {
    this.intentionalClose = true
    this.stopPing()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ready = false
    this.flushPendingErrors(new Error('Client closed'))
    this.ws?.close()
    this.ws = null
  }

  isReady(): boolean {
    return this.ready && this.ws?.readyState === WebSocket.OPEN
  }
}
