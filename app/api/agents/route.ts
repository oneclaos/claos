import { log } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession } from '@/lib/auth'
import { getAvailableAgents } from '@/lib/gateway'

// GET /api/agents - List available agents with online status (auto-discovered)
export async function GET() {
  // Auth check
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Auto-discover agents
    const agents = await getAvailableAgents()
    
    // All discovered agents are online by definition
    const agentsWithStatus = agents.map(agent => ({
      ...agent,
      online: true
    }))

    return NextResponse.json({ 
      agents: agentsWithStatus,
      count: agentsWithStatus.length,
      discoveredAt: new Date().toISOString()
    })
  } catch (err) {
    log.error('Failed to discover agents:', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Failed to discover agents', agents: [] }, { status: 500 })
  }
}
