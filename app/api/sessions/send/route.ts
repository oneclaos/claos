import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { sendToSession } from '@/lib/gateway/sessions'
import { auditLog } from '@/lib/audit'

// POST /api/sessions/send - Send message using OpenAI-compatible API
export async function POST(request: NextRequest) {
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // CSRF validation
  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    auditLog('security', 'csrf_violation', { action: 'session_send' }, 'warn')
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const { gatewayId, sessionKey, message, history } = await request.json()

    if (!gatewayId || !message) {
      return NextResponse.json({ error: 'Missing gatewayId or message' }, { status: 400 })
    }

    // Validate inputs
    if (typeof message !== 'string' || message.length > 100000) {
      return NextResponse.json({ error: 'Invalid message' }, { status: 400 })
    }

    // Send message and get response via OpenAI-compatible API
    const result = await sendToSession(gatewayId, sessionKey || 'default', message, history || [])

    if (!result.success) {
      auditLog(
        'gateway',
        'session_send_error',
        {
          gatewayId,
          sessionKey,
          error: result.error,
        },
        'warn'
      )
      return NextResponse.json({ error: result.error || 'Failed to send message' }, { status: 500 })
    }

    auditLog('gateway', 'session_message_sent', { gatewayId, sessionKey })

    return NextResponse.json({
      success: true,
      response: result.response,
    })
  } catch (err) {
    // Log full error server-side, return generic message to client (no info leak)
    console.error('Session send error:', err)
    auditLog(
      'gateway',
      'session_send_exception',
      {
        error: err instanceof Error ? err.message : 'unknown',
      },
      'error'
    )
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
