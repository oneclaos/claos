// Tests for /api/chat/* endpoints

import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/chat/route'
import { GET as getHistory } from '@/app/api/chat/history/route'
import { GET as getSessions } from '@/app/api/chat/sessions/route'
import { GET as warmup } from '@/app/api/chat/warmup/route'

// Mock auth module
jest.mock('@/lib/auth', () => ({
  getSessionFromCookies: jest.fn(),
  validateSession: jest.fn(),
  validateCsrfToken: jest.fn(),
}))

// Mock gateway client
jest.mock('@/lib/gateway/chat-client', () => ({
  sendChatMessage: jest.fn(),
  parseGatewaysConfig: jest.fn(() => [
    { id: 'test-gw', name: 'Test Gateway', url: 'ws://localhost:18789', token: 'test' },
  ]),
  getGatewayClient: jest.fn(),
  listSessions: jest.fn(() => []),
  getSessionHistory: jest.fn(() => ({ messages: [] })),
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

// Mock client info
jest.mock('@/lib/get-client-info', () => ({
  getClientInfo: jest.fn(() => ({ ip: '127.0.0.1', userAgent: 'test-agent' })),
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
import { sendChatMessage, GatewayError } from '@/lib/gateway/chat-client'

const mockGetSessionFromCookies = getSessionFromCookies as jest.Mock
const mockValidateSession = validateSession as jest.Mock
const mockValidateCsrfToken = validateCsrfToken as jest.Mock
const mockSendChatMessage = sendChatMessage as jest.Mock

function createMockRequest(
  method: string,
  body?: object,
  headers: Record<string, string> = {}
): NextRequest {
  const url = 'http://localhost:3000/api/chat'
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

describe('/api/chat', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('GET /api/chat - List gateways', () => {
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

    it('should return gateways when authenticated', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)

      const request = createMockRequest('GET')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.gateways).toHaveLength(1)
      expect(data.gateways[0].id).toBe('test-gw')
    })
  })

  describe('POST /api/chat - Send message', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetSessionFromCookies.mockResolvedValue(null)

      const request = createMockRequest('POST', {
        gatewayId: 'test-gw',
        sessionKey: 'session-1',
        message: 'Hello',
      })
      const response = await POST(request)

      expect(response.status).toBe(401)
    })

    it('should return 403 when CSRF token is invalid', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(false)

      const request = createMockRequest(
        'POST',
        { gatewayId: 'test-gw', sessionKey: 'session-1', message: 'Hello' },
        { 'x-csrf-token': 'invalid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Invalid CSRF token')
    })

    it('should return 400 for invalid request body', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)

      const request = createMockRequest(
        'POST',
        { gatewayId: 'test-gw' }, // Missing required fields
        { 'x-csrf-token': 'valid-csrf' }
      )
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('should send message when valid', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockSendChatMessage.mockResolvedValue({ text: 'Response from agent' })

      const request = createMockRequest(
        'POST',
        { gatewayId: 'test-gw', sessionKey: 'session-1', message: 'Hello' },
        { 'x-csrf-token': 'valid-csrf' }
      )
      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.response.text).toBe('Response from agent')
      expect(mockSendChatMessage).toHaveBeenCalledWith('test-gw', {
        sessionKey: 'session-1',
        message: 'Hello',
      })
    })

    it('should handle gateway not found error', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockSendChatMessage.mockRejectedValue(
        new GatewayError('Gateway not found', 'gateway.not_found', false)
      )

      const request = createMockRequest(
        'POST',
        { gatewayId: 'unknown-gw', sessionKey: 'session-1', message: 'Hello' },
        { 'x-csrf-token': 'valid-csrf' }
      )
      const response = await POST(request)

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.code).toBe('gateway.not_found')
    })

    it('should handle gateway token invalid error', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockSendChatMessage.mockRejectedValue(
        new GatewayError('Invalid token', 'gateway.token_invalid', false)
      )

      const request = createMockRequest(
        'POST',
        { gatewayId: 'test-gw', sessionKey: 'session-1', message: 'Hello' },
        { 'x-csrf-token': 'valid-csrf' }
      )
      const response = await POST(request)

      expect(response.status).toBe(401)
    })

    it('should handle gateway unavailable error', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockSendChatMessage.mockRejectedValue(
        new GatewayError('Gateway unavailable', 'gateway.unavailable', true)
      )

      const request = createMockRequest(
        'POST',
        { gatewayId: 'test-gw', sessionKey: 'session-1', message: 'Hello' },
        { 'x-csrf-token': 'valid-csrf' }
      )
      const response = await POST(request)

      expect(response.status).toBe(503)
      const data = await response.json()
      expect(data.retryable).toBe(true)
    })

    it('should handle unknown errors', async () => {
      mockGetSessionFromCookies.mockResolvedValue('valid-token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockSendChatMessage.mockRejectedValue(new Error('Unknown error'))

      const request = createMockRequest(
        'POST',
        { gatewayId: 'test-gw', sessionKey: 'session-1', message: 'Hello' },
        { 'x-csrf-token': 'valid-csrf' }
      )
      const response = await POST(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.code).toBe('gateway.unknown')
    })
  })
})

describe('/api/chat/history', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return 401 when not authenticated', async () => {
    mockGetSessionFromCookies.mockResolvedValue(null)

    const request = new NextRequest(
      'http://localhost:3000/api/chat/history?gatewayId=test-gw&sessionKey=session-1'
    )
    const response = await getHistory(request)

    expect(response.status).toBe(401)
  })

  it('should return 401 when session is invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('valid-token')
    mockValidateSession.mockReturnValue(false)

    const request = new NextRequest(
      'http://localhost:3000/api/chat/history?gatewayId=test-gw&sessionKey=session-1'
    )
    const response = await getHistory(request)

    expect(response.status).toBe(401)
  })
})

describe('/api/chat/sessions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return 401 when not authenticated', async () => {
    mockGetSessionFromCookies.mockResolvedValue(null)

    const request = new NextRequest('http://localhost:3000/api/chat/sessions?gatewayId=test-gw')
    const response = await getSessions(request)

    expect(response.status).toBe(401)
  })

  it('should return 401 when session is invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('valid-token')
    mockValidateSession.mockReturnValue(false)

    const request = new NextRequest('http://localhost:3000/api/chat/sessions?gatewayId=test-gw')
    const response = await getSessions(request)

    expect(response.status).toBe(401)
  })
})

describe('/api/chat/warmup', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return 401 when not authenticated', async () => {
    mockGetSessionFromCookies.mockResolvedValue(null)

    const response = await warmup()

    expect(response.status).toBe(401)
  })

  it('should return 401 when session is invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('valid-token')
    mockValidateSession.mockReturnValue(false)

    const response = await warmup()

    expect(response.status).toBe(401)
  })
})
