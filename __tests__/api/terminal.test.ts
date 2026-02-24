// Tests for /api/terminal/* endpoints

import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/terminal/route'

// Mock auth module
jest.mock('@/lib/auth', () => ({
  getSessionFromCookies: jest.fn(),
  validateSession: jest.fn(),
  validateCsrfToken: jest.fn(),
}))

// Mock pty manager
jest.mock('@/lib/terminal/pty-manager', () => ({
  ptyManager: {
    listSessions: jest.fn(() => []),
    createSession: jest.fn(),
    getSession: jest.fn(),
    destroySession: jest.fn(),
  },
}))

// Mock audit log
jest.mock('@/lib/audit', () => ({
  auditLog: jest.fn(),
}))

// Mock client info
jest.mock('@/lib/get-client-info', () => ({
  getClientInfo: jest.fn(() => ({ ip: '127.0.0.1', userAgent: 'test-agent' })),
}))

// Mock constants
jest.mock('@/lib/constants', () => ({
  RATE_LIMITS: {
    TERMINAL_MAX_SESSIONS: 5,
  },
}))

import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { ptyManager } from '@/lib/terminal/pty-manager'
import { auditLog } from '@/lib/audit'

const mockGetSessionFromCookies = getSessionFromCookies as jest.Mock
const mockValidateSession = validateSession as jest.Mock
const mockValidateCsrfToken = validateCsrfToken as jest.Mock
const mockPtyManager = ptyManager as jest.Mocked<typeof ptyManager>
const mockAuditLog = auditLog as jest.Mock

function createMockRequest(
  method: string,
  body?: object,
  headers: Record<string, string> = {}
): NextRequest {
  const url = 'http://localhost:3000/api/terminal'
  const init: RequestInit = {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  }
  if (body) {
    init.body = JSON.stringify(body)
  }
  return new NextRequest(url, init)
}

describe('/api/terminal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('GET /api/terminal - List sessions', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetSessionFromCookies.mockResolvedValue(null)

      const request = createMockRequest('GET')
      const response = await GET(request)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 401 when session is invalid', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(false)

      const request = createMockRequest('GET')
      const response = await GET(request)

      expect(response.status).toBe(401)
    })

    it('should return empty sessions list when authenticated', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)
      mockPtyManager.listSessions.mockReturnValue([])

      const request = createMockRequest('GET')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.sessions).toEqual([])
    })

    it('should return sessions list when sessions exist', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)
      mockPtyManager.listSessions.mockReturnValue([
        { id: 'session-1', createdAt: Date.now() },
        { id: 'session-2', createdAt: Date.now() },
      ])

      const request = createMockRequest('GET')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.sessions).toHaveLength(2)
    })
  })

  describe('POST /api/terminal - Create session', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetSessionFromCookies.mockResolvedValue(null)

      const request = createMockRequest('POST')
      const response = await POST(request)

      expect(response.status).toBe(401)
      expect(mockAuditLog).toHaveBeenCalledWith(
        'security',
        'unauthorized_terminal_create',
        expect.any(Object),
        'warn'
      )
    })

    it('should return 401 when session is invalid', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(false)

      const request = createMockRequest('POST')
      const response = await POST(request)

      expect(response.status).toBe(401)
    })

    it('should return 403 when CSRF token is missing', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(false)

      const request = createMockRequest('POST')
      const response = await POST(request)

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Invalid CSRF token')
      expect(mockAuditLog).toHaveBeenCalledWith(
        'security',
        'csrf_violation',
        expect.any(Object),
        'warn'
      )
    })

    it('should return 403 when CSRF token is invalid', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(false)

      const request = createMockRequest('POST', {}, { 'x-csrf-token': 'invalid' })
      const response = await POST(request)

      expect(response.status).toBe(403)
    })

    it('should return 429 when session limit reached', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockPtyManager.listSessions.mockReturnValue([
        { id: '1', createdAt: Date.now() },
        { id: '2', createdAt: Date.now() },
        { id: '3', createdAt: Date.now() },
        { id: '4', createdAt: Date.now() },
        { id: '5', createdAt: Date.now() },
      ])

      const request = createMockRequest('POST', {}, { 'x-csrf-token': 'valid-csrf' })
      const response = await POST(request)

      expect(response.status).toBe(429)
      const data = await response.json()
      expect(data.error).toContain('session limit')
      expect(mockAuditLog).toHaveBeenCalledWith(
        'security',
        'terminal_session_limit_reached',
        expect.any(Object),
        'warn'
      )
    })

    it('should create session successfully', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockPtyManager.listSessions.mockReturnValue([])
      mockPtyManager.createSession.mockReturnValue({
        id: 'new-session-id',
        createdAt: Date.now(),
        pty: {},
      })

      const request = createMockRequest('POST', {}, { 'x-csrf-token': 'valid-csrf' })
      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.sessionId).toBeDefined()
      expect(mockAuditLog).toHaveBeenCalledWith('terminal', 'created', expect.any(Object))
    })

    it('should return 500 when session creation fails', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockPtyManager.listSessions.mockReturnValue([])
      mockPtyManager.createSession.mockReturnValue(null)

      const request = createMockRequest('POST', {}, { 'x-csrf-token': 'valid-csrf' })
      const response = await POST(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Failed to create terminal session')
    })

    it('should return 500 when an exception occurs', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockPtyManager.listSessions.mockReturnValue([])
      mockPtyManager.createSession.mockImplementation(() => {
        throw new Error('PTY creation failed')
      })

      const request = createMockRequest('POST', {}, { 'x-csrf-token': 'valid-csrf' })
      const response = await POST(request)

      expect(response.status).toBe(500)
      expect(mockAuditLog).toHaveBeenCalledWith(
        'terminal',
        'create_error',
        expect.any(Object),
        'error'
      )
    })
  })
})

describe('Terminal Security', () => {
  it('should validate session on every request', async () => {
    mockGetSessionFromCookies.mockResolvedValue('valid-token')
    mockValidateSession.mockReturnValue(true)
    mockPtyManager.listSessions.mockReturnValue([])

    const request = createMockRequest('GET')
    await GET(request)

    expect(mockValidateSession).toHaveBeenCalledWith('valid-token', '127.0.0.1', 'test-agent')
  })

  it('should require CSRF token for state-changing operations', async () => {
    mockGetSessionFromCookies.mockResolvedValue('valid-token')
    mockValidateSession.mockReturnValue(true)
    mockValidateCsrfToken.mockReturnValue(false)

    const request = createMockRequest('POST')
    const response = await POST(request)

    expect(response.status).toBe(403)
  })

  it('should log security events', async () => {
    mockGetSessionFromCookies.mockResolvedValue(null)

    const request = createMockRequest('POST')
    await POST(request)

    expect(mockAuditLog).toHaveBeenCalledWith(
      'security',
      'unauthorized_terminal_create',
      expect.objectContaining({ ip: '127.0.0.1' }),
      'warn'
    )
  })
})
