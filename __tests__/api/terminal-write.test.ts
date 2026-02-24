// Tests for /api/terminal/[id]/write endpoint (CRITICAL - Terminal input)

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/terminal/[id]/write/route'

// Mock auth
jest.mock('@/lib/auth', () => ({
  getSessionFromCookies: jest.fn(),
  validateSession: jest.fn(),
  validateCsrfToken: jest.fn(),
}))

// Mock pty manager
jest.mock('@/lib/terminal/pty-manager', () => ({
  ptyManager: {
    write: jest.fn(),
  },
}))

import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { ptyManager } from '@/lib/terminal/pty-manager'

const mockGetSessionFromCookies = getSessionFromCookies as jest.Mock
const mockValidateSession = validateSession as jest.Mock
const mockValidateCsrfToken = validateCsrfToken as jest.Mock
const mockPtyManagerWrite = ptyManager.write as jest.Mock

function createMockRequest(body: object, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/terminal/session-123/write', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function createContext(id: string = 'session-123') {
  return {
    params: Promise.resolve({ id }),
  }
}

describe('/api/terminal/[id]/write', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Authentication', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetSessionFromCookies.mockResolvedValue(null)

      const request = createMockRequest({ data: 'ls\n' })
      const response = await POST(request, createContext())

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 401 when session is invalid', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(false)

      const request = createMockRequest({ data: 'ls\n' })
      const response = await POST(request, createContext())

      expect(response.status).toBe(401)
    })

    it('should validate session with IP and user agent', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockPtyManagerWrite.mockReturnValue(true)

      const request = createMockRequest(
        { data: 'ls\n' },
        {
          'x-csrf-token': 'valid',
          'x-forwarded-for': '192.168.1.1',
          'user-agent': 'TestBrowser/1.0',
        }
      )
      await POST(request, createContext())

      expect(mockValidateSession).toHaveBeenCalledWith('token', '192.168.1.1', 'TestBrowser/1.0')
    })
  })

  describe('CSRF Protection', () => {
    it('should return 403 when CSRF token is missing', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(false)

      const request = createMockRequest({ data: 'ls\n' })
      const response = await POST(request, createContext())

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Invalid CSRF token')
    })

    it('should return 403 when CSRF token is invalid', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(false)

      const request = createMockRequest({ data: 'ls\n' }, { 'x-csrf-token': 'invalid' })
      const response = await POST(request, createContext())

      expect(response.status).toBe(403)
    })
  })

  describe('Input Validation', () => {
    it('should return 400 for missing data field', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)

      const request = createMockRequest({}, { 'x-csrf-token': 'valid' })
      const response = await POST(request, createContext())

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Invalid input')
    })

    it('should return 400 for data exceeding max length', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)

      // Create string longer than 10000 chars
      const longData = 'x'.repeat(10001)
      const request = createMockRequest({ data: longData }, { 'x-csrf-token': 'valid' })
      const response = await POST(request, createContext())

      expect(response.status).toBe(400)
    })
  })

  describe('Terminal Write', () => {
    it('should write data to terminal successfully', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockPtyManagerWrite.mockReturnValue(true)

      const request = createMockRequest({ data: 'ls -la\n' }, { 'x-csrf-token': 'valid' })
      const response = await POST(request, createContext('session-456'))

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(mockPtyManagerWrite).toHaveBeenCalledWith('session-456', 'ls -la\n')
    })

    it('should return 404 when session not found', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockPtyManagerWrite.mockReturnValue(false)

      const request = createMockRequest({ data: 'ls\n' }, { 'x-csrf-token': 'valid' })
      const response = await POST(request, createContext('non-existent'))

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Session not found')
    })

    it('should handle special characters in terminal input', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockPtyManagerWrite.mockReturnValue(true)

      // Test with escape sequences, unicode, etc.
      const specialData = '\x1b[A\x1b[B\u0003echo "test"\n'
      const request = createMockRequest({ data: specialData }, { 'x-csrf-token': 'valid' })
      const response = await POST(request, createContext())

      expect(response.status).toBe(200)
      expect(mockPtyManagerWrite).toHaveBeenCalledWith('session-123', specialData)
    })
  })

  describe('Error Handling', () => {
    it('should return 500 when write throws an error', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockPtyManagerWrite.mockImplementation(() => {
        throw new Error('PTY write failed')
      })

      const request = createMockRequest({ data: 'ls\n' }, { 'x-csrf-token': 'valid' })
      const response = await POST(request, createContext())

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Failed to write')
    })
  })

  describe('Security', () => {
    it('should use session ID from URL params', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockPtyManagerWrite.mockReturnValue(true)

      const request = createMockRequest({ data: 'ls\n' }, { 'x-csrf-token': 'valid' })
      await POST(request, createContext('specific-session-id'))

      expect(mockPtyManagerWrite).toHaveBeenCalledWith('specific-session-id', expect.any(String))
    })
  })
})
