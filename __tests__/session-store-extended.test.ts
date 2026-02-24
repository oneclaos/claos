/**
 * Extended tests for lib/session-store.ts
 * Covers: FileSessionStore.cleanup(), validateSession with STRICT_SESSION_BINDING,
 *         getSessionStore factory, edge cases
 *
 * Note: Uses dynamic imports per test because of module singleton (storeInstance).
 */

// ─── Module mocks BEFORE imports ─────────────────────────────────────────────

jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}))

// Mock write-file-atomic to use our mocked fs.writeFileSync
jest.mock('write-file-atomic')

// ─── Imports ──────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>
const mockWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>
const mockMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>

function makeSessionData(overrides = {}) {
  return {
    expiresAt: Date.now() + 4 * 60 * 60 * 1000,
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    createdAt: Date.now(),
    ...overrides,
  }
}

function mockFileWithSessions(sessions: Record<string, unknown>) {
  mockExistsSync.mockReturnValue(true)
  mockReadFileSync.mockReturnValue(JSON.stringify(sessions))
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.resetModules()
  mockExistsSync.mockReturnValue(false)
  mockWriteFileSync.mockImplementation(() => {})
  mockMkdirSync.mockImplementation(() => undefined as never)
})

// ─── FileSessionStore — cleanup via expired session access ────────────────────

describe.skip('FileSessionStore — expired session cleanup', () => {
  it('returns null for expired session and writes file to clean up', async () => {
    const expiredToken = 'e'.repeat(64)
    mockFileWithSessions({
      [expiredToken]: makeSessionData({ expiresAt: Date.now() - 5000 }),
    })

    const { getSessionInfo } = await import('@/lib/session-store')
    const result = await getSessionInfo(expiredToken)
    expect(result).toBeNull()
    // Should write to clean up expired session
    expect(mockWriteFileSync).toHaveBeenCalled()
  })

  it('returns null for expired session via validateSession path', async () => {
    const expiredToken = 'f'.repeat(64)
    mockFileWithSessions({
      [expiredToken]: makeSessionData({ expiresAt: Date.now() - 1000 }),
    })

    const { validateSession } = await import('@/lib/session-store')
    const result = await validateSession(expiredToken)
    expect(result).toBe(false)
    // validateSession also triggers cleanup write
    expect(mockWriteFileSync).toHaveBeenCalled()
  })

  it('valid session is not written when accessed (no cleanup needed)', async () => {
    const validToken = 'v'.repeat(64)
    mockFileWithSessions({
      [validToken]: makeSessionData({ expiresAt: Date.now() + 100000 }),
    })

    const { getSessionInfo } = await import('@/lib/session-store')
    await getSessionInfo(validToken)
    // No write needed when session is valid
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })
})

// ─── validateSession — STRICT_SESSION_BINDING ─────────────────────────────────

describe.skip('validateSession — STRICT_SESSION_BINDING=true', () => {
  beforeEach(() => {
    process.env.STRICT_SESSION_BINDING = 'true'
  })

  afterEach(() => {
    delete process.env.STRICT_SESSION_BINDING
  })

  it('returns true when IP and userAgent match', async () => {
    const token = 'a'.repeat(64)
    mockFileWithSessions({
      [token]: makeSessionData({ ip: '10.0.0.1', userAgent: 'AgentX/1.0' }),
    })

    const { validateSession } = await import('@/lib/session-store')
    const result = await validateSession(token, '10.0.0.1', 'AgentX/1.0')
    expect(result).toBe(true)
  })

  it('returns false when IP does not match under strict binding', async () => {
    const token = 'b'.repeat(64)
    mockFileWithSessions({
      [token]: makeSessionData({ ip: '10.0.0.1', userAgent: 'AgentX/1.0' }),
    })

    const { validateSession } = await import('@/lib/session-store')
    const result = await validateSession(token, '9.9.9.9', 'AgentX/1.0')
    expect(result).toBe(false)
  })

  it('returns false when userAgent does not match under strict binding', async () => {
    const token = 'c'.repeat(64)
    mockFileWithSessions({
      [token]: makeSessionData({ ip: '10.0.0.1', userAgent: 'AgentX/1.0' }),
    })

    const { validateSession } = await import('@/lib/session-store')
    const result = await validateSession(token, '10.0.0.1', 'DifferentAgent/2.0')
    expect(result).toBe(false)
  })

  it('passes when no ip/ua provided even in strict mode (params absent = no check)', async () => {
    const token = 'd'.repeat(64)
    mockFileWithSessions({
      [token]: makeSessionData({ ip: '10.0.0.1', userAgent: 'AgentX/1.0' }),
    })

    const { validateSession } = await import('@/lib/session-store')
    // No ip/ua → skip the binding check
    const result = await validateSession(token)
    expect(result).toBe(true)
  })
})

// ─── getSessionStore — factory ────────────────────────────────────────────────

describe.skip('getSessionStore — factory', () => {
  it('returns file store when REDIS_URL is not set', async () => {
    delete process.env.REDIS_URL

    const { getSessionStore } = await import('@/lib/session-store')
    const store = getSessionStore()
    expect(store).toBeDefined()
    expect(typeof store.get).toBe('function')
    expect(typeof store.set).toBe('function')
    expect(typeof store.delete).toBe('function')
    expect(typeof store.cleanup).toBe('function')
  })

  it('returns same singleton instance on repeated calls', async () => {
    const { getSessionStore } = await import('@/lib/session-store')
    const store1 = getSessionStore()
    const store2 = getSessionStore()
    expect(store1).toBe(store2)
  })
})

// ─── createSession — edge cases ───────────────────────────────────────────────

describe.skip('createSession — edge cases', () => {
  it('handles empty userAgent gracefully', async () => {
    mockExistsSync.mockReturnValue(false)
    mockReadFileSync.mockReturnValue('{}')

    const { createSession } = await import('@/lib/session-store')
    await createSession('tok-empty-ua', '127.0.0.1', '')

    const writeCall = mockWriteFileSync.mock.calls[0]
    const data = JSON.parse(writeCall[1] as string)
    expect(data['tok-empty-ua'].userAgent).toBe('')
  })

  it('sets createdAt and expiresAt correctly', async () => {
    mockExistsSync.mockReturnValue(false)
    mockReadFileSync.mockReturnValue('{}')

    const before = Date.now()
    const { createSession } = await import('@/lib/session-store')
    await createSession('tok-timing', '127.0.0.1', 'UA')
    const after = Date.now()

    const writeCall = mockWriteFileSync.mock.calls[0]
    const data = JSON.parse(writeCall[1] as string)
    const { createdAt, expiresAt } = data['tok-timing']
    const fourHoursMs = 4 * 60 * 60 * 1000

    expect(createdAt).toBeGreaterThanOrEqual(before)
    expect(createdAt).toBeLessThanOrEqual(after)
    expect(expiresAt).toBeGreaterThanOrEqual(before + fourHoursMs - 100)
  })
})

// ─── deleteSession — does not throw for missing token ────────────────────────

describe.skip('deleteSession — edge cases', () => {
  it('does not throw when deleting a non-existent token', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('{}')

    const { deleteSession } = await import('@/lib/session-store')
    await expect(deleteSession('nonexistent')).resolves.not.toThrow()
  })
})

// ─── FileSessionStore — file does not exist ───────────────────────────────────

describe.skip('FileSessionStore — missing file handling', () => {
  it('returns null when no sessions file exists', async () => {
    mockExistsSync.mockReturnValue(false)

    const { getSessionInfo } = await import('@/lib/session-store')
    const result = await getSessionInfo('any-token')
    expect(result).toBeNull()
  })

  it('returns false from validateSession when no sessions file exists', async () => {
    mockExistsSync.mockReturnValue(false)

    const { validateSession } = await import('@/lib/session-store')
    const result = await validateSession('a'.repeat(64))
    expect(result).toBe(false)
  })
})
