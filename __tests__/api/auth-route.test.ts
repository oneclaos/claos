/**
 * Tests for app/api/auth/route.ts
 * Covers: login, verify-totp, logout, rotate, csrf, GET status
 */

// ─── Module mocks BEFORE imports ─────────────────────────────────────────────

const mockCreateSession = jest.fn()
const mockDeleteSession = jest.fn()
const mockRotateSession = jest.fn()
const mockSetSessionCookie = jest.fn()
const mockClearSessionCookie = jest.fn()
const mockGetSessionFromCookies = jest.fn()
const mockGetPasswordHash = jest.fn()
const mockVerifyPassword = jest.fn()
const mockValidateSession = jest.fn()
const mockGenerateCsrfToken = jest.fn()
const mockCheckRateLimit = jest.fn()
const mockRecordLoginAttempt = jest.fn()
const mockIsFirstRun = jest.fn()

const mockIsTotpEnabled = jest.fn()
const mockIsTotpSetupRequired = jest.fn()
const mockVerifyTotpCode = jest.fn()
const mockVerifyRecoveryCode = jest.fn()

const mockAuditLog = jest.fn()

jest.mock('@/lib/auth', () => ({
  createSession: mockCreateSession,
  deleteSession: mockDeleteSession,
  rotateSession: mockRotateSession,
  setSessionCookie: mockSetSessionCookie,
  clearSessionCookie: mockClearSessionCookie,
  getSessionFromCookies: mockGetSessionFromCookies,
  getPasswordHash: mockGetPasswordHash,
  verifyPassword: mockVerifyPassword,
  validateSession: mockValidateSession,
  generateCsrfToken: mockGenerateCsrfToken,
  checkRateLimit: mockCheckRateLimit,
  recordLoginAttempt: mockRecordLoginAttempt,
  isFirstRun: mockIsFirstRun,
}))

jest.mock('@/lib/totp', () => ({
  isTotpEnabled: mockIsTotpEnabled,
  isTotpSetupRequired: mockIsTotpSetupRequired,
  verifyTotpCode: mockVerifyTotpCode,
  verifyRecoveryCode: mockVerifyRecoveryCode,
}))

jest.mock('@/lib/audit', () => ({
  auditLog: mockAuditLog,
}))

jest.mock('@/lib/get-client-info', () => ({
  getClientInfo: jest.fn(() => ({ ip: '127.0.0.1', userAgent: 'TestAgent/1.0' })),
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { POST, GET } from '@/app/api/auth/route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePostRequest(body: unknown, url = 'http://localhost/api/auth'): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeGetRequest(url = 'http://localhost/api/auth'): NextRequest {
  return new NextRequest(url, { method: 'GET' })
}

function allowRateLimit() {
  mockCheckRateLimit.mockReturnValue({ allowed: true })
}

beforeEach(() => {
  jest.clearAllMocks()
  allowRateLimit()
  mockCreateSession.mockReturnValue('session-token-abc123')
  mockSetSessionCookie.mockResolvedValue(undefined)
  mockClearSessionCookie.mockResolvedValue(undefined)
  mockGenerateCsrfToken.mockReturnValue('csrf-token-xyz')
  mockGetPasswordHash.mockReturnValue('$2b$10$hashed')
  mockIsTotpEnabled.mockReturnValue(false)
  mockIsTotpSetupRequired.mockReturnValue(false)
  mockIsFirstRun.mockReturnValue(false)
})

// ─── POST /api/auth - Login ───────────────────────────────────────────────────

describe('POST /api/auth - login', () => {
  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, retryAfter: 60 })
    const req = makePostRequest({ action: 'login', password: 'test' })
    const res = await POST(req)
    expect(res.status).toBe(429)
    const data = await res.json()
    expect(data.retryAfter).toBe(60)
  })

  it('returns 401 on invalid password', async () => {
    mockVerifyPassword.mockResolvedValue(false)
    const req = makePostRequest({ action: 'login', password: 'wrong' })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(mockRecordLoginAttempt).toHaveBeenCalledWith('127.0.0.1', false)
  })

  it('returns success without TOTP when neither enabled nor required', async () => {
    mockVerifyPassword.mockResolvedValue(true)
    mockIsTotpEnabled.mockReturnValue(false)
    mockIsTotpSetupRequired.mockReturnValue(false)
    const req = makePostRequest({ action: 'login', password: 'correct' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.csrfToken).toBe('csrf-token-xyz')
    expect(mockSetSessionCookie).toHaveBeenCalled()
  })

  it('returns totpRequired when TOTP is enabled', async () => {
    mockVerifyPassword.mockResolvedValue(true)
    mockIsTotpEnabled.mockReturnValue(true)
    const req = makePostRequest({ action: 'login', password: 'correct' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.totpRequired).toBe(true)
    expect(data.tempToken).toBeDefined()
    expect(typeof data.tempToken).toBe('string')
    expect(mockSetSessionCookie).not.toHaveBeenCalled()
  })

  it('returns setupRequired when TOTP setup not yet done', async () => {
    mockVerifyPassword.mockResolvedValue(true)
    mockIsTotpEnabled.mockReturnValue(false)
    mockIsTotpSetupRequired.mockReturnValue(true)
    const req = makePostRequest({ action: 'login', password: 'correct' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.setupRequired).toBe(true)
    expect(mockSetSessionCookie).toHaveBeenCalled()
  })

  it('returns 400 on invalid action', async () => {
    const req = makePostRequest({ action: 'unknown' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 on malformed JSON (no action)', async () => {
    const req = new NextRequest('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

// ─── POST /api/auth - verify-totp ─────────────────────────────────────────────

describe('POST /api/auth - verify-totp', () => {
  let tempToken: string

  beforeEach(async () => {
    // First, do a login to get a tempToken
    mockVerifyPassword.mockResolvedValue(true)
    mockIsTotpEnabled.mockReturnValue(true)
    const loginReq = makePostRequest({ action: 'login', password: 'correct' })
    const loginRes = await POST(loginReq)
    const loginData = await loginRes.json()
    tempToken = loginData.tempToken
  })

  it('returns 401 when tempToken is missing', async () => {
    const req = makePostRequest({ action: 'verify-totp', code: '123456' })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toContain('expired')
  })

  it('returns 400 when code is missing', async () => {
    const req = makePostRequest({ action: 'verify-totp', tempToken, code: '' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('required')
  })

  it('returns 401 on invalid TOTP code', async () => {
    mockVerifyTotpCode.mockResolvedValue(false)
    mockVerifyRecoveryCode.mockResolvedValue(false)
    const req = makePostRequest({ action: 'verify-totp', tempToken, code: '000000' })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(mockRecordLoginAttempt).toHaveBeenCalledWith('127.0.0.1', false)
  })

  it('returns success on valid TOTP code', async () => {
    mockVerifyTotpCode.mockResolvedValue(true)
    const req = makePostRequest({ action: 'verify-totp', tempToken, code: '123456' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.csrfToken).toBe('csrf-token-xyz')
    expect(mockSetSessionCookie).toHaveBeenCalled()
  })

  it('returns success when valid recovery code used', async () => {
    mockVerifyTotpCode.mockResolvedValue(false)
    mockVerifyRecoveryCode.mockResolvedValue(true)
    const req = makePostRequest({ action: 'verify-totp', tempToken, code: 'ABCD-1234' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('returns 401 when tempToken from wrong IP', async () => {
    // The tempToken was created for '127.0.0.1'
    // Simulate request from different IP
    const { getClientInfo } = require('@/lib/get-client-info')
    getClientInfo.mockReturnValueOnce({ ip: '192.168.1.100', userAgent: 'TestAgent' })

    const req = makePostRequest({ action: 'verify-totp', tempToken, code: '123456' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})

// ─── POST /api/auth - logout ──────────────────────────────────────────────────

describe('POST /api/auth - logout', () => {
  it('logs out when session exists', async () => {
    mockGetSessionFromCookies.mockResolvedValue('existing-session')
    const req = makePostRequest({ action: 'logout' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(mockDeleteSession).toHaveBeenCalledWith('existing-session')
    expect(mockClearSessionCookie).toHaveBeenCalled()
  })

  it('succeeds even when no session exists', async () => {
    mockGetSessionFromCookies.mockResolvedValue(null)
    const req = makePostRequest({ action: 'logout' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockDeleteSession).not.toHaveBeenCalled()
  })
})

// ─── POST /api/auth - rotate ──────────────────────────────────────────────────

describe('POST /api/auth - rotate', () => {
  it('rotates session token', async () => {
    mockGetSessionFromCookies.mockResolvedValue('old-token')
    mockValidateSession.mockReturnValue(true)
    mockRotateSession.mockReturnValue('new-token')
    mockGenerateCsrfToken.mockReturnValue('new-csrf')

    const req = makePostRequest({ action: 'rotate' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.csrfToken).toBe('new-csrf')
    expect(mockSetSessionCookie).toHaveBeenCalledWith('new-token')
  })

  it('returns 401 when session invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('bad-token')
    mockValidateSession.mockReturnValue(false)
    const req = makePostRequest({ action: 'rotate' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})

// ─── POST /api/auth - csrf ────────────────────────────────────────────────────

describe('POST /api/auth - csrf', () => {
  it('returns CSRF token for valid session', async () => {
    mockGetSessionFromCookies.mockResolvedValue('valid-session')
    mockValidateSession.mockReturnValue(true)
    mockGenerateCsrfToken.mockReturnValue('csrf-abc')

    const req = makePostRequest({ action: 'csrf' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.csrfToken).toBe('csrf-abc')
  })

  it('returns 401 for invalid session', async () => {
    mockGetSessionFromCookies.mockResolvedValue(null)
    mockValidateSession.mockReturnValue(false)

    const req = makePostRequest({ action: 'csrf' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})

// ─── GET /api/auth ────────────────────────────────────────────────────────────

describe('GET /api/auth', () => {
  it('returns firstRun=true when first run', async () => {
    mockIsFirstRun.mockReturnValue(true)
    const req = makeGetRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.firstRun).toBe(true)
    expect(data.authenticated).toBe(false)
  })

  it('returns authenticated=false when no session', async () => {
    mockGetSessionFromCookies.mockResolvedValue(null)
    mockValidateSession.mockReturnValue(false)
    const req = makeGetRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.authenticated).toBe(false)
  })

  it('returns authenticated=true with csrfToken and totpEnabled', async () => {
    mockGetSessionFromCookies.mockResolvedValue('valid-token')
    mockValidateSession.mockReturnValue(true)
    mockIsTotpEnabled.mockReturnValue(true)
    mockGenerateCsrfToken.mockReturnValue('csrf-xyz')

    const req = makeGetRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.authenticated).toBe(true)
    expect(data.csrfToken).toBe('csrf-xyz')
    expect(data.totpEnabled).toBe(true)
  })

  it('returns authenticated=false when session is invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('expired-token')
    mockValidateSession.mockReturnValue(false)
    const req = makeGetRequest()
    const res = await GET(req)
    const data = await res.json()
    expect(data.authenticated).toBe(false)
    expect(data.csrfToken).toBeUndefined()
  })
})
