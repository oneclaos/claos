import { log } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { getSessionFromCookies, validateSession } from '@/lib/auth'
import { getGatewayClient } from '@/lib/gateway/chat-client'

const NAMES_FILE = path.join(process.cwd(), 'data', 'session-names.json')

interface RouteParams {
  params: Promise<{ sessionKey: string }>
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { sessionKey } = await params

    // Validate sessionKey (prevent path traversal)
    if (!sessionKey || sessionKey.includes('..') || sessionKey.includes('/')) {
      return NextResponse.json({ error: 'Invalid session key' }, { status: 400 })
    }

    const decodedKey = decodeURIComponent(sessionKey)
    const gatewayId = request.nextUrl.searchParams.get('gatewayId')
    // rawKey: the full gateway key e.g. "agent:telegram:xxx" — used for proper kill
    const rawKey = request.nextUrl.searchParams.get('rawKey')

    // 1. Delete from Clawdbot gateway (sessions.delete RPC)
    if (gatewayId) {
      try {
        const client = await getGatewayClient(gatewayId)
        if (rawKey) {
          // Use the exact raw key from the gateway for a precise kill
          log.info('Deleting session with rawKey', { gatewayId, rawKey: decodeURIComponent(rawKey) })
          await client.request('sessions.delete', { key: decodeURIComponent(rawKey) })
        } else {
          // Fallback: try agent:main: prefix, then bare key
          log.warn('Deleting session without rawKey - trying fallback', { gatewayId, sessionKey: decodedKey })
          await client.request('sessions.delete', { key: `agent:main:${decodedKey}` }).catch(() =>
            client.request('sessions.delete', { key: decodedKey })
          )
        }
        log.info('Session deleted successfully', { gatewayId, sessionKey: decodedKey })
      } catch (err) {
        // Gateway might not have the session — not fatal, but log it
        log.warn('Failed to delete session from gateway', { 
          gatewayId, 
          sessionKey: decodedKey,
          rawKey,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }

    // 2. Remove from local names file
    try {
      const data = await fs.readFile(NAMES_FILE, 'utf-8')
      const names: Record<string, string> = JSON.parse(data)
      if (names[decodedKey]) {
        delete names[decodedKey]
        const tmpFile = `${NAMES_FILE}.${Date.now()}.tmp`
        await fs.writeFile(tmpFile, JSON.stringify(names, null, 2))
        await fs.rename(tmpFile, NAMES_FILE)
      }
    } catch {
      // File doesn't exist — nothing to do
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    log.error('Delete session error:', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 })
  }
}
