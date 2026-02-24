import { log } from '@/lib/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession } from '@/lib/auth'
import { listSessions } from '@/lib/gateway/chat-client'

function getClientInfo(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  const userAgent = request.headers.get('user-agent') || 'unknown'
  return { ip, userAgent }
}

// GET /api/chat/sessions?gatewayId=xxx - List sessions for a gateway
export async function GET(request: NextRequest) {
  const { ip, userAgent } = getClientInfo(request)

  // Auth check
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token, ip, userAgent)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const gatewayId = request.nextUrl.searchParams.get('gatewayId')
  if (!gatewayId) {
    return NextResponse.json({ error: 'gatewayId is required' }, { status: 400 })
  }

  try {
    const sessions = await listSessions(gatewayId)
    return NextResponse.json(sessions)
  } catch (error) {
    // Log full error server-side, return generic message (no info leak)
    log.error('Sessions list error:', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to list sessions' }, { status: 500 })
  }
}
