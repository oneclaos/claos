// HTTP client for Clawdbot gateway (fallback when WS not available)

import type { GatewayConfig } from './types'
import { isCircuitOpen, withRetry } from './circuit-breaker'
import { validateGatewayUrl, sanitizeUrlForLogging } from '../ssrf-protection'
import { logger } from '../logger'

/**
 * Make HTTP request to gateway
 */
export async function callGateway(
  gateway: GatewayConfig,
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
  timeoutMs: number = 15000
): Promise<unknown> {
  // SSRF protection
  const fullUrl = `${gateway.url}${endpoint}`
  const validation = validateGatewayUrl(fullUrl)
  if (!validation.allowed) {
    logger.error('SSRF: Gateway URL blocked', undefined, {
      gatewayId: gateway.id,
      url: sanitizeUrlForLogging(fullUrl),
      reason: validation.reason,
    })
    throw new Error(`Gateway URL not allowed: ${validation.reason}`)
  }

  if (isCircuitOpen(gateway.id)) {
    logger.warn('Gateway circuit is open', {
      gatewayId: gateway.id,
    })
    throw new Error(`Gateway ${gateway.id} is unavailable (circuit open)`)
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (gateway.token) {
    headers['Authorization'] = `Bearer ${gateway.token}`
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  logger.debug('Gateway HTTP request', {
    gatewayId: gateway.id,
    method,
    endpoint,
    timeoutMs,
  })

  try {
    const response = await fetch(fullUrl, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error')
      logger.warn('Gateway HTTP error response', {
        gatewayId: gateway.id,
        status: response.status,
        error: text.slice(0, 200),
      })
      throw new Error(`Gateway ${gateway.id} error: ${response.status} - ${text.slice(0, 200)}`)
    }

    logger.debug('Gateway HTTP request succeeded', {
      gatewayId: gateway.id,
      status: response.status,
    })

    return response.json()
  } catch (err) {
    clearTimeout(timeoutId)

    if (err instanceof Error && err.name === 'AbortError') {
      logger.error('Gateway HTTP timeout', undefined, {
        gatewayId: gateway.id,
        timeoutMs,
      })
      throw new Error(`Gateway ${gateway.id} timeout after ${timeoutMs}ms`)
    }

    logger.error('Gateway HTTP request failed', err instanceof Error ? err : undefined, {
      gatewayId: gateway.id,
    })
    throw err
  }
}

/**
 * Check gateway health via HTTP
 */
export async function checkGatewayHealth(gateway: GatewayConfig): Promise<boolean> {
  if (isCircuitOpen(gateway.id)) return false

  // SSRF validation
  const validation = validateGatewayUrl(gateway.url)
  if (!validation.allowed) {
    logger.warn('SSRF: Gateway health check blocked', {
      gatewayId: gateway.id,
      reason: validation.reason,
    })
    return false
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    const res = await fetch(`${gateway.url}/`, {
      signal: controller.signal,
    })

    clearTimeout(timeout)
    return res.ok
  } catch (err) {
    logger.debug('Gateway health check failed', {
      gatewayId: gateway.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

/**
 * Send message via HTTP (OpenAI-compatible endpoint)
 */
export async function sendMessageHttp(
  gateway: GatewayConfig,
  message: string,
  history: Array<{ role: string; content: string }> = []
): Promise<{ reply: string }> {
  const messages = [
    ...history,
    { role: 'user', content: message }
  ]

  const response = await withRetry(
    () => callGateway(gateway, '/v1/chat/completions', 'POST', {
      messages,
      stream: false
    }, 60000),
    gateway.id
  ) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const reply = response.choices?.[0]?.message?.content || '(no response)'
  return { reply }
}
