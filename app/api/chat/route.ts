import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { getClientInfo } from '@/lib/get-client-info'
import { sendChatMessage, parseGatewaysConfig, GatewayError } from '@/lib/gateway/chat-client'

// POST /api/chat - Send a message
export async function POST(request: NextRequest) {
  const { ip, userAgent } = getClientInfo(request)

  // Auth check
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token, ip, userAgent)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // CSRF check
  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { gatewayId, sessionKey, message } = body

    if (!gatewayId || !message) {
      return NextResponse.json({ error: 'gatewayId and message are required' }, { status: 400 })
    }

    const response = await sendChatMessage(gatewayId, {
      sessionKey,
      message,
    })

    return NextResponse.json({ response })
  } catch (error) {
    console.error('Chat error:', error)
    if (error instanceof GatewayError) {
      const status =
        error.code === 'gateway.not_found'
          ? 404
          : error.code === 'gateway.token_invalid'
            ? 401
            : 503
      return NextResponse.json(
        { error: error.message, code: error.code, retryable: error.retryable },
        { status }
      )
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Chat failed', code: 'gateway.unknown' },
      { status: 500 }
    )
  }
}

// GET /api/chat - Get available gateways
export async function GET(request: NextRequest) {
  const { ip, userAgent } = getClientInfo(request)

  // Auth check
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token, ip, userAgent)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const gateways = parseGatewaysConfig().map((g) => ({
    id: g.id,
    name: g.name,
  }))

  return NextResponse.json({ gateways })
}
