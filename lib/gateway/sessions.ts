// Session management for Clawdbot gateways
// Simplified: request-response without streaming

import { getGatewayClient, dropGatewayClient } from './chat-client'
import { getAllGateways } from './registry'
import type { GatewayConfig } from './types'
import { randomBytes } from 'crypto'
import { log } from '../logger'

async function getGateways(): Promise<GatewayConfig[]> {
  return getAllGateways()
}

export interface Session {
  sessionKey: string
  /** Full raw gateway key including agent prefix e.g. "agent:main:xxx" or "agent:telegram:xxx" */
  rawKey?: string
  key?: string
  kind?: string
  channel?: string
  lastActive?: string
  label?: string
  displayName?: string
  gateway: string
  gatewayName: string
  customName?: string
}

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
}

function generateIdempotencyKey(): string {
  return `web-${Date.now()}-${randomBytes(8).toString('hex')}`
}

export async function listSessions(gatewayId: string): Promise<Session[]> {
  const gateways = await getGateways()
  const gateway = gateways.find((g) => g.id === gatewayId)

  if (!gateway) throw new Error(`Gateway ${gatewayId} not found`)

  try {
    const client = await getGatewayClient(gatewayId)
    const response = await client.request<{
      sessions?: Array<{
        key: string
        kind?: string
        channel?: string
        lastActive?: string
        displayName?: string
      }>
    }>('sessions.list', { limit: 100 })

    return (response.sessions || []).map((s) => ({
      // Gateway stores sessions as "agent:<type>:<key>" internally.
      // Strip the prefix for display/matching, but preserve rawKey for proper kill.
      sessionKey: s.key.replace(/^agent:[^:]+:/, ''),
      rawKey: s.key,
      key: s.key.replace(/^agent:[^:]+:/, ''),
      kind: s.kind,
      channel: s.channel,
      lastActive: s.lastActive
        ? typeof (s.lastActive as unknown) === 'number'
          ? new Date(s.lastActive as unknown as number).toISOString()
          : String(s.lastActive)
        : undefined,
      displayName: s.displayName,
      label: s.displayName,
      gateway: gatewayId,
      gatewayName: gateway.name,
    }))
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''

    // If the gateway rejected with a scope error, it's an OpenClaw gateway
    // connected in Clawdbot mode. Drop the client so the next call reconnects
    // with the correct protocol (auto-detection in getGatewayClient handles it).
    if (msg.includes('missing scope') || msg.includes('operator.read')) {
      log.warn('Scope error on sessions.list — forcing openclaw reconnect', { gatewayId })
      dropGatewayClient(gatewayId, 'openclaw')
      return [] // silently return empty — next request will reconnect correctly
    }

    log.warn('Failed to list sessions', {
      gatewayId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export async function listAllSessions(): Promise<Session[]> {
  const gateways = await getGateways()
  const results = await Promise.all(
    gateways.map(async (gw) => {
      try {
        return await listSessions(gw.id)
      } catch {
        return []
      }
    })
  )
  return results.flat().sort((a, b) => {
    const dateA = a.lastActive ? new Date(a.lastActive).getTime() : 0
    const dateB = b.lastActive ? new Date(b.lastActive).getTime() : 0
    return dateB - dateA
  })
}

export async function getSessionHistory(
  gatewayId: string,
  sessionKey: string,
  limit: number = 100
): Promise<Message[]> {
  const gateways = await getGateways()
  const gateway = gateways.find((g) => g.id === gatewayId)
  if (!gateway) throw new Error(`Gateway ${gatewayId} not found`)

  try {
    const client = await getGatewayClient(gatewayId)
    const response = await client.request<{ messages?: Message[] }>(
      'chat.history',
      {
        sessionKey,
        limit,
      },
      10000
    ) // 10s timeout — faster fail so UI can fall back to cache
    return (response.messages || []).map((m) => ({
      ...m,
      timestamp: m.timestamp
        ? typeof m.timestamp === 'number'
          ? new Date(m.timestamp).toISOString()
          : String(m.timestamp)
        : undefined,
    }))
  } catch (error) {
    log.warn('Failed to get session history', {
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

/**
 * Send message - uses streaming collection with 30s timeout
 */
export async function sendToSession(
  gatewayId: string,
  sessionKey: string,
  message: string,
  _history: Array<{ role: string; content: string }> = []
): Promise<{ success: boolean; response?: string; error?: string }> {
  const gateways = await getGateways()
  const gateway = gateways.find((g) => g.id === gatewayId)

  if (!gateway) {
    return { success: false, error: `Gateway ${gatewayId} not found` }
  }

  try {
    const client = await getGatewayClient(gatewayId)

    // Use shorter timeout (30s) to avoid 504
    const result = await client.sendChat(
      {
        sessionKey: sessionKey || 'claos-web',
        message,
        idempotencyKey: generateIdempotencyKey(),
      },
      60000
    )

    return { success: true, response: result.response || '(message sent)' }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    // If timeout, return partial success
    if (errorMessage.includes('timeout')) {
      return { success: true, response: '(message sent - response pending)' }
    }
    return { success: false, error: errorMessage }
  }
}

export async function spawnSession(
  gatewayId: string,
  initialMessage?: string,
  sessionKey?: string
): Promise<{ success: boolean; sessionKey?: string; error?: string }> {
  const gateways = await getGateways()
  const gateway = gateways.find((g) => g.id === gatewayId)
  if (!gateway) return { success: false, error: `Gateway ${gatewayId} not found` }

  try {
    const key = sessionKey || `web-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    if (initialMessage) {
      const client = await getGatewayClient(gatewayId)
      await client.sendChat(
        {
          sessionKey: key,
          message: initialMessage,
          idempotencyKey: generateIdempotencyKey(),
        },
        60000
      )
    }
    return { success: true, sessionKey: key }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: errorMessage }
  }
}

export async function sendMessage(
  gatewayId: string,
  message: string,
  history: Message[] = [],
  sessionKey = 'claos-web'
): Promise<{ reply: string; messages: Message[] }> {
  const gateways = await getGateways()
  const gateway = gateways.find((g) => g.id === gatewayId)
  if (!gateway) throw new Error(`Gateway ${gatewayId} not found`)

  const client = await getGatewayClient(gatewayId)
  const result = await client.sendChat(
    {
      sessionKey,
      message,
      idempotencyKey: generateIdempotencyKey(),
    },
    60000
  )

  const reply = result.response || '(no response)'
  const newHistory: Message[] = [
    ...history,
    { role: 'user', content: message, timestamp: new Date().toISOString() },
    { role: 'assistant', content: reply, timestamp: new Date().toISOString() },
  ]
  return { reply, messages: newHistory }
}
