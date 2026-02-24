import { promises as fs } from 'fs'
import { join } from 'path'

const DATA_DIR = process.env.DATA_DIR || join(process.env.HOME || '/tmp', '.claos')
const CONFIG_FILE = join(DATA_DIR, 'config.json')

interface GatewayEntry {
  id: string
  name: string
  url: string
}

interface GatewayCheckResult {
  id: string
  name: string
  reachable: boolean
}

interface GatewayChecks {
  configured: number
  reachable: number
  details: GatewayCheckResult[]
}

interface HealthChecks {
  disk: boolean
  gateways: GatewayChecks
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error'
  checks: HealthChecks
  timestamp: string
}

/** Normalise ws:// → http:// and wss:// → https:// for HTTP probing. */
function toHttpUrl(url: string): string {
  return url.replace(/^wss?:\/\//, (m) => (m === 'wss://' ? 'https://' : 'http://'))
}

/** Probe a gateway by fetching its /health endpoint with a 2 s timeout. */
async function probeGateway(gw: GatewayEntry): Promise<GatewayCheckResult> {
  try {
    const base = toHttpUrl(gw.url.replace(/\/$/, ''))
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(2000),
      headers: { Accept: 'application/json' },
    })
    return { id: gw.id, name: gw.name, reachable: res.ok }
  } catch {
    return { id: gw.id, name: gw.name, reachable: false }
  }
}

export async function GET() {
  const checks: HealthChecks = {
    disk: false,
    gateways: { configured: 0, reachable: 0, details: [] },
  }

  // Check 1: data directory is writable
  try {
    await fs.access(DATA_DIR, fs.constants.W_OK)
    checks.disk = true
  } catch {
    checks.disk = false
  }

  // Check 2: collect configured gateways (custom + env-based)
  const gateways: GatewayEntry[] = []

  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8')
    const config = JSON.parse(raw) as { customGateways?: { id: string; name: string; url: string }[] }
    if (Array.isArray(config.customGateways)) {
      for (const gw of config.customGateways) {
        if (gw.id && gw.url) {
          gateways.push({ id: gw.id, name: gw.name ?? gw.id, url: gw.url })
        }
      }
    }
  } catch {
    // config file absent or unreadable — that's fine
  }

  // Env-based static gateway
  if (process.env.GATEWAY_URL) {
    gateways.push({
      id: 'env-gateway',
      name: process.env.GATEWAY_NAME ?? 'Gateway (env)',
      url: process.env.GATEWAY_URL,
    })
  }

  // Check 3: probe each gateway in parallel
  if (gateways.length > 0) {
    const results = await Promise.all(gateways.map(probeGateway))
    checks.gateways = {
      configured: results.length,
      reachable: results.filter((r) => r.reachable).length,
      details: results,
    }
  } else {
    checks.gateways = { configured: 0, reachable: 0, details: [] }
  }

  // Determine overall status
  let status: HealthResponse['status'] = 'ok'
  if (!checks.disk) {
    status = 'error'
  } else if (
    checks.gateways.configured > 0 &&
    checks.gateways.reachable === 0
  ) {
    status = 'degraded'
  } else if (checks.gateways.configured === 0) {
    // No gateways configured at all — warn but don't error
    status = 'degraded'
  }

  return Response.json(
    { status, checks, timestamp: new Date().toISOString() } satisfies HealthResponse,
    { status: status === 'error' ? 503 : 200 }
  )
}
