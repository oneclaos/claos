// Single source of truth for all gateways (static + discovered + custom config)
// Used by ALL endpoints: /api/gateways, spawn route, sessions, send

import { parseGatewaysConfig } from './chat-client'
import { discoverGateways } from './discovery'
import { getCustomGateways } from './config'
import type { GatewayConfig } from './types'
import { log } from '../logger'

let cache: GatewayConfig[] = []
let cacheTime = 0
let refreshing = false
const CACHE_TTL = 90_000 // 90s — background refresh keeps it warm

/**
 * Extract port from a gateway URL (handles ws://, wss://, http://, https://)
 */
function extractPort(url: string): number | null {
  try {
    // Normalize ws:// to http:// for URL parsing
    const normalized = url.replace(/^wss?:\/\//, 'http://')
    const parsed = new URL(normalized)
    if (parsed.port) {
      return parseInt(parsed.port, 10)
    }
    // Default ports
    if (url.startsWith('wss://') || url.startsWith('https://')) return 443
    if (url.startsWith('ws://') || url.startsWith('http://')) return 80
    return null
  } catch {
    // Try regex fallback for malformed URLs
    const match = url.match(/:(\d+)/)
    return match ? parseInt(match[1], 10) : null
  }
}

/**
 * Check if two gateways are duplicates (same port = same gateway)
 */
function isDuplicate(existing: GatewayConfig[], candidate: GatewayConfig): boolean {
  const candidatePort = candidate.port ?? extractPort(candidate.url)

  for (const g of existing) {
    // Same ID = duplicate
    if (g.id === candidate.id) return true

    // Same port = duplicate (this is the key check)
    const existingPort = g.port ?? extractPort(g.url)
    if (candidatePort && existingPort && candidatePort === existingPort) {
      return true
    }

    // Same URL (exact match)
    if (g.url === candidate.url) return true
  }

  return false
}

async function refresh(): Promise<void> {
  if (refreshing) return
  refreshing = true
  try {
    // Static gateways from GATEWAYS env have priority
    const staticGateways = parseGatewaysConfig() as unknown as GatewayConfig[]
    const discovered = await discoverGateways()
    const customGateways = getCustomGateways()

    // Start with static gateways (highest priority)
    const merged: GatewayConfig[] = [...staticGateways]

    // Add discovered gateways only if they don't duplicate a static one
    for (const d of discovered) {
      if (!isDuplicate(merged, d)) {
        merged.push(d)
      } else {
        log.debug('Skipping duplicate discovered gateway', {
          id: d.id,
          port: d.port ?? extractPort(d.url),
        })
      }
    }

    // Add custom gateways only if they don't duplicate
    for (const c of customGateways) {
      if (!isDuplicate(merged, c)) {
        merged.push(c)
      }
    }

    cache = merged
    cacheTime = Date.now()

    log.info('Gateway registry refreshed', {
      static: staticGateways.length,
      discovered: discovered.length,
      custom: customGateways.length,
      total: merged.length,
    })
  } catch (err) {
    log.error('Gateway registry refresh failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    refreshing = false
  }
}

export async function getAllGateways(forceRefresh = false): Promise<GatewayConfig[]> {
  const stale = Date.now() - cacheTime > CACHE_TTL || cache.length === 0

  if (stale && cache.length === 0) {
    // First call: must wait (cold start)
    await refresh()
  } else if (stale || forceRefresh) {
    // Stale: return cached immediately, refresh in background
    refresh().catch((err) =>
      log.error('Gateway registry refresh failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    )
  }

  // Always return static gateways at minimum
  if (cache.length === 0) {
    return parseGatewaysConfig() as unknown as GatewayConfig[]
  }

  return cache
}

export function clearGatewayCache(): void {
  cache = []
  cacheTime = 0
}

/**
 * Get cached gateways without triggering a refresh
 * Returns empty array if cache is empty
 */
export function getCachedGateways(): GatewayConfig[] {
  return cache
}
