import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { getAllGateways } from '@/lib/gateway/registry'
import { getCustomGateways, addCustomGateway, removeCustomGateway } from '@/lib/gateway/config'
import { validateRequest, addGatewayRequestSchema } from '@/lib/validation'
import type { GatewayConfig } from '@/lib/gateway/types'
import { randomBytes } from 'crypto'
import { log } from '@/lib/logger'

export async function GET() {
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Merge: auto-discovered + env-static + custom config gateways
    const allGateways = await getAllGateways()
    const customGateways = getCustomGateways()

    // Tag gateways with source so frontend knows which are deletable
    const autoIds = new Set(allGateways.map((g) => g.id))

    // Merge custom gateways that aren't already in the auto-discovered list
    const merged: (GatewayConfig & { custom?: boolean })[] = allGateways.map((g) => ({
      ...g,
      custom: false,
    }))
    for (const cg of customGateways) {
      if (!autoIds.has(cg.id)) {
        merged.push({ ...cg, custom: true })
      }
    }

    const gateways = merged.map((gw) => ({ ...gw, online: true }))
    return NextResponse.json({ gateways })
  } catch (err) {
    log.error('Failed to list gateways', {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Failed to list gateways' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  // Auth
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // CSRF
  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const body = await request.json()

    // Validate with Zod schema
    const validation = validateRequest(addGatewayRequestSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { name, url, gatewayToken } = validation.data

    // Generate a stable ID from name
    const id =
      name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 50) || `gateway-${randomBytes(4).toString('hex')}`

    const gw: GatewayConfig = {
      id,
      name: name.slice(0, 100),
      url,
      ...(gatewayToken ? { token: gatewayToken } : {}),
    }

    addCustomGateway(gw)
    return NextResponse.json({ success: true, gateway: { ...gw, custom: true } })
  } catch (err) {
    // Log full error server-side, return generic message (no info leak)
    log.error('Failed to add gateway', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Failed to add gateway' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  // Auth
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // CSRF
  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Gateway id is required' }, { status: 400 })
    }

    // Only allow deleting custom gateways
    const customGateways = getCustomGateways()
    if (!customGateways.some((g) => g.id === id)) {
      return NextResponse.json(
        { error: 'Gateway not found or cannot be deleted (only custom gateways can be removed)' },
        { status: 404 }
      )
    }

    removeCustomGateway(id)
    return NextResponse.json({ success: true })
  } catch (err) {
    log.error('Failed to delete gateway', {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Failed to delete gateway' }, { status: 500 })
  }
}
