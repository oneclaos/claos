import { NextRequest, NextResponse } from 'next/server'
import {
  getSessionFromCookies,
  validateSession,
  validateCsrfToken,
  checkRateLimit,
  recordLoginAttempt,
} from '@/lib/auth'
import {
  isTotpEnabled,
  isTotpSetupRequired,
  generateTotpSetup,
  verifyAndEnableTotp,
  verifyTotpCode,
  verifyRecoveryCode,
  disableTotp,
  getRecoveryCodesCount,
  regenerateRecoveryCodes,
} from '@/lib/totp'
import { auditLog } from '@/lib/audit'
import { validateRequest, totpRequestSchema } from '@/lib/validation'
import { log } from '@/lib/logger'

function getClientInfo(request: NextRequest) {
  return {
    ip:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown',
  }
}

// GET /api/auth/totp - Get TOTP status
export async function GET() {
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    enabled: isTotpEnabled(),
    setupRequired: isTotpSetupRequired(),
    recoveryCodesRemaining: getRecoveryCodesCount(),
  })
}

// POST /api/auth/totp - TOTP actions
export async function POST(request: NextRequest) {
  const { ip } = getClientInfo(request)

  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // CSRF check for sensitive operations
  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    auditLog('security', 'csrf_violation', { ip, action: 'totp' }, 'warn')
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const body = await request.json()

    // Validate with Zod schema
    const validation = validateRequest(totpRequestSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { action, code } = validation.data

    switch (action) {
      case 'setup': {
        // Generate new TOTP setup
        const setup = await generateTotpSetup()
        return NextResponse.json({
          success: true,
          qrCode: setup.qrCodeDataUrl,
          secret: setup.secret, // For manual entry
          recoveryCodes: setup.recoveryCodes,
        })
      }

      case 'verify-setup': {
        // Verify code and enable TOTP
        const verified = await verifyAndEnableTotp(code!)
        if (verified) {
          return NextResponse.json({ success: true, enabled: true })
        }
        return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
      }

      case 'verify': {
        // Verify TOTP code
        const isValid = await verifyTotpCode(code!)
        if (isValid) {
          return NextResponse.json({ success: true, valid: true })
        }
        // Rate limit recovery code attempts (max 5 per 15 min per IP)
        const recoveryKey = `recovery:${ip}`
        const recoveryLimit = checkRateLimit(recoveryKey)
        if (!recoveryLimit.allowed) {
          auditLog('security', 'recovery_rate_limited', { ip }, 'warn')
          return NextResponse.json(
            {
              error: 'Too many recovery code attempts. Try again later.',
              retryAfter: recoveryLimit.retryAfter,
            },
            { status: 429 }
          )
        }
        // Try recovery code
        const isRecovery = await verifyRecoveryCode(code!)
        recordLoginAttempt(recoveryKey, isRecovery)
        if (isRecovery) {
          return NextResponse.json({ success: true, valid: true, usedRecoveryCode: true })
        }
        return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
      }

      case 'disable': {
        // Disable TOTP
        const disabled = await disableTotp(code!)
        if (disabled) {
          return NextResponse.json({ success: true, enabled: false })
        }
        return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
      }

      case 'regenerate-recovery': {
        // Regenerate recovery codes
        const newCodes = await regenerateRecoveryCodes(code!)
        if (newCodes) {
          return NextResponse.json({ success: true, recoveryCodes: newCodes })
        }
        return NextResponse.json({ error: 'Invalid TOTP code' }, { status: 400 })
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (err) {
    // Log full error server-side, return generic message (no info leak)
    log.error('TOTP error:', { ip, error: err instanceof Error ? err.message : String(err) })
    auditLog('auth', 'totp_error', { ip }, 'error')
    return NextResponse.json({ error: 'TOTP operation failed' }, { status: 500 })
  }
}
