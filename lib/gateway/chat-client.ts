/**
 * Chat client using Gateway WebSocket
 *
 * Sends messages to agent sessions and streams responses back.
 */

import { GatewayWsClient } from './ws-client'
import { GatewayError, toGatewayError } from './errors'
import type { GatewayType } from './types'
import { logger } from '../logger'
export { GatewayError } from './errors'

// Cache of detected gateway types (persists across reconnects within a process lifecycle)
const detectedTypes = new Map<string, GatewayType>()

export interface GatewayConfig {
  id: string
  name: string
  url: string
  token: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatSendOptions {
  sessionKey?: string
  agentId?: string
  message: string
  onChunk?: (chunk: string) => void
}

// Connection pool for multiple gateways
const clients = new Map<string, GatewayWsClient>()

export function parseGatewaysConfig(): GatewayConfig[] {
  const raw = process.env.GATEWAYS
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    logger.error('Failed to parse GATEWAYS config')
    return []
  }
}

export async function getGatewayClient(gatewayId: string): Promise<GatewayWsClient> {
  // Check existing connection
  const existing = clients.get(gatewayId)
  if (existing?.isReady()) {
    return existing
  }

  // Find gateway config via unified registry (static + discovered)
  const { getAllGateways } = await import('./registry')
  const allGateways = await getAllGateways()
  let found = allGateways.find((g) => g.id === gatewayId)

  // Fallback: if gatewayId looks like a discovered ID (e.g. "agent-18750"),
  // try to find a static gateway by extracting the port and matching
  if (!found && gatewayId.startsWith('agent-')) {
    const portMatch = gatewayId.match(/agent-(\d+)/)
    if (portMatch) {
      const port = parseInt(portMatch[1], 10)
      found = allGateways.find((g) => {
        const gwPort =
          g.port ?? (g.url?.match(/:(\d+)/)?.[1] ? parseInt(g.url.match(/:(\d+)/)![1], 10) : null)
        return gwPort === port
      })
      if (found) {
        logger.info('Resolved discovered gateway ID to static config', {
          discoveredId: gatewayId,
          resolvedId: found.id,
          port,
        })
      }
    }
  }

  // Resolve type: static config > cached detection > 'auto'
  const resolvedType: GatewayType =
    detectedTypes.get(gatewayId) ??
    (found as GatewayConfig & { type?: GatewayType })?.type ??
    'auto'

  const config: (GatewayConfig & { type: GatewayType }) | undefined = found
    ? {
        id: found.id,
        name: found.name,
        url: found.url,
        token: found.token ?? '',
        type: resolvedType,
      }
    : undefined

  if (!config) {
    logger.error('Gateway not found', { gatewayId, availableIds: allGateways.map((g) => g.id) })
    throw new GatewayError('gateway.not_found', gatewayId)
  }

  if (!config.url) {
    throw new GatewayError('gateway.url_missing')
  }

  // Close and remove any stale (not-ready) entry to prevent zombie connections
  // (e.g. a client stuck in reconnect loop while we create a fresh one)
  if (existing) {
    existing.close()
    clients.delete(gatewayId)
  }

  // When type is 'auto', try clawdbot first (most common)
  const effectiveType: 'clawdbot' | 'openclaw' =
    resolvedType === 'auto' || resolvedType === 'clawdbot' ? 'clawdbot' : 'openclaw'

  // Create new connection with auto-reconnect; pool entry is re-added on reconnect
  const client = new GatewayWsClient({
    url: config.url,
    token: config.token,
    gatewayType: effectiveType,
    onError: (err) =>
      logger.error('Gateway WS error', {
        gatewayId,
        error: err instanceof Error ? err.message : String(err),
      }),
    onClose: () => {
      // Remove from pool — it will be re-added by onReady after reconnect
      clients.delete(gatewayId)
      logger.info('Gateway disconnected — will auto-reconnect', { gatewayId })
    },
    onReady: () => {
      // Re-register in pool after a reconnect
      if (!clients.has(gatewayId)) {
        clients.set(gatewayId, client)
        logger.info('Gateway reconnected and re-registered', { gatewayId })
      }
    },
  })

  try {
    await client.connect()
    // Connection succeeded — persist detected type if we were in auto mode
    if (resolvedType === 'auto') {
      detectedTypes.set(gatewayId, effectiveType)
      logger.info('Auto-detected gateway type', { gatewayId, type: effectiveType })
    }
  } catch (err) {
    client.close()
    clients.delete(gatewayId)

    const isScopeError =
      err instanceof Error &&
      (err.message.toLowerCase().includes('missing scope') ||
        err.message.toLowerCase().includes('invalid_request') ||
        err.message.toLowerCase().includes('operator.read'))

    // Auto-detection fallback: if clawdbot mode was rejected with a scope error,
    // retry once with openclaw mode (explicit scopes + openclaw-control-ui client)
    if ((resolvedType === 'auto' || resolvedType === 'clawdbot') && isScopeError) {
      logger.warn('Gateway rejected clawdbot mode — retrying as openclaw', { gatewayId })
      detectedTypes.set(gatewayId, 'openclaw')

      const fallback = new GatewayWsClient({
        url: config.url,
        token: config.token,
        gatewayType: 'openclaw',
        onError: (e) =>
          logger.error('Gateway WS error', {
            gatewayId,
            type: 'openclaw',
            error: e instanceof Error ? e.message : String(e),
          }),
        onClose: () => {
          clients.delete(gatewayId)
          logger.info('Gateway disconnected — will auto-reconnect', { gatewayId, type: 'openclaw' })
        },
        onReady: () => {
          if (!clients.has(gatewayId)) {
            clients.set(gatewayId, fallback)
            logger.info('Gateway (openclaw) reconnected and re-registered', { gatewayId })
          }
        },
      })

      try {
        await fallback.connect()
        logger.info('Gateway connected as openclaw', { gatewayId })
        clients.set(gatewayId, fallback)
        return fallback
      } catch (fallbackErr) {
        fallback.close()
        throw toGatewayError(fallbackErr, 'gateway.unreachable')
      }
    }

    throw toGatewayError(err, 'gateway.unreachable')
  }

  clients.set(gatewayId, client)
  return client
}

/**
 * Force-drop a gateway client from the pool and mark it with a specific type
 * for the next reconnection attempt. Used when a request-level error (e.g.
 * "missing scope") reveals that the client is connected in the wrong mode.
 */
export function dropGatewayClient(gatewayId: string, forceType?: GatewayType): void {
  const existing = clients.get(gatewayId)
  if (existing) {
    existing.close()
    clients.delete(gatewayId)
  }
  if (forceType) {
    detectedTypes.set(gatewayId, forceType)
  }
}

export async function sendChatMessage(gatewayId: string, opts: ChatSendOptions): Promise<string> {
  const client = await getGatewayClient(gatewayId)

  // Use chat.send method
  const result = await client.request<{ response?: string }>('chat.send', {
    sessionKey: opts.sessionKey ?? 'agent:main:main',
    agentId: opts.agentId ?? 'main',
    message: opts.message,
  })

  return result?.response ?? ''
}

export async function listSessions(gatewayId: string) {
  const client = await getGatewayClient(gatewayId)
  return client.request('sessions.list', { limit: 50 })
}

export async function getSessionHistory(gatewayId: string, sessionKey: string, limit = 50) {
  const client = await getGatewayClient(gatewayId)
  return client.request('chat.history', {
    sessionKey,
    limit,
  })
}

export async function getGatewayStatus(gatewayId: string) {
  const client = await getGatewayClient(gatewayId)
  return client.request('status')
}

/**
 * Close all gateway clients - for tests and graceful shutdown
 */
export function closeAllClients(): void {
  for (const [, client] of clients) {
    client.close()
  }
  clients.clear()
  detectedTypes.clear()
}

// Cleanup on process exit
process.on('beforeExit', () => {
  closeAllClients()
})
