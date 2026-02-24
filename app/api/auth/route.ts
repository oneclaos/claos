import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import {
  createSession,
  deleteSession,
  rotateSession,
  setSessionCookie,
  clearSessionCookie,
  getSessionFromCookies,
  getPasswordHash,
  verifyPassword,
  validateSession,
  generateCsrfToken,
  checkRateLimit,
  recordLoginAttempt,
  isFirstRun,
} from '@/lib/auth'
import { isTotpEnabled, isTotpSetupRequired, verifyTotpCode, verifyRecoveryCode } from '@/lib/totp'
import { auditLog } from '@/lib/audit'
import { getClientInfo } from '@/lib/get-client-info'

// ── Persistent temp-token store (TOTP flow, short-lived) ─────────────────────
// Replaces the in-memory Map: survives PM2 restarts, bounded to 1000 entries.

const DATA_DIR = process.env.DATA_DIR || join(process.env.HOME || '/tmp', '.claos')
const TEMP_TOKENS_FILE = join(DATA_DIR, 'temp-tokens.json')
const TEMP_TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_TEMP_TOKENS = 1000

interface TempTokenData {
  expiresAt: number
  ip: string
}
type TempTokenStore = Record<string, TempTokenData>

function ensureTempTokenDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  }
}

function loadTempTokens(): TempTokenStore {
  ensureTempTokenDir()
  if (!existsSync(TEMP_TOKENS_FILE)) return {}
  try {
    return JSON.parse(readFileSync(TEMP_TOKENS_FILE, 'utf-8')) as TempTokenStore
  } catch {
    return {}
  }
}

function saveTempTokens(store: TempTokenStore): void {
  ensureTempTokenDir()
  writeFileSync(TEMP_TOKENS_FILE, JSON.stringify(store), { encoding: 'utf-8', mode: 0o600 })
}

function purgeTempTokens(store: TempTokenStore): TempTokenStore {
  const now = Date.now()
  const cleaned: TempTokenStore = {}
  for (const [t, d] of Object.entries(store)) {
    if (d.expiresAt > now) cleaned[t] = d
  }
  return cleaned
}

// Startup: clean expired entries from any previous run
;(function initTempTokens() {
  try {
    const store = loadTempTokens()
    const cleaned = purgeTempTokens(store)
    if (Object.keys(cleaned).length !== Object.keys(store).length) {
      saveTempTokens(cleaned)
    }
  } catch {
    /* non-fatal */
  }
})()

function createTempToken(ip: string): string {
  const token = randomBytes(32).toString('hex')
  let store = purgeTempTokens(loadTempTokens())

  // DoS guard: cap at MAX_TEMP_TOKENS (evict oldest if over limit)
  const entries = Object.entries(store).sort((a, b) => a[1].expiresAt - b[1].expiresAt)
  while (entries.length >= MAX_TEMP_TOKENS) {
    entries.shift() // remove oldest
  }
  store = Object.fromEntries(entries)
  store[token] = { expiresAt: Date.now() + TEMP_TOKEN_TTL_MS, ip }
  saveTempTokens(store)
  return token
}

function validateTempToken(token: string, ip: string): boolean {
  const store = loadTempTokens()
  const data = store[token]
  if (!data) return false
  if (data.expiresAt < Date.now()) {
    delete store[token]
    saveTempTokens(store)
    return false
  }
  // Verify same IP
  if (data.ip !== ip) return false
  return true
}

function consumeTempToken(token: string): void {
  const store = loadTempTokens()
  if (token in store) {
    delete store[token]
    saveTempTokens(store)
  }
}

export async function POST(request: NextRequest) {
  const { ip, userAgent } = getClientInfo(request)

  // Check rate limit
  const rateLimit = checkRateLimit(ip)
  if (!rateLimit.allowed) {
    auditLog('auth', 'rate_limited', { ip })
    return NextResponse.json(
      { error: 'Too many attempts', retryAfter: rateLimit.retryAfter },
      { status: 429 }
    )
  }

  try {
    const body = await request.json()
    const { action, password, code, tempToken } = body

    // === LOGIN (Password step) ===
    if (action === 'login') {
      const passwordHash = getPasswordHash()
      console.log('[DEBUG AUTH] passwordHash:', passwordHash?.substring(0, 30) + '...')
      console.log(
        '[DEBUG AUTH] password received:',
        password ? 'yes' : 'no',
        'length:',
        password?.length
      )
      const isValid = await verifyPassword(password || '', passwordHash)
      console.log('[DEBUG AUTH] isValid:', isValid)

      if (!isValid) {
        recordLoginAttempt(ip, false)
        auditLog('auth', 'login_failed', { ip, userAgent })
        return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
      }

      // Password correct - check TOTP status
      const totpEnabled = isTotpEnabled()
      console.log('[DEBUG AUTH] totpEnabled:', totpEnabled)
      const setupRequired = isTotpSetupRequired()
      console.log('[DEBUG AUTH] setupRequired:', setupRequired)

      if (totpEnabled) {
        // TOTP enabled - require second factor
        const tempToken = createTempToken(ip)
        auditLog('auth', 'password_verified_totp_required', { ip })
        return NextResponse.json({
          totpRequired: true,
          tempToken,
        })
      }

      if (setupRequired) {
        // First login - need to setup TOTP
        recordLoginAttempt(ip, true)
        const token = createSession(ip, userAgent)
        await setSessionCookie(token)
        const csrfToken = generateCsrfToken(token)
        auditLog('auth', 'login_success_setup_required', { ip, userAgent })
        return NextResponse.json({
          success: true,
          setupRequired: true,
          csrfToken,
        })
      }

      // No TOTP - direct login (shouldn't happen after first setup)
      recordLoginAttempt(ip, true)
      const token = createSession(ip, userAgent)
      await setSessionCookie(token)
      const csrfToken = generateCsrfToken(token)
      auditLog('auth', 'login_success', { ip, userAgent })
      return NextResponse.json({ success: true, csrfToken })
    }

    // === VERIFY TOTP (Second step) ===
    if (action === 'verify-totp') {
      if (!tempToken || !validateTempToken(tempToken, ip)) {
        auditLog('auth', 'invalid_temp_token', { ip }, 'warn')
        return NextResponse.json({ error: 'Session expired, please login again' }, { status: 401 })
      }

      if (!code) {
        return NextResponse.json({ error: 'Code required' }, { status: 400 })
      }

      // Try TOTP code first
      let isValid = await verifyTotpCode(code)

      // If not valid, try recovery code
      if (!isValid) {
        isValid = await verifyRecoveryCode(code)
      }

      if (!isValid) {
        recordLoginAttempt(ip, false)
        auditLog('auth', 'totp_verification_failed', { ip }, 'warn')
        return NextResponse.json({ error: 'Invalid code' }, { status: 401 })
      }

      // TOTP verified - complete login
      consumeTempToken(tempToken)
      recordLoginAttempt(ip, true)
      const token = createSession(ip, userAgent)
      await setSessionCookie(token)
      const csrfToken = generateCsrfToken(token)
      auditLog('auth', 'login_success_totp', { ip, userAgent })
      return NextResponse.json({ success: true, csrfToken })
    }

    // === LOGOUT ===
    if (action === 'logout') {
      const token = await getSessionFromCookies()
      if (token) {
        deleteSession(token)
        await clearSessionCookie()
        auditLog('auth', 'logout', { ip })
      }
      return NextResponse.json({ success: true })
    }

    // === ROTATE SESSION ===
    if (action === 'rotate') {
      const oldToken = await getSessionFromCookies()
      if (oldToken && validateSession(oldToken)) {
        const newToken = rotateSession(oldToken, ip, userAgent)
        await setSessionCookie(newToken)
        const csrfToken = generateCsrfToken(newToken)
        return NextResponse.json({ success: true, csrfToken })
      }
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    // === GET CSRF TOKEN ===
    if (action === 'csrf') {
      const token = await getSessionFromCookies()
      if (token && validateSession(token)) {
        const csrfToken = generateCsrfToken(token)
        return NextResponse.json({ csrfToken })
      }
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    auditLog('auth', 'error', { ip, error: err instanceof Error ? err.message : 'unknown' })
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}

export async function GET(request: NextRequest) {
  const { ip, userAgent } = getClientInfo(request)

  // First-run: no password configured yet
  if (isFirstRun()) {
    return NextResponse.json({ firstRun: true, authenticated: false })
  }

  const token = await getSessionFromCookies()
  const authenticated = token ? validateSession(token, ip, userAgent) : false

  const response: {
    authenticated: boolean
    csrfToken?: string
    totpEnabled?: boolean
    firstRun?: boolean
  } = { authenticated }

  if (authenticated && token) {
    response.csrfToken = generateCsrfToken(token)
    response.totpEnabled = isTotpEnabled()
  }

  return NextResponse.json(response)
}
