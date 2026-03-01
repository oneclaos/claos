// TOTP (Time-based One-Time Password) Implementation
// Compatible with Google Authenticator, Authy, etc.

import * as OTPLib from 'otplib'
import QRCode from 'qrcode'
import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { auditLog } from './audit'

// ============================================
// Configuration
// ============================================

const DATA_DIR = process.env.DATA_DIR || '/tmp/claos-data'
const TOTP_FILE = join(DATA_DIR, 'totp.json')
const APP_NAME = 'Claos'
const RECOVERY_CODE_COUNT = 8
const RECOVERY_CODE_LENGTH = 8

// ============================================
// Storage
// ============================================

interface TotpConfig {
  enabled: boolean
  secret: string | null
  recoveryCodesHashed: string[] // bcrypt hashed
  setupCompleted: boolean
  enabledAt: string | null
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  }
}

function loadTotpConfig(): TotpConfig {
  ensureDataDir()
  if (!existsSync(TOTP_FILE)) {
    return {
      enabled: false,
      secret: null,
      recoveryCodesHashed: [],
      setupCompleted: false,
      enabledAt: null,
    }
  }
  try {
    const data = readFileSync(TOTP_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return {
      enabled: false,
      secret: null,
      recoveryCodesHashed: [],
      setupCompleted: false,
      enabledAt: null,
    }
  }
}

function saveTotpConfig(config: TotpConfig): void {
  ensureDataDir()
  writeFileSync(TOTP_FILE, JSON.stringify(config, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  })
}

// ============================================
// TOTP Functions
// ============================================

/**
 * Check if TOTP is enabled
 */
export function isTotpEnabled(): boolean {
  const config = loadTotpConfig()
  return config.enabled && config.setupCompleted
}

/**
 * Check if TOTP setup is required (first time)
 * TOTP is optional - users can enable it in settings if they want
 */
export function isTotpSetupRequired(): boolean {
  // TOTP is optional, not required on first login
  return false
}

/**
 * Generate a new TOTP secret and QR code for setup
 */
export async function generateTotpSetup(): Promise<{
  secret: string
  qrCodeDataUrl: string
  recoveryCodes: string[]
}> {
  const secret = OTPLib.generateSecret()
  const otpauthUrl = OTPLib.generateURI({
    secret,
    label: 'admin',
    issuer: APP_NAME,
  })

  // Generate QR code as data URL
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
    width: 256,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  })

  // Generate recovery codes
  const recoveryCodes: string[] = []
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const code = randomBytes(RECOVERY_CODE_LENGTH / 2)
      .toString('hex')
      .toUpperCase()
      .match(/.{1,4}/g)!
      .join('-')
    recoveryCodes.push(code)
  }

  // Store secret temporarily (not enabled yet)
  const config = loadTotpConfig()
  config.secret = secret
  // Hash recovery codes for storage
  const bcrypt = await import('bcrypt')
  config.recoveryCodesHashed = await Promise.all(
    recoveryCodes.map((code) => bcrypt.hash(code.replace(/-/g, ''), 10))
  )
  saveTotpConfig(config)

  auditLog('auth', 'totp_setup_initiated', {})

  return {
    secret,
    qrCodeDataUrl,
    recoveryCodes,
  }
}

/**
 * Verify TOTP code and complete setup
 */
export async function verifyAndEnableTotp(code: string): Promise<boolean> {
  const config = loadTotpConfig()

  if (!config.secret) {
    return false
  }

  // Verify the code
  const result = await OTPLib.verify({
    token: code,
    secret: config.secret,
  })

  if (result.valid) {
    config.enabled = true
    config.setupCompleted = true
    config.enabledAt = new Date().toISOString()
    saveTotpConfig(config)
    auditLog('auth', 'totp_enabled', {})
    return true
  }

  auditLog('auth', 'totp_setup_failed', { reason: 'invalid_code' }, 'warn')
  return false
}

/**
 * Verify TOTP code for login
 */
export async function verifyTotpCode(code: string): Promise<boolean> {
  const config = loadTotpConfig()

  if (!config.enabled || !config.secret) {
    return false
  }

  try {
    const result = await OTPLib.verify({
      token: code,
      secret: config.secret,
    })

    if (result.valid) {
      auditLog('auth', 'totp_verified', {})
      return true
    } else {
      auditLog('auth', 'totp_failed', {}, 'warn')
      return false
    }
  } catch {
    auditLog('auth', 'totp_failed', {}, 'warn')
    return false
  }
}

/**
 * Verify recovery code (one-time use)
 */
export async function verifyRecoveryCode(code: string): Promise<boolean> {
  const config = loadTotpConfig()

  if (!config.enabled || config.recoveryCodesHashed.length === 0) {
    return false
  }

  const normalizedCode = code.replace(/-/g, '').toUpperCase()
  const bcrypt = await import('bcrypt')

  for (let i = 0; i < config.recoveryCodesHashed.length; i++) {
    const isMatch = await bcrypt.compare(normalizedCode, config.recoveryCodesHashed[i])
    if (isMatch) {
      // Remove used recovery code
      config.recoveryCodesHashed.splice(i, 1)
      saveTotpConfig(config)
      auditLog(
        'auth',
        'recovery_code_used',
        { remaining: config.recoveryCodesHashed.length },
        'warn'
      )
      return true
    }
  }

  auditLog('auth', 'recovery_code_failed', {}, 'warn')
  return false
}

/**
 * Disable TOTP (requires valid code or recovery code)
 */
export async function disableTotp(code: string): Promise<boolean> {
  const isValidTotp = await verifyTotpCode(code)
  const isValidRecovery = await verifyRecoveryCode(code)

  if (isValidTotp || isValidRecovery) {
    const config = loadTotpConfig()
    config.enabled = false
    config.secret = null
    config.recoveryCodesHashed = []
    config.setupCompleted = false
    config.enabledAt = null
    saveTotpConfig(config)
    auditLog('auth', 'totp_disabled', {})
    return true
  }

  return false
}

/**
 * Get remaining recovery codes count
 */
export function getRecoveryCodesCount(): number {
  const config = loadTotpConfig()
  return config.recoveryCodesHashed.length
}

/**
 * Regenerate recovery codes (requires valid TOTP)
 */
export async function regenerateRecoveryCodes(totpCode: string): Promise<string[] | null> {
  if (!(await verifyTotpCode(totpCode))) {
    return null
  }

  const recoveryCodes: string[] = []
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const code = randomBytes(RECOVERY_CODE_LENGTH / 2)
      .toString('hex')
      .toUpperCase()
      .match(/.{1,4}/g)!
      .join('-')
    recoveryCodes.push(code)
  }

  const config = loadTotpConfig()
  const bcrypt = await import('bcrypt')
  config.recoveryCodesHashed = await Promise.all(
    recoveryCodes.map((code) => bcrypt.hash(code.replace(/-/g, ''), 10))
  )
  saveTotpConfig(config)

  auditLog('auth', 'recovery_codes_regenerated', {})

  return recoveryCodes
}
