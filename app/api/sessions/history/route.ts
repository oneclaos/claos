import { log } from '@/lib/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession } from '@/lib/auth'
import { getSessionHistory, getGateways } from '@/lib/gateway'
import { validateRequest, sessionHistoryRequestSchema } from '@/lib/validation'

async function handleHistory(gatewayId: string | null, sessionKey: string | null, limit?: number | null) {
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const validation = validateRequest(sessionHistoryRequestSchema, { gatewayId, sessionKey, limit })
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { gatewayId: gId, sessionKey: sKey, limit: lim } = validation.data
    const gateways = getGateways()
    const gateway = gateways.find(g => g.id === gId)
    if (!gateway) {
      return NextResponse.json({ error: 'Gateway not found' }, { status: 404 })
    }

    const messages = await getSessionHistory(gId, sKey, lim)
    return NextResponse.json({ messages, sessionKey: sKey, gateway: gId, gatewayName: gateway.name })
  } catch (err) {
    log.error('Failed to get session history:', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Failed to get session history' }, { status: 500 })
  }
}

// GET /api/sessions/history?gatewayId=...&sessionKey=...
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  return handleHistory(
    searchParams.get('gatewayId'),
    searchParams.get('sessionKey'),
    searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined
  )
}

// POST /api/sessions/history
export async function POST(request: Request) {
  const body = await request.json()
  return handleHistory(body.gatewayId, body.sessionKey, body.limit)
}
