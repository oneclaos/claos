/**
 * Tests for lib/totp.ts
 * Mocks: otplib, qrcode, bcrypt (dynamic import), fs, audit
 */

/* eslint-disable @typescript-eslint/no-require-imports */
// Dynamic requires needed for test isolation after mock setup

// ─── Module mocks BEFORE imports ─────────────────────────────────────────────

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'MOCKSECRETABCDEF'),
  generateURI: jest.fn(
    () => 'otpauth://totp/Claos:admin?secret=MOCKSECRETABCDEF&issuer=Claos'
  ),
  verify: jest.fn(),
}))

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mockqrcode'),
}))

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockImplementation((text: string) => Promise.resolve(`$2b$10$hashed_${text}`)),
  compare: jest.fn().mockResolvedValue(false),
}))

jest.mock('@/lib/audit', () => ({
  auditLog: jest.fn(),
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import * as OTPLib from 'otplib'
import * as bcrypt from 'bcrypt'
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

const mockVerify = OTPLib.verify as jest.MockedFunction<typeof OTPLib.verify>
const mockBcryptCompare = bcrypt.compare as jest.MockedFunction<typeof bcrypt.compare>
// const mockBcryptHash = bcrypt.hash as jest.Mock // unusededFunction<typeof bcrypt.hash>

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('isTotpEnabled', () => {
  it('returns false when no totp file exists (fresh install)', () => {
    // DATA_DIR is cleaned in beforeEach, so file won't exist
    expect(isTotpEnabled()).toBe(false)
  })
})

describe('isTotpSetupRequired', () => {
  it('returns true when setup not completed', () => {
    expect(isTotpSetupRequired()).toBe(true)
  })
})

describe('generateTotpSetup', () => {
  it('returns secret, qrCodeDataUrl and recoveryCodes', async () => {
    const result = await generateTotpSetup()

    expect(result.secret).toBe('MOCKSECRETABCDEF')
    expect(result.qrCodeDataUrl).toBe('data:image/png;base64,mockqrcode')
    expect(Array.isArray(result.recoveryCodes)).toBe(true)
    expect(result.recoveryCodes.length).toBe(8)
  })

  it('recovery codes match expected format (XXXX-XXXX)', async () => {
    const result = await generateTotpSetup()
    for (const code of result.recoveryCodes) {
      expect(code).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/)
    }
  })

  it('calls generateSecret and generateURI', async () => {
    await generateTotpSetup()
    expect(OTPLib.generateSecret).toHaveBeenCalled()
    expect(OTPLib.generateURI).toHaveBeenCalled()
  })
})

describe('verifyAndEnableTotp', () => {
  beforeEach(async () => {
    // Setup: generate a TOTP first (stores secret to file)
    await generateTotpSetup()
  })

  it('returns false when secret not set (cleared state)', async () => {
    // Fresh clean dir — no file
    const { existsSync, unlinkSync } = require('fs')
    const { join } = require('path')
    const totpFile = join(process.env.DATA_DIR, 'totp.json')
    if (existsSync(totpFile)) unlinkSync(totpFile)

    const result = await verifyAndEnableTotp('123456')
    expect(result).toBe(false)
  })

  it('returns true when TOTP code is valid', async () => {
    mockVerify.mockResolvedValueOnce({ valid: true as const, delta: 0 })
    const result = await verifyAndEnableTotp('123456')
    expect(result).toBe(true)
  })

  it('returns false when TOTP code is invalid', async () => {
    mockVerify.mockResolvedValueOnce({ valid: false as const })
    const result = await verifyAndEnableTotp('000000')
    expect(result).toBe(false)
  })
})

describe('verifyTotpCode', () => {
  beforeEach(async () => {
    // Enable TOTP first
    await generateTotpSetup()
    mockVerify.mockResolvedValueOnce({ valid: true as const, delta: 0 })
    await verifyAndEnableTotp('123456')
  })

  it('returns false when TOTP is not enabled', async () => {
    // Fresh dir — TOTP disabled
    const { existsSync, unlinkSync } = require('fs')
    const { join } = require('path')
    const totpFile = join(process.env.DATA_DIR, 'totp.json')
    if (existsSync(totpFile)) unlinkSync(totpFile)

    const result = await verifyTotpCode('123456')
    expect(result).toBe(false)
  })

  it('returns true when code is valid', async () => {
    mockVerify.mockResolvedValueOnce({ valid: true as const, delta: 0 })
    const result = await verifyTotpCode('123456')
    expect(result).toBe(true)
  })

  it('returns false when code is invalid', async () => {
    mockVerify.mockResolvedValueOnce({ valid: false as const })
    const result = await verifyTotpCode('000000')
    expect(result).toBe(false)
  })

  it('returns false when verify throws', async () => {
    mockVerify.mockRejectedValueOnce(new Error('TOTP error'))
    const result = await verifyTotpCode('123456')
    expect(result).toBe(false)
  })
})

describe('verifyRecoveryCode', () => {
  let generatedCodes: string[]

  beforeEach(async () => {
    const setup = await generateTotpSetup()
    generatedCodes = setup.recoveryCodes
    mockVerify.mockResolvedValueOnce({ valid: true as const, delta: 0 })
    await verifyAndEnableTotp('123456')
  })

  it('returns false when TOTP is not enabled', async () => {
    const { existsSync, unlinkSync } = require('fs')
    const { join } = require('path')
    const totpFile = join(process.env.DATA_DIR, 'totp.json')
    if (existsSync(totpFile)) unlinkSync(totpFile)

    const result = await verifyRecoveryCode('ABCD-1234')
    expect(result).toBe(false)
  })

  it('returns true when recovery code matches', async () => {
    mockBcryptCompare.mockResolvedValueOnce(true as never)
    const result = await verifyRecoveryCode(generatedCodes[0])
    expect(result).toBe(true)
  })

  it('returns false when no recovery code matches', async () => {
    mockBcryptCompare.mockResolvedValue(false as never)
    const result = await verifyRecoveryCode('XXXX-XXXX')
    expect(result).toBe(false)
  })

  it('removes used recovery code from the list', async () => {
    mockBcryptCompare.mockResolvedValueOnce(true as never)
    await verifyRecoveryCode(generatedCodes[0])
    // Count should decrease by 1
    const count = getRecoveryCodesCount()
    expect(count).toBe(7)
  })
})

describe('getRecoveryCodesCount', () => {
  it('returns 0 when TOTP not configured', () => {
    expect(getRecoveryCodesCount()).toBe(0)
  })

  it('returns 8 after setup', async () => {
    await generateTotpSetup()
    expect(getRecoveryCodesCount()).toBe(8)
  })
})

describe('disableTotp', () => {
  beforeEach(async () => {
    await generateTotpSetup()
    mockVerify.mockResolvedValueOnce({ valid: true as const, delta: 0 })
    await verifyAndEnableTotp('123456')
  })

  it('disables TOTP when valid code provided', async () => {
    mockVerify.mockResolvedValueOnce({ valid: true as const, delta: 0 })
    const result = await disableTotp('123456')
    expect(result).toBe(true)
    expect(isTotpEnabled()).toBe(false)
  })

  it('returns false when code is invalid', async () => {
    mockVerify.mockResolvedValue({ valid: false as const })
    mockBcryptCompare.mockResolvedValue(false as never)
    const result = await disableTotp('000000')
    expect(result).toBe(false)
    expect(isTotpEnabled()).toBe(true)
  })

  it('disables TOTP when valid recovery code provided', async () => {
    mockVerify.mockResolvedValue({ valid: false as const })
    mockBcryptCompare.mockResolvedValueOnce(true as never)
    const result = await disableTotp('ABCD-1234')
    expect(result).toBe(true)
  })
})

describe('regenerateRecoveryCodes', () => {
  beforeEach(async () => {
    await generateTotpSetup()
    mockVerify.mockResolvedValueOnce({ valid: true as const, delta: 0 })
    await verifyAndEnableTotp('123456')
  })

  it('returns null when TOTP code is invalid', async () => {
    mockVerify.mockResolvedValueOnce({ valid: false as const })
    const result = await regenerateRecoveryCodes('000000')
    expect(result).toBeNull()
  })

  it('returns new recovery codes when code is valid', async () => {
    mockVerify.mockResolvedValueOnce({ valid: true as const, delta: 0 })
    const result = await regenerateRecoveryCodes('123456')
    expect(result).not.toBeNull()
    expect(result!.length).toBe(8)
  })

  it('new codes match expected format', async () => {
    mockVerify.mockResolvedValueOnce({ valid: true as const, delta: 0 })
    const result = await regenerateRecoveryCodes('123456')
    for (const code of result!) {
      expect(code).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/)
    }
  })
})
