import { log } from '@/lib/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { spawnSession } from '@/lib/gateway/sessions'
import { getAllGateways } from '@/lib/gateway/registry'
import { auditLog } from '@/lib/audit'
import { z } from 'zod'

const spawnSchema = z.object({
  gatewayId: z.string().min(1).max(100),
  message: z.string().min(1).max(10000).optional(),
  sessionKey: z.string().min(1).max(200).optional()
})

// POST /api/sessions/spawn - Create a new chat session
export async function POST(request: NextRequest) {
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // CSRF validation
  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    auditLog('security', 'csrf_violation', { action: 'session_spawn' }, 'warn')
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const result = spawnSchema.safeParse(body)
    
    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: result.error.flatten() },
        { status: 400 }
      )
    }

    const { gatewayId, message, sessionKey } = result.data

    // Check if gateway exists via unified registry
    const allGateways = await getAllGateways()
    const gatewayExists = allGateways.some(g => g.id === gatewayId)
    
    if (!gatewayExists) {
      const availableIds = allGateways.map(g => g.id).join(', ')
      auditLog('gateway', 'gateway_not_found', { 
        requestedId: gatewayId, 
        available: availableIds 
      }, 'warn')
      return NextResponse.json(
        { 
          error: `Gateway "${gatewayId}" not found`, 
          available: allGateways.map(g => ({ id: g.id, name: g.name }))
        },
        { status: 404 }
      )
    }

    const spawnResult = await spawnSession(gatewayId, message, sessionKey)
    
    if (!spawnResult.success) {
      auditLog('gateway', 'session_spawn_error', { 
        gatewayId, 
        error: spawnResult.error 
      }, 'warn')
      return NextResponse.json(
        { error: spawnResult.error || 'Failed to create session' },
        { status: 500 }
      )
    }

    auditLog('gateway', 'session_spawned', { 
      gatewayId, 
      sessionKey: spawnResult.sessionKey 
    })
    
    return NextResponse.json({ 
      success: true,
      sessionKey: spawnResult.sessionKey,
      gateway: gatewayId
    })
  } catch (err) {
    // Log full error server-side, return generic message to client (no info leak)
    log.error('Session spawn error:', { error: err instanceof Error ? err.message : String(err) })
    auditLog('gateway', 'session_spawn_exception', {
      error: err instanceof Error ? err.message : 'unknown'
    }, 'error')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
