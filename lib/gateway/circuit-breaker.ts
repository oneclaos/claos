// Circuit breaker for gateway resilience

import { CIRCUIT_BREAKER_THRESHOLD, CIRCUIT_BREAKER_RESET_MS } from './types'
import type { CircuitBreakerState } from './types'
import { log } from '../logger'

const circuitBreakers = new Map<string, CircuitBreakerState>()

export function getCircuitBreaker(gatewayId: string): CircuitBreakerState {
  if (!circuitBreakers.has(gatewayId)) {
    circuitBreakers.set(gatewayId, { failures: 0, lastFailure: 0, isOpen: false })
  }
  return circuitBreakers.get(gatewayId)!
}

export function recordFailure(gatewayId: string): void {
  const state = getCircuitBreaker(gatewayId)
  state.failures++
  state.lastFailure = Date.now()
  
  if (state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    state.isOpen = true
    log.warn('Circuit breaker opened', { gatewayId, failures: state.failures })
  }
}

export function recordSuccess(gatewayId: string): void {
  const state = getCircuitBreaker(gatewayId)
  state.failures = 0
  state.isOpen = false
}

export function isCircuitOpen(gatewayId: string): boolean {
  const state = getCircuitBreaker(gatewayId)
  
  if (!state.isOpen) return false
  
  // Auto-reset after timeout
  if (Date.now() - state.lastFailure > CIRCUIT_BREAKER_RESET_MS) {
    state.isOpen = false
    state.failures = 0
    return false
  }
  
  return true
}

/**
 * Execute function with retry logic and circuit breaker
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  gatewayId: string,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error | null = null
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn()
      recordSuccess(gatewayId)
      return result
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      
      // Don't retry on HTTP client errors (4xx) — use exact status code match
      const statusMatch = lastError.message.match(/\b(4\d{2})\b/)
      const is4xx = statusMatch ? parseInt(statusMatch[1], 10) >= 400 && parseInt(statusMatch[1], 10) < 500 : false
      
      if (is4xx) {
        recordFailure(gatewayId) // count 4xx as a failure too
        throw lastError
      }
      
      // Record failure on each transient error attempt
      recordFailure(gatewayId)
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
        const jitter = Math.random() * 500
        await new Promise(resolve => setTimeout(resolve, delay + jitter))
      }
    }
  }
  
  throw lastError
}
