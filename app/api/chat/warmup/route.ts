import { NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession } from '@/lib/auth'
import { getGatewayClient } from '@/lib/gateway/chat-client'
import { getAllGateways } from '@/lib/gateway/registry'

// GET /api/chat/warmup - Pre-connect WS to all gateways so first message is instant
export async function GET() {
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const gateways = (await getAllGateways()).filter(gw => gw.token) // only pre-connect gateways with tokens
  const results: Record<string, boolean> = {}

  await Promise.all(
    gateways.map(async (gw) => {
      try {
        const client = await getGatewayClient(gw.id)
        results[gw.id] = client.isReady()
      } catch {
        results[gw.id] = false
      }
    })
  )

  return NextResponse.json({ warmed: results })
}
