// Auto-pairing logic for Claos first-run setup
// Scans ports 18700-18799, reads agent config files, and auto-pairs when possible

import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { addCustomGateway, getCustomGateways } from './config'
import type { GatewayConfig } from './types'

interface AgentConfigFile {
  gateway?: {
    port?: number
    auth?: {
      token?: string
    }
  }
}

export interface DiscoveredAgent {
  id: string
  name: string
  port: number
  url: string
  paired: boolean
  type: 'clawdbot' | 'openclaw'
}

interface PortInfo {
  id: string
  name: string
}

interface ConfigEntry {
  token: string
  type: 'clawdbot' | 'openclaw'
}

/**
 * Probe a single port to check if a Clawdbot gateway is running
 */
async function probePort(port: number): Promise<PortInfo | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 200)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      signal: controller.signal,
      headers: { Accept: 'text/html' },
    })
    clearTimeout(timer)
    if (!res.ok) return null

    const html = await res.text()
    if (!html.includes('__CLAWDBOT_') && !html.includes('Clawdbot')) return null

    const nameMatch = html.match(/__CLAWDBOT_ASSISTANT_NAME__\s*=\s*"([^"]+)"/)
    const rawName = nameMatch?.[1] ?? `Agent ${port}`
    const id =
      rawName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 50) || `agent-${port}`

    return { id, name: rawName.slice(0, 100) }
  } catch {
    clearTimeout(timer)
    return null
  }
}

/**
 * Read all user home directories and build a port → config map.
 * Tries both .clawdbot/clawdbot.json and .openclaw/openclaw.json.
 * Uses try/catch so permission errors never crash the scan.
 */
function buildPortConfigMap(): Map<number, ConfigEntry> {
  const map = new Map<number, ConfigEntry>()

  let users: string[] = []
  try {
    users = readdirSync('/home')
  } catch {
    return map
  }

  for (const user of users) {
    // Clawdbot config
    try {
      const filePath = join('/home', user, '.clawdbot', 'clawdbot.json')
      const raw = readFileSync(filePath, 'utf-8')
      const cfg = JSON.parse(raw) as AgentConfigFile
      const port = cfg.gateway?.port
      const token = cfg.gateway?.auth?.token
      if (typeof port === 'number' && typeof token === 'string' && !map.has(port)) {
        map.set(port, { token, type: 'clawdbot' })
      }
    } catch {
      // File missing or unreadable — skip
    }

    // OpenClaw config
    try {
      const filePath = join('/home', user, '.openclaw', 'openclaw.json')
      const raw = readFileSync(filePath, 'utf-8')
      const cfg = JSON.parse(raw) as AgentConfigFile
      const port = cfg.gateway?.port
      const token = cfg.gateway?.auth?.token
      if (typeof port === 'number' && typeof token === 'string' && !map.has(port)) {
        map.set(port, { token, type: 'openclaw' })
      }
    } catch {
      // File missing or unreadable — skip
    }
  }

  return map
}

/**
 * Scan ports (default 18700-18850), match against config files, and auto-pair where possible.
 * Returns the list of discovered agents with their pairing status.
 * Port range is configurable via GATEWAY_PORT_START and GATEWAY_PORT_END env vars.
 */
export async function scanAndAutoPair(): Promise<DiscoveredAgent[]> {
  const PORT_START = parseInt(process.env.GATEWAY_PORT_START || '18700', 10)
  const PORT_END = parseInt(process.env.GATEWAY_PORT_END || '18850', 10)

  const ports = Array.from({ length: PORT_END - PORT_START + 1 }, (_, i) => PORT_START + i)

  // Probe all ports concurrently
  const probeResults = await Promise.all(
    ports.map((port) => probePort(port).then((info) => (info ? { port, ...info } : null)))
  )
  const activePorts = probeResults.filter(
    (r): r is { port: number; id: string; name: string } => r !== null
  )

  if (activePorts.length === 0) return []

  const configMap = buildPortConfigMap()
  const existingGateways = getCustomGateways()
  const agents: DiscoveredAgent[] = []

  for (const { port, id, name } of activePorts) {
    const url = `http://127.0.0.1:${port}`
    const cfg = configMap.get(port)
    const type: GatewayConfig['type'] = cfg?.type ?? 'clawdbot'

    // Already stored → report as paired, skip re-adding
    const alreadyStored = existingGateways.some((g) => g.port === port)
    if (alreadyStored) {
      agents.push({ id, name, port, url, paired: true, type: type ?? 'clawdbot' })
      continue
    }

    if (cfg) {
      // Config readable → auto-pair
      // Avoid id collision with existing gateways
      const idExists = existingGateways.some((g) => g.id === id)
      const finalId = idExists ? `${id}-${port}` : id

      try {
        addCustomGateway({
          id: finalId,
          name,
          url,
          port,
          token: cfg.token,
          type: type ?? 'clawdbot',
        })
        agents.push({ id: finalId, name, port, url, paired: true, type: type ?? 'clawdbot' })
      } catch {
        // addCustomGateway throws if id already exists (race condition) — still report as paired
        agents.push({ id: finalId, name, port, url, paired: true, type: type ?? 'clawdbot' })
      }
    } else {
      // Config unreadable or missing → manual pairing needed
      // Use "agent-{port}" format so POST /api/setup/pair can extract port
      agents.push({
        id: `agent-${port}`,
        name: name || `Agent ${port}`,
        port,
        url,
        paired: false,
        type: type ?? 'clawdbot',
      })
    }
  }

  return agents
}
