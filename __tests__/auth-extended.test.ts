/**
 * Extended tests for lib/auth.ts
 * Covers: rotateSession, getSessionInfo, isFirstRun, getPasswordHash, setPasswordHash,
 *         getSessionFromCookies, setSessionCookie, clearSessionCookie,
 *         validateSession with STRICT_SESSION_BINDING,
 *         expired CSRF token, checkRateLimit already-locked
 */

// ─── Mocks BEFORE imports ─────────────────────────────────────────────────────

const mockCookiesGet = jest.fn()
const mockCookiesSet = jest.fn()
const mockCookiesDelete = jest.fn()
const mockCookieStore = {
  get: mockCookiesGet,
  set: mockCookiesSet,
  delete: mockCookiesDelete,
}

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => Promise.resolve(mockCookieStore)),
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
  createSession,
  validateSession,
  deleteSession,
  rotateSession,
  getSessionInfo,
  getPasswordHash,
  isFirstRun,
  setPasswordHash,
  generateCsrfToken,
  validateCsrfToken,
  checkRateLimit,
  recordLoginAttempt,
  getSessionFromCookies,
  setSessionCookie,
  clearSessionCookie,
} from '@/lib/auth'

// ─── rotateSession ────────────────────────────────────────────────────────────

describe('rotateSession', () => {
  it('deletes old session and creates new one', () => {
    const oldToken = createSession('1.2.3.4', 'Agent/1.0')
    expect(validateSession(oldToken)).toBe(true)

    const newToken = rotateSession(oldToken, '1.2.3.4', 'Agent/1.0')

    expect(newToken).toBeDefined()
    expect(newToken).not.toBe(oldToken)
    expect(newToken.length).toBe(64)
    // Old token is gone
    expect(validateSession(oldToken)).toBe(false)
    // New token is valid
    expect(validateSession(newToken)).toBe(true)
  })

  it('creates new session even if old token does not exist', () => {
    const fakeOld = 'a'.repeat(64)
    const newToken = rotateSession(fakeOld, '5.5.5.5', 'Bot/2.0')
    expect(newToken).toBeDefined()
    expect(newToken.length).toBe(64)
  })
})

// ─── getSessionInfo ───────────────────────────────────────────────────────────

describe('getSessionInfo', () => {
  it('returns null for non-existent token', () => {
    const result = getSessionInfo('z'.repeat(64))
    expect(result).toBeNull()
  })

  it('returns session data for existing token', () => {
    const token = createSession('10.0.0.1', 'TestBrowser/3.0')
    const info = getSessionInfo(token)

    expect(info).not.toBeNull()
    expect(info!.ip).toBe('10.0.0.1')
    expect(info!.userAgent).toBe('TestBrowser/3.0')
    expect(info!.expiresAt).toBeGreaterThan(Date.now())
    expect(info!.createdAt).toBeLessThanOrEqual(Date.now())
  })

  it('returns null after session is deleted', () => {
    const token = createSession('192.168.0.1', 'TestAgent')
    deleteSession(token)
    expect(getSessionInfo(token)).toBeNull()
  })
})

// ─── isFirstRun ───────────────────────────────────────────────────────────────

describe('isFirstRun', () => {
  it('returns false when CLAOS_PASSWORD_HASH env var is set', () => {
    // setup.ts sets CLAOS_PASSWORD_HASH
    expect(isFirstRun()).toBe(false)
  })

  it('returns true when no password is configured', () => {
    const original = process.env.CLAOS_PASSWORD_HASH
    delete process.env.CLAOS_PASSWORD_HASH
    // CONFIG_FILE does not exist (fresh test dir)
    expect(isFirstRun()).toBe(true)
    process.env.CLAOS_PASSWORD_HASH = original
  })
})

// ─── getPasswordHash ──────────────────────────────────────────────────────────

describe('getPasswordHash', () => {
  it('returns hash from env var when config file has no passwordHash', () => {
    // setup.ts sets CLAOS_PASSWORD_HASH
    const hash = getPasswordHash()
    expect(hash).toBe(process.env.CLAOS_PASSWORD_HASH)
  })

  it('throws when no password hash is configured', () => {
    const original = process.env.CLAOS_PASSWORD_HASH
    delete process.env.CLAOS_PASSWORD_HASH
    expect(() => getPasswordHash()).toThrow('CLAOS_PASSWORD_HASH not configured')
    process.env.CLAOS_PASSWORD_HASH = original
  })
})

// ─── setPasswordHash ──────────────────────────────────────────────────────────

describe('setPasswordHash', () => {
  it('saves hashed password to config and isFirstRun becomes false', async () => {
    const original = process.env.CLAOS_PASSWORD_HASH
    delete process.env.CLAOS_PASSWORD_HASH

    // Before setting
    expect(isFirstRun()).toBe(true)

    await setPasswordHash('new-secure-password')

    // After setting
    expect(isFirstRun()).toBe(false)
    const hash = getPasswordHash()
    expect(hash).toBeDefined()
    expect(hash.startsWith('$2b$')).toBe(true)

    process.env.CLAOS_PASSWORD_HASH = original
  })
})

// ─── validateSession with STRICT_SESSION_BINDING ──────────────────────────────

describe('validateSession with STRICT_SESSION_BINDING', () => {
  beforeEach(() => {
    process.env.STRICT_SESSION_BINDING = 'true'
  })

  afterEach(() => {
    delete process.env.STRICT_SESSION_BINDING
  })

  it('returns true when IP and UA match', () => {
    const token = createSession('1.2.3.4', 'StrictAgent/1')
    expect(validateSession(token, '1.2.3.4', 'StrictAgent/1')).toBe(true)
  })

  it('returns false when IP does not match', () => {
    const token = createSession('1.2.3.4', 'StrictAgent/1')
    expect(validateSession(token, '9.9.9.9', 'StrictAgent/1')).toBe(false)
  })

  it('returns false when userAgent does not match', () => {
    const token = createSession('1.2.3.4', 'StrictAgent/1')
    expect(validateSession(token, '1.2.3.4', 'DifferentAgent/2')).toBe(false)
  })

  it('returns true when no ip/ua provided (strict binding inactive without params)', () => {
    const token = createSession('1.2.3.4', 'StrictAgent/1')
    // No ip/ua params → no strict check applied
    expect(validateSession(token)).toBe(true)
  })
})

// ─── validateCsrfToken — expired token ────────────────────────────────────────

describe('validateCsrfToken — edge cases', () => {
  it('returns false for malformed token (no dot)', () => {
    const session = createSession('1.2.3.4', 'UA')
    expect(validateCsrfToken('nodottoken', session)).toBe(false)
  })

  it('returns false when token parts length != 2', () => {
    const session = createSession('1.2.3.4', 'UA')
    expect(validateCsrfToken('a.b.c', session)).toBe(false)
  })

  it('returns false for empty csrfToken', () => {
    const session = createSession('1.2.3.4', 'UA')
    expect(validateCsrfToken('', session)).toBe(false)
  })

  it('returns false for empty sessionToken', () => {
    expect(validateCsrfToken('some.token', '')).toBe(false)
  })

  it('returns false for expired CSRF token (older than 4 hours)', () => {
    const session = createSession('1.2.3.4', 'UA')
    // Create token with timestamp from 5 hours ago
    const fiveHoursAgoMs = Date.now() - 5 * 60 * 60 * 1000
    const timestamp = fiveHoursAgoMs.toString(36)
    const expiredToken = `${timestamp}.fakesignature`
    expect(validateCsrfToken(expiredToken, session)).toBe(false)
  })

  it('returns false for valid timestamp but wrong signature', () => {
    const session = createSession('1.2.3.4', 'UA')
    const timestamp = Date.now().toString(36)
    const wrongSig = 'a'.repeat(48)
    expect(validateCsrfToken(`${timestamp}.${wrongSig}`, session)).toBe(false)
  })

  it('returns false when signature has wrong length (timingSafeEqual mismatch)', () => {
    const session = createSession('1.2.3.4', 'UA')
    const timestamp = Date.now().toString(36)
    expect(validateCsrfToken(`${timestamp}.abc`, session)).toBe(false)
  })
})

// ─── checkRateLimit — locked record ──────────────────────────────────────────

describe('checkRateLimit — locked record', () => {
  it('returns not allowed with retryAfter when IP is locked', () => {
    const ip = '7.7.7.7'
    // Exhaust 5 attempts to trigger lockout
    for (let i = 0; i < 5; i++) {
      recordLoginAttempt(ip, false)
    }
    const result = checkRateLimit(ip)
    expect(result.allowed).toBe(false)
    expect(result.retryAfter).toBeGreaterThan(0)
  })

  it('returns allowed after successful login clears rate limit', () => {
    const ip = '8.8.8.8'
    for (let i = 0; i < 3; i++) {
      recordLoginAttempt(ip, false)
    }
    recordLoginAttempt(ip, true)
    const result = checkRateLimit(ip)
    expect(result.allowed).toBe(true)
  })
})

// ─── getSessionFromCookies ────────────────────────────────────────────────────

describe('getSessionFromCookies', () => {
  it('returns token when cookie exists', async () => {
    mockCookiesGet.mockReturnValue({ value: 'my-session-token' })
    const token = await getSessionFromCookies()
    expect(token).toBe('my-session-token')
  })

  it('returns null when cookie does not exist', async () => {
    mockCookiesGet.mockReturnValue(undefined)
    const token = await getSessionFromCookies()
    expect(token).toBeNull()
  })
})

// ─── setSessionCookie ─────────────────────────────────────────────────────────

describe('setSessionCookie', () => {
  it('calls cookieStore.set with correct params', async () => {
    await setSessionCookie('test-token-123')
    expect(mockCookiesSet).toHaveBeenCalledWith(
      'claos_session',
      'test-token-123',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/'
      })
    )
  })
})

// ─── clearSessionCookie ───────────────────────────────────────────────────────

describe('clearSessionCookie', () => {
  it('calls cookieStore.delete with session cookie name', async () => {
    await clearSessionCookie()
    expect(mockCookiesDelete).toHaveBeenCalledWith('claos_session')
  })
})
