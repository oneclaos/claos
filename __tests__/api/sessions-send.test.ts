// Tests for /api/sessions/send endpoint (CRITICAL - Message sending)

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/sessions/send/route'

// Mock auth
jest.mock('@/lib/auth', () => ({
  getSessionFromCookies: jest.fn(),
  validateSession: jest.fn(),
  validateCsrfToken: jest.fn(),
}))

// Mock gateway sessions
jest.mock('@/lib/gateway/sessions', () => ({
  sendToSession: jest.fn(),
}))

// Mock audit log
jest.mock('@/lib/audit', () => ({
  auditLog: jest.fn(),
}))

// Mock logger
jest.mock('@/lib/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { sendToSession } from '@/lib/gateway/sessions'
import { auditLog } from '@/lib/audit'

const mockGetSessionFromCookies = getSessionFromCookies as jest.Mock
const mockValidateSession = validateSession as jest.Mock
const mockValidateCsrfToken = validateCsrfToken as jest.Mock
const mockSendToSession = sendToSession as jest.Mock
const mockAuditLog = auditLog as jest.Mock

function createMockRequest(body: object, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/sessions/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe('/api/sessions/send', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Authentication', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetSessionFromCookies.mockResolvedValue(null)

      const request = createMockRequest({
        gatewayId: 'test-gw',
        message: 'Hello',
      })
      const response = await POST(request)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 401 when session is invalid', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(false)

      const request = createMockRequest({
        gatewayId: 'test-gw',
        message: 'Hello',
      })
      const response = await POST(request)

      expect(response.status).toBe(401)
    })
  })

  describe('CSRF Protection', () => {
    it('should return 403 when CSRF token is missing', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(false)

      const request = createMockRequest({
        gatewayId: 'test-gw',
        message: 'Hello',
      })
      const response = await POST(request)

      expect(response.status).toBe(403)
      expect(mockAuditLog).toHaveBeenCalledWith(
        'security',
        'csrf_violation',
        expect.any(Object),
        'warn'
      )
    })

    it('should return 403 when CSRF token is invalid', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(false)

      const request = createMockRequest(
        { gatewayId: 'test-gw', message: 'Hello' },
        { 'x-csrf-token': 'invalid-token' }
      )
      const response = await POST(request)

      expect(response.status).toBe(403)
    })
  })

  describe('Input Validation', () => {
    it('should return 400 for missing gatewayId', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)

      const request = createMockRequest({ message: 'Hello' }, { 'x-csrf-token': 'valid' })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('should return 400 for missing message', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)

      const request = createMockRequest({ gatewayId: 'test-gw' }, { 'x-csrf-token': 'valid' })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })
  })

  describe('Message Sending', () => {
    it('should send message successfully', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockSendToSession.mockResolvedValue({
        success: true,
        response: 'Agent response',
      })

      const request = createMockRequest(
        { gatewayId: 'test-gw', message: 'Hello' },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.response).toBe('Agent response')
      expect(mockSendToSession).toHaveBeenCalledWith(
        'test-gw',
        'default',
        'Hello',
        expect.anything()
      )
    })

    it('should use custom sessionKey when provided', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockSendToSession.mockResolvedValue({
        success: true,
        response: 'Response',
      })

      const request = createMockRequest(
        { gatewayId: 'test-gw', sessionKey: 'custom-session', message: 'Hello' },
        { 'x-csrf-token': 'valid' }
      )
      await POST(request)

      expect(mockSendToSession).toHaveBeenCalledWith(
        'test-gw',
        'custom-session',
        'Hello',
        expect.anything()
      )
    })

    it('should pass history when provided', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockSendToSession.mockResolvedValue({
        success: true,
        response: 'Response',
      })

      const history = [
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' },
      ]
      const request = createMockRequest(
        { gatewayId: 'test-gw', message: 'Hello', history },
        { 'x-csrf-token': 'valid' }
      )
      await POST(request)

      expect(mockSendToSession).toHaveBeenCalledWith('test-gw', 'default', 'Hello', history)
    })
  })

  describe('Error Handling', () => {
    it('should return 500 when gateway returns error', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockSendToSession.mockResolvedValue({
        success: false,
        error: 'Gateway unavailable',
      })

      const request = createMockRequest(
        { gatewayId: 'test-gw', message: 'Hello' },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Gateway unavailable')
      expect(mockAuditLog).toHaveBeenCalledWith(
        'gateway',
        'session_send_error',
        expect.any(Object),
        'warn'
      )
    })

    it('should return 500 and hide internal errors', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockSendToSession.mockRejectedValue(new Error('Internal database error'))

      const request = createMockRequest(
        { gatewayId: 'test-gw', message: 'Hello' },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      // Should NOT leak internal error details
      expect(data.error).toBe('Internal server error')
      expect(data.error).not.toContain('database')
    })

    it('should audit log exceptions', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockSendToSession.mockRejectedValue(new Error('Unexpected'))

      const request = createMockRequest(
        { gatewayId: 'test-gw', message: 'Hello' },
        { 'x-csrf-token': 'valid' }
      )
      await POST(request)

      expect(mockAuditLog).toHaveBeenCalledWith(
        'gateway',
        'session_send_exception',
        expect.any(Object),
        'error'
      )
    })
  })
})
