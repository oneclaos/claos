import { log } from '@/lib/logger'
import { NextRequest, NextResponse } from 'next/server'
import { isFirstRun, setPasswordHash } from '@/lib/auth'
import { validateRequest, firstRunRequestSchema } from '@/lib/validation'

export async function POST(request: NextRequest) {
  // Only allowed during first-run (no password configured yet)
  if (!isFirstRun()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await request.json()

    // Validate request with Zod schema
    const validation = validateRequest(firstRunRequestSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { password } = validation.data

    await setPasswordHash(password)
    return NextResponse.json({ success: true })
  } catch (err) {
    log.error('[first-run] Failed to set password:', {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 })
  }
}
