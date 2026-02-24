import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { ptyManager } from '@/lib/terminal/pty-manager'
import { randomBytes } from 'crypto'
import { getClientInfo } from '@/lib/get-client-info'

// GET /api/terminal - List sessions
export async function GET(request: NextRequest) {
  const { ip, userAgent } = getClientInfo(request)

  const token = await getSessionFromCookies()
  if (!token || !validateSession(token, ip, userAgent)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sessions = ptyManager.listSessions()
  return NextResponse.json({ sessions })
}

// POST /api/terminal - Create new session
export async function POST(request: NextRequest) {
  const { ip, userAgent } = getClientInfo(request)

  const token = await getSessionFromCookies()
  if (!token || !validateSession(token, ip, userAgent)) {
    auditLog('security', 'unauthorized_terminal_create', { ip }, 'warn')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    auditLog('security', 'csrf_violation', { ip, action: 'terminal_create' }, 'warn')
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const sessionId = randomBytes(16).toString('hex')
    const session = ptyManager.createSession(sessionId)

    if (!session) {
      return NextResponse.json({ error: 'Failed to create terminal session' }, { status: 500 })
    }

    auditLog('terminal', 'created', { ip, sessionId })

    return NextResponse.json({
      success: true,
      sessionId,
      createdAt: session.createdAt,
    })
  } catch (err) {
    auditLog(
      'terminal',
      'create_error',
      { ip, error: err instanceof Error ? err.message : 'unknown' },
      'error'
    )
    return NextResponse.json({ error: 'Failed to create terminal' }, { status: 500 })
  }
}
