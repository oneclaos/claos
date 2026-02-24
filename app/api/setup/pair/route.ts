import { log } from '@/lib/logger'
// Setup API: agent discovery and pairing
// No CSRF required — this is first-run setup, not yet authenticated

import { NextRequest, NextResponse } from 'next/server'
import { scanAndAutoPair } from '@/lib/gateway/auto-pair'
import { getCustomGateways, addCustomGateway, updateCustomGateway } from '@/lib/gateway/config'
import { isFirstRun } from '@/lib/auth'
import { validateRequest, pairAgentRequestSchema } from '@/lib/validation'

// Allowed port range for Clawdbot/OpenClaw gateways (SSRF mitigation)
// Must match DEFAULT_PORT_START/END in lib/gateway/types.ts
const CLAWDBOT_PORT_MIN = parseInt(process.env.GATEWAY_PORT_START || '18700', 10)
const CLAWDBOT_PORT_MAX = parseInt(process.env.GATEWAY_PORT_END || '18850', 10)

/**
 * GET /api/setup/pair
 * Scans ports 18700-18799, auto-pairs agents with readable config files.
 * Returns list of discovered agents with pairing status.
 * Only accessible during first-run setup window.
 */
export async function GET() {
  if (!isFirstRun()) {
    return NextResponse.json({ error: 'Setup window closed' }, { status: 403 })
  }

  try {
    const agents = await scanAndAutoPair()
    return NextResponse.json({ agents })
  } catch (err) {
    log.error('[setup/pair] Scan failed:', {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Scan failed' }, { status: 500 })
  }
}

/**
 * POST /api/setup/pair
 * Manually pair an agent by providing its token.
 * Body: { agentId: "agent-18750", token: "xxxx" }
 * Validates that the gateway is reachable before saving.
 * Only accessible during first-run setup window.
 */
export async function POST(request: NextRequest) {
  if (!isFirstRun()) {
    return NextResponse.json({ error: 'Setup window closed' }, { status: 403 })
  }

  try {
    const body = await request.json()

    // Validate with Zod schema
    const validation = validateRequest(pairAgentRequestSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { agentId, token } = validation.data

    // Extract port from agentId format "agent-{port}"
    const portMatch = agentId.match(/^agent-(\d+)$/)
    if (!portMatch) {
      return NextResponse.json(
        { error: 'Invalid agentId format (expected "agent-{port}")' },
        { status: 400 }
      )
    }
    const port = parseInt(portMatch[1], 10)

    // SSRF mitigation: restrict to Clawdbot/OpenClaw port range only
    if (port < CLAWDBOT_PORT_MIN || port > CLAWDBOT_PORT_MAX) {
      return NextResponse.json(
        { error: `Port must be in range ${CLAWDBOT_PORT_MIN}-${CLAWDBOT_PORT_MAX}` },
        { status: 400 }
      )
    }
    const url = `http://127.0.0.1:${port}`

    // Health-check: verify the gateway is reachable and looks like a Clawdbot gateway
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2000)
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'text/html' },
      })
      clearTimeout(timer)

      if (!res.ok) {
        return NextResponse.json({ error: 'Gateway returned an error response' }, { status: 400 })
      }

      const html = await res.text()
      if (!html.includes('__CLAWDBOT_') && !html.includes('Clawdbot')) {
        return NextResponse.json(
          { error: 'Target is not a valid Clawdbot gateway' },
          { status: 400 }
        )
      }
    } catch {
      return NextResponse.json({ error: 'Gateway unreachable' }, { status: 400 })
    }

    // Save the gateway config
    const existingGateways = getCustomGateways()
    const alreadyStored = existingGateways.find((g) => g.port === port || g.id === agentId)

    if (alreadyStored) {
      // Update existing entry with the provided token
      updateCustomGateway(alreadyStored.id, { token })
    } else {
      addCustomGateway({
        id: agentId,
        name: `Agent ${port}`,
        url,
        port,
        token,
        type: 'clawdbot',
      })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    log.error('[setup/pair] Manual pair failed:', {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Failed to pair agent' }, { status: 500 })
  }
}
