import { log } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession } from '@/lib/auth'
import { listAllSessions, listSessions, getGateways } from '@/lib/gateway'
import { validateRequest, sessionListRequestSchema } from '@/lib/validation'

// GET /api/sessions - List all sessions across gateways
export async function GET() {
  // Auth check
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const sessions = await listAllSessions()
    return NextResponse.json({ 
      sessions,
      total: sessions.length 
    })
  } catch (err) {
    log.error('Failed to list sessions:', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Failed to list sessions' }, { status: 500 })
  }
}

// POST /api/sessions - List sessions with filters
export async function POST(request: Request) {
  // Auth check
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const validation = validateRequest(sessionListRequestSchema, body)
    
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { gatewayId, channel, limit, offset } = validation.data

    let sessions
    if (gatewayId) {
      // Check gateway exists
      const gateways = getGateways()
      if (!gateways.find(g => g.id === gatewayId)) {
        return NextResponse.json({ error: 'Gateway not found' }, { status: 404 })
      }
      sessions = await listSessions(gatewayId)
    } else {
      sessions = await listAllSessions()
    }

    // Filter by channel if specified
    if (channel) {
      sessions = sessions.filter(s => s.channel === channel)
    }

    // Apply pagination
    const total = sessions.length
    const paginated = sessions.slice(offset, offset + limit)

    return NextResponse.json({ 
      sessions: paginated,
      total,
      hasMore: offset + limit < total
    })
  } catch (err) {
    log.error('Failed to list sessions:', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Failed to list sessions' }, { status: 500 })
  }
}
