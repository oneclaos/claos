/**
 * Tests for lib/audit.ts
 * Audit logging — mocks fs
 */

// ─── Module mocks BEFORE imports ─────────────────────────────────────────────

jest.mock('fs', () => ({
  appendFileSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  statSync: jest.fn(),
  renameSync: jest.fn(),
  unlinkSync: jest.fn(),
}))

import { appendFileSync, existsSync, mkdirSync, statSync } from 'fs'

const mockAppendFileSync = appendFileSync as jest.MockedFunction<typeof appendFileSync>
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>
const mockMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>
const mockStatSync = statSync as jest.MockedFunction<typeof statSync>

beforeEach(() => {
  jest.clearAllMocks()
  mockExistsSync.mockReturnValue(true) // Dirs exist
  mockAppendFileSync.mockImplementation(() => {})
  mockMkdirSync.mockImplementation(() => undefined as never)
  mockStatSync.mockReturnValue({ size: 100 } as ReturnType<typeof statSync>) // Small file, no rotation
})

describe('auditLog', () => {
  it('writes a JSON log line to file', async () => {
    const { auditLog } = await import('@/lib/audit')
    auditLog('auth', 'login', { user: 'admin' })

    expect(mockAppendFileSync).toHaveBeenCalled()
    const callArgs = mockAppendFileSync.mock.calls[0]
    const logLine = JSON.parse((callArgs[1] as string).trim())
    expect(logLine.category).toBe('auth')
    expect(logLine.action).toBe('login')
    expect(logLine.level).toBe('info')
  })

  it('redacts sensitive fields', async () => {
    const { auditLog } = await import('@/lib/audit')
    auditLog('auth', 'login', { password: 'secret123', token: 'my-token', user: 'admin' })

    const callArgs = mockAppendFileSync.mock.calls[0]
    const logLine = JSON.parse((callArgs[1] as string).trim())
    expect(logLine.details.password).toBe('[REDACTED]')
    expect(logLine.details.token).toBe('[REDACTED]')
    expect(logLine.details.user).toBe('admin') // Non-sensitive kept
  })

  it('truncates long string values', async () => {
    const { auditLog } = await import('@/lib/audit')
    auditLog('file', 'read', { path: 'x'.repeat(600) })

    const callArgs = mockAppendFileSync.mock.calls[0]
    const logLine = JSON.parse((callArgs[1] as string).trim())
    expect(logLine.details.path.length).toBeLessThanOrEqual(520) // 500 + '...[truncated]'
    expect(logLine.details.path).toContain('[truncated]')
  })

  it('writes with warn level', async () => {
    const { auditLog } = await import('@/lib/audit')
    auditLog('security', 'brute_force', { ip: '1.2.3.4' }, 'warn')

    const callArgs = mockAppendFileSync.mock.calls[0]
    const logLine = JSON.parse((callArgs[1] as string).trim())
    expect(logLine.level).toBe('warn')
  })

  it('writes with error level', async () => {
    const { auditLog } = await import('@/lib/audit')
    auditLog('system', 'crash', {}, 'error')

    const callArgs = mockAppendFileSync.mock.calls[0]
    const logLine = JSON.parse((callArgs[1] as string).trim())
    expect(logLine.level).toBe('error')
  })

  it('creates audit directory if it does not exist', async () => {
    mockExistsSync.mockReturnValue(false)

    const { auditLog } = await import('@/lib/audit')
    auditLog('system', 'startup', {})

    expect(mockMkdirSync).toHaveBeenCalled()
  })

  it('logs a timestamp', async () => {
    const { auditLog } = await import('@/lib/audit')
    const before = new Date().toISOString()
    auditLog('gateway', 'connect', {})
    const after = new Date().toISOString()

    const callArgs = mockAppendFileSync.mock.calls[0]
    const logLine = JSON.parse((callArgs[1] as string).trim())
    expect(logLine.timestamp >= before).toBe(true)
    expect(logLine.timestamp <= after).toBe(true)
  })

  it('handles appendFileSync throwing gracefully', async () => {
    mockAppendFileSync.mockImplementation(() => { throw new Error('disk full') })

    const { auditLog } = await import('@/lib/audit')
    // Should not throw
    expect(() => auditLog('system', 'test', {})).not.toThrow()
  })
})

describe('audit convenience object', () => {
  it('audit.auth logs to auth category', async () => {
    const { audit } = await import('@/lib/audit')
    audit.auth('login', { user: 'admin' })

    const callArgs = mockAppendFileSync.mock.calls[0]
    const logLine = JSON.parse((callArgs[1] as string).trim())
    expect(logLine.category).toBe('auth')
  })

  it('audit.file logs to file category', async () => {
    const { audit } = await import('@/lib/audit')
    audit.file('read', { path: '/etc/passwd' })

    const callArgs = mockAppendFileSync.mock.calls[0]
    const logLine = JSON.parse((callArgs[1] as string).trim())
    expect(logLine.category).toBe('file')
  })

  it('audit.gateway logs to gateway category', async () => {
    const { audit } = await import('@/lib/audit')
    audit.gateway('connect', { id: 'gw1' })

    const callArgs = mockAppendFileSync.mock.calls[0]
    const logLine = JSON.parse((callArgs[1] as string).trim())
    expect(logLine.category).toBe('gateway')
  })

  it('audit.group logs to group category', async () => {
    const { audit } = await import('@/lib/audit')
    audit.group('created', { groupId: 'g1' })

    const callArgs = mockAppendFileSync.mock.calls[0]
    const logLine = JSON.parse((callArgs[1] as string).trim())
    expect(logLine.category).toBe('group')
  })

  it('audit.system logs to system category', async () => {
    const { audit } = await import('@/lib/audit')
    audit.system('startup', {})

    const callArgs = mockAppendFileSync.mock.calls[0]
    const logLine = JSON.parse((callArgs[1] as string).trim())
    expect(logLine.category).toBe('system')
  })

  it('audit.security logs to security category with warn level', async () => {
    const { audit } = await import('@/lib/audit')
    audit.security('brute_force', { ip: '1.2.3.4' })

    const callArgs = mockAppendFileSync.mock.calls[0]
    const logLine = JSON.parse((callArgs[1] as string).trim())
    expect(logLine.category).toBe('security')
    expect(logLine.level).toBe('warn')
  })
})
