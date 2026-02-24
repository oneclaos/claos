// Gateway auto-discovery module
// Detects both Clawdbot and OpenClaw gateways on localhost

import type { GatewayConfig, GatewayType } from './types'
import { DEFAULT_PORT_START, DEFAULT_PORT_END, DISCOVERY_CACHE_TTL } from './types'

// Discovery cache
let discoveredGateways: GatewayConfig[] = []
let discoveryTime = 0

// For testing - reset cache
export function resetDiscoveryCache(): void {
  discoveredGateways = []
  discoveryTime = 0
}

/**
 * Probe a single port for a Clawdbot OR OpenClaw gateway.
 * Returns null if nothing is running on that port.
 */
async function probeGateway(port: number): Promise<GatewayConfig | null> {
  const host = '127.0.0.1'
  const url = `http://${host}:${port}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 150)

    const res = await fetch(`${url}/`, {
      signal: controller.signal,
      headers: { Accept: 'text/html,application/json' },
    })
    clearTimeout(timeout)

    if (!res.ok) return null

    const contentType = res.headers.get('content-type') ?? ''

    // ── OpenClaw gateway: returns JSON on / ─────────────────────────────────
    if (contentType.includes('application/json')) {
      const json = await res.json().catch(() => null)
      if (json && typeof json === 'object' && 'version' in json) {
        // OpenClaw gateway responds with { version, name?, ... }
        const rawName: string = (json as Record<string, unknown>).name as string
          || (json as Record<string, unknown>).agent as string
          || `OpenClaw ${port}`
        const name = String(rawName).slice(0, 100)
        const id = name.toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9_-]/g, '')
          .slice(0, 50) || `openclaw-${port}`

        return { id, name, url, port, type: 'openclaw' }
      }
    }

    // ── Clawdbot gateway: returns HTML with embedded JS vars ────────────────
    if (contentType.includes('text/html')) {
      const html = await res.text()

      const isClawdbot = html.includes('__CLAWDBOT_') || html.includes('Clawdbot')
      const isOpenClaw = html.includes('__OPENCLAW_') || html.includes('OpenClaw')

      if (!isClawdbot && !isOpenClaw) return null

      const gatewayType: GatewayType = isOpenClaw ? 'openclaw' : 'clawdbot'

      // Parse agent name from embedded script (works for both variants)
      const namePatterns = [
        /__CLAWDBOT_ASSISTANT_NAME__\s*=\s*"([^"]+)"/,
        /__OPENCLAW_ASSISTANT_NAME__\s*=\s*"([^"]+)"/,
        /ASSISTANT_NAME['"]\s*:\s*['"]([^'"]+)['"]/,
      ]
      let rawName = `Agent ${port}`
      for (const pattern of namePatterns) {
        const m = html.match(pattern)
        if (m?.[1]) { rawName = m[1]; break }
      }

      const name = rawName.slice(0, 100)
      const id = rawName.toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 50) || `agent-${port}`

      return { id, name, url, port, type: gatewayType }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Discover all running Clawdbot/OpenClaw gateways on localhost.
 */
export async function discoverGateways(): Promise<GatewayConfig[]> {
  // Cache hit
  if (Date.now() - discoveryTime < DISCOVERY_CACHE_TTL && discoveredGateways.length > 0) {
    return discoveredGateways
  }

  const portStart = parseInt(process.env.GATEWAY_PORT_START || String(DEFAULT_PORT_START), 10)
  const portEnd   = parseInt(process.env.GATEWAY_PORT_END   || String(DEFAULT_PORT_END),   10)
  const ports     = Array.from({ length: Math.min(portEnd - portStart, 100) }, (_, i) => portStart + i)

  const results = await Promise.all(ports.map(p => probeGateway(p)))
  const found   = results.filter((g): g is GatewayConfig => g !== null)

  // Merge tokens from static config
  const staticGateways = getStaticGateways()
  const merged = found.map(discovered => {
    const match = staticGateways.find(
      s => s.url.includes(`:${discovered.port}`) ||
           s.name.toLowerCase() === discovered.name.toLowerCase()
    )
    return {
      ...discovered,
      token: match?.token ?? discovered.token,
      // Static config can override the detected type (user-explicit wins)
      type: match?.type ?? discovered.type,
    }
  })

  discoveredGateways = merged
  discoveryTime = Date.now()

  return merged
}

/**
 * Get statically configured gateways from environment
 */
function getStaticGateways(): GatewayConfig[] {
  const raw = process.env.GATEWAYS
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

/** Force refresh gateway discovery */
export async function refreshGateways(): Promise<GatewayConfig[]> {
  discoveryTime = 0
  return discoverGateways()
}

/** Get cached gateways or static config */
export function getGateways(): GatewayConfig[] {
  if (discoveredGateways.length > 0) return discoveredGateways
  return getStaticGateways()
}
