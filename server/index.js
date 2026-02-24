'use strict'

/**
 * Custom Next.js server entry point with WebSocket bridge
 *
 * Strategy: intercept http.createServer() before the standalone server.js
 * runs so we can grab the HTTP server instance and prepend our own
 * 'upgrade' listener for /api/gateway/ws.  All other HTTP traffic and any
 * other WebSocket upgrades are handled normally by Next.js.
 *
 * The existing SSE route (app/api/chat/stream/route.ts) is untouched.
 */

const path = require('path')
const fs = require('fs')
const http = require('http')

const PROJECT_ROOT = '/home/clawd/prod/claos'

// ── Load .env.local ───────────────────────────────────────────────────────────

const envFile = path.join(PROJECT_ROOT, '.env.local')
try {
  const lines = fs.readFileSync(envFile, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    let val = trimmed.slice(idx + 1).trim()
    if (
      (val.startsWith("'") && val.endsWith("'")) ||
      (val.startsWith('"') && val.endsWith('"'))
    ) {
      val = val.slice(1, -1)
    }
    // Don't override variables already set in the environment
    if (process.env[key] === undefined) process.env[key] = val
  }
} catch (err) {
  console.error('[Claos] Failed to load .env.local:', err.message)
}

process.env.PORT = process.env.PORT || '3006'

// ── Global error handlers ─────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  console.error('[Claos] Unhandled Rejection:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[Claos] Uncaught Exception:', err)
  const msg = (err?.message ?? '').toLowerCase()
  const isFatal =
    !msg.includes('bodystreambuffer') &&
    !msg.includes('aborted') &&
    !msg.includes('connection reset') &&
    !msg.includes('missing scope')
  if (isFatal) {
    console.error('[Claos] Fatal — exiting.')
    process.exit(1)
  }
})

// ── Graceful SIGTERM shutdown ─────────────────────────────────────────────────

process.on('SIGTERM', () => {
  console.log('[Claos] SIGTERM received — shutting down gracefully...')

  // Force-exit after 5 s to avoid hanging indefinitely
  const forceExitTimer = setTimeout(() => {
    console.error('[Claos] Graceful shutdown timed out — forcing exit.')
    process.exit(1)
  }, 5_000)
  forceExitTimer.unref()

  // Close the WebSocket server (stops accepting new WS connections and
  // closes existing ones with code 1001 Going Away).
  wss.close(() => {
    console.log('[Claos] WebSocket server closed.')
  })

  // Terminate all open WebSocket connections
  for (const client of wss.clients) {
    if (client.readyState <= 1 /* CONNECTING | OPEN */) {
      client.close(1001, 'Server shutting down')
    }
  }

  // Give in-flight requests a moment to finish, then exit cleanly.
  // (The standalone Next.js server doesn't expose a close() handle here,
  //  so we rely on the 5 s safety timer above for a worst-case bound.)
  setTimeout(() => {
    console.log('[Claos] Shutdown complete.')
    clearTimeout(forceExitTimer)
    process.exit(0)
  }, 1_000)
})

// ── WebSocket server setup ────────────────────────────────────────────────────

const { WebSocketServer } = require('ws')
const { handleBrowserWs } = require('./gateway-ws-proxy')

const wss = new WebSocketServer({ noServer: true })

wss.on('connection', (ws, req) => {
  handleBrowserWs(ws, req).catch((err) => {
    console.error('[Claos] WS handler error:', err)
    if (ws.readyState <= 1 /* CONNECTING | OPEN */) {
      ws.close(1011, 'Internal server error')
    }
  })
})

/**
 * Attach our upgrade handler to the given HTTP server.
 * Uses prependListener so our handler runs before Next.js's own upgrade handler.
 * For /api/gateway/ws we consume the socket; for all other paths we leave
 * it untouched for Next.js to handle.
 */
function attachWsHandler(server) {
  server.prependListener('upgrade', (req, socket, head) => {
    let pathname
    try {
      pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname
    } catch {
      return // malformed URL — let Next.js deal with it
    }

    if (pathname !== '/api/gateway/ws') return // pass-through to Next.js

    // Hand the socket to our WS server — this detaches it from the HTTP server.
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  console.log('[Claos] ✓ WebSocket bridge attached (/api/gateway/ws)')
}

// ── Intercept http.createServer to capture the server instance ────────────────
//
// The standalone server.js calls http.createServer() synchronously during
// startServer().  We replace createServer with a wrapper, capture the
// returned server, attach our WS handler, then restore the original function.

const _origCreateServer = http.createServer.bind(http)
let _interceptDone = false

http.createServer = function (...args) {
  const server = _origCreateServer(...args)

  if (!_interceptDone) {
    _interceptDone = true
    // Attach WS handler before Next.js adds its own upgrade listener
    attachWsHandler(server)
    // Restore the original createServer for any subsequent calls
    http.createServer = _origCreateServer
  }

  return server
}

// ── Boot the standalone Next.js server ───────────────────────────────────────

require('/home/clawd/prod/claos/.next/standalone/server.js')
