'use strict'

/**
 * Gateway WS Proxy
 *
 * Maintains a pool of upstream WebSocket connections to gateways (one per
 * gatewayId).  Accepts authenticated browser WS connections and relays frames
 * bidirectionally between the browser and the upstream gateway.
 *
 * Auth handshake mirrors GatewayWsClient (lib/gateway/ws-client.ts):
 *   connect.challenge → connect → hello-ok → ready
 *
 * Pool behaviour:
 *   - One upstream connection per gatewayId, shared across browser clients.
 *   - Events are broadcast to all connected browser clients for that gateway.
 *   - Upstream reconnects automatically while at least one browser client is
 *     still connected.
 *   - When the last browser client disconnects the upstream is torn down.
 */

const WebSocket = require('ws')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

// ── Session validation ────────────────────────────────────────────────────────

// NOTE: This value must stay in sync with SESSION_COOKIE in lib/constants.ts.
// (This is a plain JS file that cannot import TypeScript modules directly.)
const SESSION_COOKIE = 'claos_session'
const DATA_DIR = process.env.DATA_DIR || path.join(process.env.HOME || '/tmp', '.claos')
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json')

function loadSessions() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return {}
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function validateSessionToken(token) {
  if (!token || token.length !== 64) return false
  const sessions = loadSessions()
  const session = sessions[token]
  if (!session) return false
  if (session.expiresAt < Date.now()) return false
  return true
}

function parseCookies(cookieHeader) {
  const cookies = {}
  if (!cookieHeader) return cookies
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue
    const k = part.slice(0, eqIdx).trim()
    const v = part.slice(eqIdx + 1).trim()
    try { cookies[k] = decodeURIComponent(v) } catch { cookies[k] = v }
  }
  return cookies
}

function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie)
  return cookies[SESSION_COOKIE] || null
}

// ── Gateway config ────────────────────────────────────────────────────────────

function parseGatewayConfig(gatewayId) {
  const raw = process.env.GATEWAYS
  if (!raw) return null
  try {
    const gateways = JSON.parse(raw)
    return gateways.find(g => g.id === gatewayId) || null
  } catch {
    return null
  }
}

// ── Upstream connection pool ──────────────────────────────────────────────────

const KEEPALIVE_MS = 20_000
const CONNECT_TIMEOUT_MS = 10_000

// gatewayId → UpstreamConnection
const upstreamPool = new Map()

class UpstreamConnection {
  constructor(config) {
    this.config = config
    this.ws = null
    this.ready = false
    this.clients = new Set()   // browser WebSocket instances
    this.pingTimer = null
    this.connectSent = false
    this.reconnectTimer = null
    this.reconnectAttempt = 0
    this.closed = false
  }

  // Returns a Promise that resolves when hello-ok is received.
  connect() {
    return new Promise((resolve, reject) => {
      const { id, url, token, type } = this.config
      const isOpenClaw = type === 'openclaw'
      let ws

      try {
        ws = new WebSocket(url, {
          maxPayload: 25 * 1024 * 1024,
          headers: { Origin: 'http://127.0.0.1' },
        })
      } catch (err) {
        return reject(err)
      }

      this.ws = ws
      this.connectSent = false

      const timeout = setTimeout(() => {
        reject(new Error(`Gateway ${id} connect timeout`))
        try { ws.terminate() } catch { try { ws.close() } catch { /* ignore */ } }
      }, CONNECT_TIMEOUT_MS)

      ws.on('open', () => {
        // Auth handshake starts when connect.challenge arrives
      })

      ws.on('message', (data) => {
        this._handleMessage(data.toString(), ws, () => {
          clearTimeout(timeout)
          resolve()
        })
      })

      ws.on('pong', () => { /* gateway alive */ })

      ws.on('error', (err) => {
        clearTimeout(timeout)
        console.error(`[ws-proxy] Gateway ${id} error:`, err.message)
        reject(err)
      })

      ws.on('close', (code) => {
        clearTimeout(timeout)
        this._stopPing()
        this.ready = false
        this.connectSent = false
        console.log(`[ws-proxy] Gateway ${id} closed (${code})`)
        this._notifyClients({ type: 'gateway_disconnected', gatewayId: id })
        if (!this.closed) this._scheduleReconnect()
      })
    })
  }

  _handleMessage(raw, ws, onReady) {
    let frame
    try { frame = JSON.parse(raw) } catch { return }

    // Gateway auth handshake
    if (frame.type === 'event' && frame.event === 'connect.challenge') {
      this._sendConnect(ws)
      return
    }

    if (frame.type === 'res' && frame.payload?.type === 'hello-ok') {
      this.ready = true
      this._startPing()
      onReady?.()
      this._notifyClients({ type: 'gateway_connected', gatewayId: this.config.id })
      return
    }

    // Relay all other frames to browser clients
    this._broadcast(raw)
  }

  _sendConnect(ws) {
    if (this.connectSent) return
    if (ws.readyState !== WebSocket.OPEN) return
    this.connectSent = true

    const { token, type } = this.config
    const isOpenClaw = type === 'openclaw'

    const frame = {
      type: 'req',
      id: crypto.randomUUID(),
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: isOpenClaw ? 'openclaw-control-ui' : 'cli',
          displayName: 'Claos Dashboard',
          version: '1.0.0',
          platform: 'linux',
          mode: isOpenClaw ? 'backend' : 'cli',
        },
        ...(token ? { auth: { token } } : {}),
        role: 'operator',
        scopes: ['operator.read', 'operator.write', 'operator.admin'],
      },
    }
    ws.send(JSON.stringify(frame))
  }

  _startPing() {
    this._stopPing()
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try { this.ws.ping() } catch { /* ignore */ }
      }
    }, KEEPALIVE_MS)
  }

  _stopPing() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
  }

  _scheduleReconnect() {
    if (this.closed) return
    if (this.clients.size === 0) {
      // No one waiting — remove from pool and clean up
      upstreamPool.delete(this.config.id)
      this.closed = true
      return
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30_000)
    console.log(`[ws-proxy] Reconnecting to ${this.config.id} in ${delay}ms (attempt ${this.reconnectAttempt + 1})`)
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempt++
      try {
        await this.connect()
        this.reconnectAttempt = 0
        console.log(`[ws-proxy] Reconnected to ${this.config.id}`)
      } catch (err) {
        console.error(`[ws-proxy] Reconnect ${this.config.id} failed:`, err.message)
        if (!this.closed) this._scheduleReconnect()
      }
    }, delay)
  }

  // Send a raw frame string to all connected browser clients.
  _broadcast(raw) {
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(raw) } catch { /* ignore */ }
      }
    }
  }

  // Wrap and broadcast an internal bridge event to browser clients.
  _notifyClients(data) {
    this._broadcast(JSON.stringify({ type: 'event', event: '__bridge__', payload: data }))
  }

  addClient(ws) {
    this.clients.add(ws)
  }

  removeClient(ws) {
    this.clients.delete(ws)
    // If no clients remain and we're in a broken state, tear down.
    if (this.clients.size === 0 && !this.ready) {
      this.destroy()
      upstreamPool.delete(this.config.id)
    }
  }

  // Send a frame from a browser client upstream (throws if not ready).
  send(data) {
    if (!this.ready || this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('Gateway not ready')
    }
    this.ws.send(data)
  }

  destroy() {
    this.closed = true
    this._stopPing()
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    try { this.ws?.close() } catch { /* ignore */ }
    this.ws = null
  }
}

// Get (or create) an upstream connection for the given gatewayId.
async function getUpstreamConnection(gatewayId) {
  const existing = upstreamPool.get(gatewayId)
  if (existing && !existing.closed && existing.ready) return existing

  // Close stale/broken entry
  if (existing) {
    existing.destroy()
    upstreamPool.delete(gatewayId)
  }

  const config = parseGatewayConfig(gatewayId)
  if (!config) throw new Error(`Unknown gateway: ${gatewayId}`)

  const upstream = new UpstreamConnection(config)
  upstreamPool.set(gatewayId, upstream)

  try {
    await upstream.connect()
  } catch (err) {
    upstream.destroy()
    upstreamPool.delete(gatewayId)
    throw err
  }

  return upstream
}

// ── Main handler: called per browser WS connection ───────────────────────────

async function handleBrowserWs(ws, req) {
  let url
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  } catch {
    ws.close(4000, 'Bad request URL')
    return
  }

  const gatewayId = url.searchParams.get('gatewayId')
  if (!gatewayId) {
    ws.close(4000, 'Missing gatewayId')
    return
  }

  // Authenticate the browser session
  const sessionToken = getSessionToken(req)
  if (!sessionToken || !validateSessionToken(sessionToken)) {
    console.warn(`[ws-proxy] Rejected unauthenticated WS for gateway ${gatewayId}`)
    ws.close(4001, 'Unauthorized')
    return
  }

  let upstream
  try {
    upstream = await getUpstreamConnection(gatewayId)
  } catch (err) {
    console.error(`[ws-proxy] Failed upstream for ${gatewayId}:`, err.message)
    ws.close(4002, 'Gateway unavailable')
    return
  }

  upstream.addClient(ws)
  const clientCount = upstream.clients.size
  console.log(`[ws-proxy] Browser connected → gateway ${gatewayId} (${clientCount} client(s))`)

  // Immediately inform browser of current gateway status
  ws.send(JSON.stringify({
    type: 'event',
    event: '__bridge__',
    payload: {
      type: upstream.ready ? 'gateway_connected' : 'gateway_connecting',
      gatewayId,
    },
  }))

  // Browser → upstream relay
  ws.on('message', (data) => {
    try {
      upstream.send(data.toString())
    } catch (err) {
      console.warn(`[ws-proxy] browser→gateway relay failed (${gatewayId}):`, err.message)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'event',
          event: '__bridge__',
          payload: { type: 'error', message: err.message },
        }))
      }
    }
  })

  ws.on('close', () => {
    upstream.removeClient(ws)
    console.log(`[ws-proxy] Browser disconnected from gateway ${gatewayId} (${upstream.clients.size} client(s) remaining)`)
  })

  ws.on('error', (err) => {
    console.error('[ws-proxy] Browser WS error:', err.message)
    upstream.removeClient(ws)
  })
}

module.exports = { handleBrowserWs }
