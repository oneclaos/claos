import { log } from '@/lib/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession } from '@/lib/auth'
import { TIMEOUTS } from '@/lib/constants'

interface DiscoveredAgent {
  id: string
  name: string
  port: number
  online: boolean
  version?: string
  uptime?: number
  type?: 'clawdbot' | 'openclaw' | 'unknown'
}

// Cache pour éviter de scanner trop souvent
let cachedAgents: DiscoveredAgent[] = []
let cacheTime = 0
const CACHE_TTL = TIMEOUTS.AGENT_CACHE_TTL // 30 secondes

async function probePort(port: number): Promise<DiscoveredAgent | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    
    // Essayer de récupérer le status du gateway
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    })
    
    clearTimeout(timeout)
    
    if (!res.ok) return null
    
    const data = await res.json()
    
    // Detect gateway type: Clawdbot vs OpenClaw (compatible fork)
    const type = data.type === 'openclaw' || data.software === 'openclaw'
      ? 'openclaw'
      : data.type === 'clawdbot' || data.software === 'clawdbot'
      ? 'clawdbot'
      : 'unknown'

    return {
      id: `agent-${port}`,
      name: data.name || data.agentName || `Agent ${port}`,
      port,
      online: true,
      version: data.version,
      uptime: data.uptime,
      type
    }
  } catch {
    return null
  }
}

async function discoverAgents(): Promise<DiscoveredAgent[]> {
  // Vérifier le cache
  if (Date.now() - cacheTime < CACHE_TTL && cachedAgents.length > 0) {
    return cachedAgents
  }
  
  // Scanner les ports 18700-18799 (Clawdbot: 18750-18799, OpenClaw/MoltBot: 18700-18749)
  const ports = Array.from({ length: 100 }, (_, i) => 18700 + i)
  
  // Probe en parallèle avec limite de concurrence
  const results = await Promise.all(
    ports.map(port => probePort(port))
  )
  
  // Filtrer les agents trouvés
  const agents = results.filter((a): a is DiscoveredAgent => a !== null)
  
  // Mettre en cache
  cachedAgents = agents
  cacheTime = Date.now()
  
  return agents
}

export async function GET(request: NextRequest) {
  // Auth check
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const agents = await discoverAgents()
    
    return NextResponse.json({
      agents,
      count: agents.length,
      cached: Date.now() - cacheTime < 1000 ? false : true,
      scannedAt: new Date(cacheTime).toISOString()
    })
  } catch (error) {
    log.error('Discovery error:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: 'Failed to discover agents', agents: [] },
      { status: 500 }
    )
  }
}
