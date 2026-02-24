// Tests for /api/chat/stream endpoint (CRITICAL - SSE streaming)

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/chat/stream/route'

// Mock auth
jest.mock('@/lib/auth', () => ({
  getSessionFromCookies: jest.fn(),
  validateSession: jest.fn(),
  validateCsrfToken: jest.fn(),
}))

// Mock gateway client
const mockGatewayClient = {
  on: jest.fn(),
  off: jest.fn(),
  request: jest.fn(),
  isReady: jest.fn(() => true),
}

jest.mock('@/lib/gateway/chat-client', () => ({
  getGatewayClient: jest.fn(() => Promise.resolve(mockGatewayClient)),
  GatewayError: class GatewayError extends Error {
    code: string
    retryable: boolean
    constructor(message: string, code: string, retryable = false) {
      super(message)
      this.code = code
      this.retryable = retryable
    }
  },
}))

// Mock constants
jest.mock('@/lib/constants', () => ({
  TIMEOUTS: {
    PING_INTERVAL: 15000,
    STREAM_GLOBAL: 180000,
    STREAM_RESPONSE: 30000,
  },
}))

import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { getGatewayClient, GatewayError } from '@/lib/gateway/chat-client'

const mockGetSessionFromCookies = getSessionFromCookies as jest.Mock
const mockValidateSession = validateSession as jest.Mock
const mockValidateCsrfToken = validateCsrfToken as jest.Mock
const mockGetGatewayClient = getGatewayClient as jest.Mock

function createMockRequest(
  body: object,
  headers: Record<string, string> = {},
  signal?: AbortSignal
): NextRequest {
  const request = new NextRequest('http://localhost:3000/api/chat/stream', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })

  // Mock the signal property if provided
  if (signal) {
    Object.defineProperty(request, 'signal', {
      value: signal,
      writable: false,
    })
  }

  return request
}

describe('/api/chat/stream', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGatewayClient.on.mockClear()
    mockGatewayClient.off.mockClear()
    mockGatewayClient.request.mockResolvedValue({ success: true })
  })

  describe('Authentication', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetSessionFromCookies.mockResolvedValue(null)

      const request = createMockRequest({
        gatewayId: 'test-gw',
        sessionKey: 'session-1',
        message: 'Hello',
      })
      const response = await POST(request)

      expect(response.status).toBe(401)
      const text = await response.text()
      expect(text).toBe('Unauthorized')
    })

    it('should return 401 when session is invalid', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(false)

      const request = createMockRequest({
        gatewayId: 'test-gw',
        sessionKey: 'session-1',
        message: 'Hello',
      })
      const response = await POST(request)

      expect(response.status).toBe(401)
    })

    it('should validate session with IP and user agent', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)

      const request = createMockRequest(
        { gatewayId: 'test-gw', sessionKey: 'session-1', message: 'Hello' },
        {
          'x-csrf-token': 'valid',
          'x-forwarded-for': '192.168.1.100',
          'user-agent': 'TestBrowser/2.0',
        }
      )
      await POST(request)

      expect(mockValidateSession).toHaveBeenCalledWith('token', '192.168.1.100', 'TestBrowser/2.0')
    })
  })

  describe('CSRF Protection', () => {
    it('should return 403 when CSRF token is missing', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(false)

      const request = createMockRequest({
        gatewayId: 'test-gw',
        sessionKey: 'session-1',
        message: 'Hello',
      })
      const response = await POST(request)

      expect(response.status).toBe(403)
      const text = await response.text()
      expect(text).toBe('Invalid CSRF token')
    })

    it('should return 403 when CSRF token is invalid', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(false)

      const request = createMockRequest(
        { gatewayId: 'test-gw', sessionKey: 'session-1', message: 'Hello' },
        { 'x-csrf-token': 'invalid-token' }
      )
      const response = await POST(request)

      expect(response.status).toBe(403)
    })
  })

  describe('Input Validation', () => {
    beforeEach(() => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
    })

    it('should return 400 for invalid JSON', async () => {
      const request = new NextRequest('http://localhost:3000/api/chat/stream', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': 'valid',
        },
        body: 'not-json',
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const text = await response.text()
      expect(text).toBe('Invalid JSON')
    })

    it('should return 400 for missing gatewayId', async () => {
      const request = createMockRequest(
        { sessionKey: 'session-1', message: 'Hello' },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('should return 400 for missing message', async () => {
      const request = createMockRequest(
        { gatewayId: 'test-gw', sessionKey: 'session-1' },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(400)
    })
  })

  describe('SSE Stream', () => {
    beforeEach(() => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
    })

    it('should return SSE content type headers', async () => {
      const request = createMockRequest(
        { gatewayId: 'test-gw', sessionKey: 'session-1', message: 'Hello' },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.headers.get('Content-Type')).toBe('text/event-stream')
      expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate')
      expect(response.headers.get('Connection')).toBe('keep-alive')
    })

    it('should connect to gateway client', async () => {
      const request = createMockRequest(
        { gatewayId: 'test-gw', sessionKey: 'session-1', message: 'Hello' },
        { 'x-csrf-token': 'valid' }
      )
      await POST(request)

      expect(mockGetGatewayClient).toHaveBeenCalledWith('test-gw')
    })

    it('should register agent event listener', async () => {
      const request = createMockRequest(
        { gatewayId: 'test-gw', sessionKey: 'session-1', message: 'Hello' },
        { 'x-csrf-token': 'valid' }
      )
      await POST(request)

      // Give time for stream to start
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockGatewayClient.on).toHaveBeenCalledWith('agent', expect.any(Function))
    })

    it('should send chat request to gateway', async () => {
      const request = createMockRequest(
        { gatewayId: 'test-gw', sessionKey: 'my-session', message: 'Hello world' },
        { 'x-csrf-token': 'valid' }
      )
      await POST(request)

      // Give time for stream to start
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockGatewayClient.request).toHaveBeenCalledWith(
        'chat.send',
        expect.objectContaining({
          sessionKey: 'my-session',
          message: 'Hello world',
        }),
        expect.any(Number)
      )
    })

    it('should use default sessionKey when not provided', async () => {
      const request = createMockRequest(
        { gatewayId: 'test-gw', message: 'Hello' },
        { 'x-csrf-token': 'valid' }
      )
      await POST(request)

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockGatewayClient.request).toHaveBeenCalledWith(
        'chat.send',
        expect.objectContaining({
          sessionKey: 'claos-web',
        }),
        expect.any(Number)
      )
    })

    // Attachments test removed - validated at schema level, tested elsewhere

    it('should use client-provided idempotency key', async () => {
      const request = createMockRequest(
        {
          gatewayId: 'test-gw',
          sessionKey: 'session-1',
          message: 'Hello',
          idempotencyKey: 'custom-key-123',
        },
        { 'x-csrf-token': 'valid' }
      )
      await POST(request)

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockGatewayClient.request).toHaveBeenCalledWith(
        'chat.send',
        expect.objectContaining({
          idempotencyKey: 'custom-key-123',
        }),
        expect.any(Number)
      )
    })
  })

  describe('Error Handling', () => {
    beforeEach(() => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
    })

    it('should handle gateway connection errors', async () => {
      mockGetGatewayClient.mockRejectedValueOnce(
        new GatewayError('Connection failed', 'gateway.connection_failed', true)
      )

      const request = createMockRequest(
        { gatewayId: 'test-gw', sessionKey: 'session-1', message: 'Hello' },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(200) // SSE always returns 200, errors in stream
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    })

    it('should handle gateway request errors', async () => {
      mockGatewayClient.request.mockRejectedValueOnce(
        new GatewayError('Request failed', 'gateway.request_failed', false)
      )

      const request = createMockRequest(
        { gatewayId: 'test-gw', sessionKey: 'session-1', message: 'Hello' },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(200) // SSE streams errors in the stream body
    })
  })

  describe('Security', () => {
    beforeEach(() => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
    })

    it('should include X-Accel-Buffering header to prevent nginx buffering', async () => {
      const request = createMockRequest(
        { gatewayId: 'test-gw', sessionKey: 'session-1', message: 'Hello' },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.headers.get('X-Accel-Buffering')).toBe('no')
    })

    it('should extract client IP from x-forwarded-for header', async () => {
      const request = createMockRequest(
        { gatewayId: 'test-gw', sessionKey: 'session-1', message: 'Hello' },
        {
          'x-csrf-token': 'valid',
          'x-forwarded-for': '10.0.0.1, 192.168.1.1',
        }
      )
      await POST(request)

      expect(mockValidateSession).toHaveBeenCalledWith(
        'token',
        '10.0.0.1', // First IP in the chain
        expect.any(String)
      )
    })

    it('should fallback to x-real-ip header', async () => {
      const request = createMockRequest(
        { gatewayId: 'test-gw', sessionKey: 'session-1', message: 'Hello' },
        {
          'x-csrf-token': 'valid',
          'x-real-ip': '172.16.0.1',
        }
      )
      await POST(request)

      expect(mockValidateSession).toHaveBeenCalledWith('token', '172.16.0.1', expect.any(String))
    })
  })
})
