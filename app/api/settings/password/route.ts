import { NextRequest, NextResponse } from 'next/server'
import {
  getSessionFromCookies,
  validateSession,
  validateCsrfToken,
  verifyPassword,
  hashPassword,
} from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { validateRequest, passwordChangeRequestSchema } from '@/lib/validation'
import { log } from '@/lib/logger'
import { promises as fs } from 'fs'
import { join } from 'path'

const DATA_DIR = process.env.DATA_DIR || '/tmp/claos-data'
const CONFIG_FILE = join(DATA_DIR, 'config.json')

interface Config {
  passwordHash?: string
}

async function loadConfig(): Promise<Config> {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return {}
  }
}

async function saveConfig(config: Config): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  })
}

function getClientInfo(request: NextRequest) {
  return {
    ip:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown',
  }
}

// Get current password hash (from config file or env)
async function getCurrentPasswordHash(): Promise<string> {
  const config = await loadConfig()
  if (config.passwordHash) {
    return config.passwordHash
  }
  return process.env.CLAOS_PASSWORD_HASH || ''
}

// POST /api/settings/password - Change password
export async function POST(request: NextRequest) {
  const { ip } = getClientInfo(request)

  // Auth check
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // CSRF check
  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    auditLog('security', 'csrf_violation', { ip, action: 'password_change' }, 'warn')
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const body = await request.json()

    // Validate with Zod schema
    const validation = validateRequest(passwordChangeRequestSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { currentPassword, newPassword } = validation.data

    // Verify current password
    const currentHash = await getCurrentPasswordHash()
    const isValid = await verifyPassword(currentPassword, currentHash)

    if (!isValid) {
      auditLog('auth', 'password_change_failed', { ip, reason: 'invalid_current_password' }, 'warn')
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 })
    }

    // Hash new password
    const newHash = await hashPassword(newPassword)

    // Save to config file (takes precedence over env var)
    const config = await loadConfig()
    config.passwordHash = newHash
    await saveConfig(config)

    auditLog('auth', 'password_changed', { ip })

    return NextResponse.json({ success: true })
  } catch (err) {
    // Log full error server-side, return generic message (no info leak)
    log.error('Password change error:', {
      ip,
      error: err instanceof Error ? err.message : String(err),
    })
    auditLog('auth', 'password_change_error', { ip }, 'error')
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 })
  }
}
