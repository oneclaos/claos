import { log } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { getAllGateways } from '@/lib/gateway/registry'
import { getGatewayClient } from '@/lib/gateway/chat-client'

// DELETE /api/sessions/cleanup
// Deletes all claos-* sessions from all gateways that have no recent activity
// (older than 1 hour and no messages), keeping only the most recent per gateway.
export async function DELETE(request: Request) {
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    auditLog('security', 'csrf_violation', { action: 'sessions_cleanup' }, 'warn')
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const gateways = await getAllGateways()
    let deleted = 0
    const errors: string[] = []

    for (const gw of gateways) {
      try {
        const client = await getGatewayClient(gw.id)

        // List all sessions for this gateway
        const response = await client.request<{
          sessions?: Array<{ key: string; kind?: string; lastActive?: string; messageCount?: number }>
        }>('sessions.list', { limit: 500 })

        const sessions = response.sessions ?? []

        // Filter: only claos-* sessions (not main, not multiagent)
        const appSessions = sessions.filter(s => {
          const key = s.key.replace(/^agent:[^:]+:/, '')
          return key.startsWith('claos-') &&
            !key.endsWith('-main') &&
            !key.startsWith('claos-multiagent-')
        })

        if (appSessions.length <= 1) continue // nothing to clean

        // Sort by lastActive descending — keep the most recent
        const sorted = [...appSessions].sort((a, b) => {
          const ta = a.lastActive ? new Date(a.lastActive).getTime() : 0
          const tb = b.lastActive ? new Date(b.lastActive).getTime() : 0
          return tb - ta
        })

        // Delete all except the most recent one
        const toDelete = sorted.slice(1)
        for (const s of toDelete) {
          try {
            await client.request('sessions.delete', { key: s.key })
            deleted++
          } catch {
            // Session might already be gone — ignore
          }
        }
      } catch (err) {
        errors.push(`${gw.id}: ${err instanceof Error ? err.message : 'unknown'}`)
      }
    }

    auditLog('gateway', 'sessions_cleanup', { deleted, errors: errors.length })
    return NextResponse.json({ success: true, deleted, errors })
  } catch (err) {
    log.error('Cleanup error:', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 })
  }
}
