import { log } from '@/lib/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession } from '@/lib/auth'
import { getSessionHistory } from '@/lib/gateway/chat-client'

function getClientInfo(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  const userAgent = request.headers.get('user-agent') || 'unknown'
  return { ip, userAgent }
}

// GET /api/chat/history?gatewayId=xxx&sessionKey=xxx - Get chat history
export async function GET(request: NextRequest) {
  const { ip, userAgent } = getClientInfo(request)

  // Auth check
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token, ip, userAgent)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const gatewayId = request.nextUrl.searchParams.get('gatewayId')
  const sessionKey = request.nextUrl.searchParams.get('sessionKey')

  if (!gatewayId || !sessionKey) {
    return NextResponse.json({ error: 'gatewayId and sessionKey are required' }, { status: 400 })
  }

  try {
    const history = await getSessionHistory(gatewayId, sessionKey)
    return NextResponse.json(history)
  } catch (error) {
    // Log full error server-side, return generic message (no info leak)
    log.error('History error:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to get history' }, { status: 500 })
  }
}
