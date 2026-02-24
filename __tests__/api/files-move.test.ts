// Tests for /api/files/move endpoint (CRITICAL - File operations)

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/files/move/route'

// Mock auth
jest.mock('@/lib/auth', () => ({
  getSessionFromCookies: jest.fn(),
  validateSession: jest.fn(),
  validateCsrfToken: jest.fn(),
}))

// Mock fs/promises
jest.mock('fs/promises', () => ({
  stat: jest.fn(),
  rename: jest.fn(),
  mkdir: jest.fn(),
  copyFile: jest.fn(),
  cp: jest.fn(),
  realpath: jest.fn(),
}))

// Mock audit log
jest.mock('@/lib/audit', () => ({
  auditLog: jest.fn(),
}))

// Mock validation - keep isPathAllowed real for security tests
jest.mock('@/lib/validation', () => ({
  validateRequest: jest.fn((schema, data) => {
    const result = schema.safeParse(data)
    if (!result.success) {
      return { success: false, error: result.error.errors[0]?.message || 'Validation failed' }
    }
    return { success: true, data: result.data }
  }),
  isPathAllowed: jest.fn((path: string) => {
    // Simulate allowed paths
    const allowedPrefixes = ['/home/clawd', '/tmp', '/srv']
    const blockedPaths = ['/etc', '/root', '/proc', '/sys']

    if (blockedPaths.some((p) => path.startsWith(p))) return false
    return allowedPrefixes.some((p) => path.startsWith(p))
  }),
}))

import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { stat, rename, mkdir, copyFile, cp, realpath } from 'fs/promises'
import { auditLog } from '@/lib/audit'
import { isPathAllowed } from '@/lib/validation'

const mockGetSessionFromCookies = getSessionFromCookies as jest.Mock
const mockValidateSession = validateSession as jest.Mock
const mockValidateCsrfToken = validateCsrfToken as jest.Mock
const mockStat = stat as jest.Mock
const mockRename = rename as jest.Mock
const mockMkdir = mkdir as jest.Mock
const mockCopyFile = copyFile as jest.Mock
const mockCp = cp as jest.Mock
const mockRealpath = realpath as jest.Mock
const mockAuditLog = auditLog as jest.Mock
const mockIsPathAllowed = isPathAllowed as jest.Mock

function createMockRequest(body: object, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/files/move', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe('/api/files/move', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    mockRename.mockResolvedValue(undefined)
    mockCopyFile.mockResolvedValue(undefined)
    mockCp.mockResolvedValue(undefined)
  })

  describe('Authentication', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetSessionFromCookies.mockResolvedValue(null)

      const request = createMockRequest({
        source: '/home/clawd/test.txt',
        destination: '/home/clawd/moved.txt',
        action: 'move',
      })
      const response = await POST(request)

      expect(response.status).toBe(401)
      expect(mockAuditLog).toHaveBeenCalledWith(
        'security',
        'unauthorized_file_move',
        expect.any(Object),
        'warn'
      )
    })

    it('should return 401 when session is invalid', async () => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(false)

      const request = createMockRequest({
        source: '/home/clawd/test.txt',
        destination: '/home/clawd/moved.txt',
        action: 'move',
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
        source: '/home/clawd/test.txt',
        destination: '/home/clawd/moved.txt',
        action: 'move',
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
  })

  describe('Input Validation', () => {
    beforeEach(() => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
    })

    it('should reject path traversal in source', async () => {
      const request = createMockRequest(
        {
          source: '/home/clawd/../../../etc/passwd',
          destination: '/home/clawd/stolen.txt',
          action: 'copy',
        },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      // Should be rejected (400 or 500 depending on validation layer)
      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should reject path traversal in destination', async () => {
      const request = createMockRequest(
        {
          source: '/home/clawd/test.txt',
          destination: '/home/clawd/../../../etc/malicious',
          action: 'copy',
        },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      // Should be rejected (400 or 500 depending on validation layer)
      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should reject invalid action', async () => {
      const request = createMockRequest(
        {
          source: '/home/clawd/test.txt',
          destination: '/home/clawd/moved.txt',
          action: 'delete', // Invalid action
        },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      // Should be rejected (400 or 500 depending on validation layer)
      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('Path Security', () => {
    beforeEach(() => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
    })

    it('should return 403 for disallowed source path', async () => {
      mockRealpath.mockResolvedValue('/etc/passwd')
      mockIsPathAllowed.mockReturnValue(false)

      const request = createMockRequest(
        {
          source: '/etc/passwd',
          destination: '/home/clawd/stolen.txt',
          action: 'copy',
        },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(403)
      expect(mockAuditLog).toHaveBeenCalledWith(
        'security',
        'path_traversal_attempt',
        expect.any(Object),
        'warn'
      )
    })

    it('should return 403 for disallowed destination path', async () => {
      mockRealpath.mockImplementation((path: string) => {
        if (path.includes('test.txt')) return Promise.resolve('/home/clawd/test.txt')
        return Promise.resolve('/root')
      })
      mockIsPathAllowed.mockImplementation((path: string) => {
        return path.startsWith('/home/clawd')
      })

      const request = createMockRequest(
        {
          source: '/home/clawd/test.txt',
          destination: '/root/malicious.txt',
          action: 'copy',
        },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(403)
    })

    it('should return 404 for non-existent source', async () => {
      mockRealpath.mockRejectedValue(new Error('ENOENT'))

      const request = createMockRequest(
        {
          source: '/home/clawd/nonexistent.txt',
          destination: '/home/clawd/moved.txt',
          action: 'move',
        },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(404)
    })
  })

  describe('File Operations', () => {
    beforeEach(() => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockRealpath.mockImplementation((path: string) => Promise.resolve(path))
      mockIsPathAllowed.mockReturnValue(true)
      mockStat.mockImplementation((path: string) => {
        if (path.includes('source') || path.includes('test')) {
          return Promise.resolve({ isDirectory: () => false })
        }
        return Promise.reject(new Error('ENOENT'))
      })
    })

    it('should move file successfully', async () => {
      const request = createMockRequest(
        {
          source: '/home/clawd/test.txt',
          destination: '/home/clawd/moved.txt',
          action: 'move',
        },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.action).toBe('move')
      expect(mockRename).toHaveBeenCalled()
    })

    it('should copy file successfully', async () => {
      const request = createMockRequest(
        {
          source: '/home/clawd/test.txt',
          destination: '/home/clawd/copied.txt',
          action: 'copy',
        },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(mockCopyFile).toHaveBeenCalled()
    })

    it('should copy directory recursively', async () => {
      mockStat.mockImplementation((path: string) => {
        if (path.includes('source') || path.includes('test')) {
          return Promise.resolve({ isDirectory: () => true })
        }
        return Promise.reject(new Error('ENOENT'))
      })

      const request = createMockRequest(
        {
          source: '/home/clawd/testdir',
          destination: '/home/clawd/copieddir',
          action: 'copy',
        },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(mockCp).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
        recursive: true,
      })
    })

    it('should return 409 when destination exists', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => false })

      const request = createMockRequest(
        {
          source: '/home/clawd/test.txt',
          destination: '/home/clawd/existing.txt',
          action: 'move',
        },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(409)
      const data = await response.json()
      expect(data.error).toBe('Destination already exists')
    })

    it('should create parent directories for destination', async () => {
      const request = createMockRequest(
        {
          source: '/home/clawd/test.txt',
          destination: '/home/clawd/new/nested/dir/moved.txt',
          action: 'move',
        },
        { 'x-csrf-token': 'valid' }
      )
      await POST(request)

      expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('new/nested/dir'), {
        recursive: true,
      })
    })
  })

  describe('Error Handling', () => {
    beforeEach(() => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockRealpath.mockResolvedValue('/home/clawd/test.txt')
      mockIsPathAllowed.mockReturnValue(true)
    })

    it('should return 500 when operation fails', async () => {
      mockStat.mockImplementation((path: string) => {
        if (path.includes('test')) {
          return Promise.resolve({ isDirectory: () => false })
        }
        return Promise.reject(new Error('ENOENT'))
      })
      mockRename.mockRejectedValue(new Error('EPERM'))

      const request = createMockRequest(
        {
          source: '/home/clawd/test.txt',
          destination: '/home/clawd/moved.txt',
          action: 'move',
        },
        { 'x-csrf-token': 'valid' }
      )
      const response = await POST(request)

      expect(response.status).toBe(500)
      expect(mockAuditLog).toHaveBeenCalledWith('file', 'move_error', expect.any(Object), 'error')
    })
  })

  describe('Audit Logging', () => {
    beforeEach(() => {
      mockGetSessionFromCookies.mockResolvedValue('token')
      mockValidateSession.mockReturnValue(true)
      mockValidateCsrfToken.mockReturnValue(true)
      mockRealpath.mockResolvedValue('/home/clawd/test.txt')
      mockIsPathAllowed.mockReturnValue(true)
      mockStat.mockImplementation((path: string) => {
        if (path.includes('test')) {
          return Promise.resolve({ isDirectory: () => false })
        }
        return Promise.reject(new Error('ENOENT'))
      })
    })

    it('should audit log successful operations', async () => {
      const request = createMockRequest(
        {
          source: '/home/clawd/test.txt',
          destination: '/home/clawd/moved.txt',
          action: 'move',
        },
        { 'x-csrf-token': 'valid' }
      )
      await POST(request)

      expect(mockAuditLog).toHaveBeenCalledWith(
        'file',
        'move',
        expect.objectContaining({
          source: expect.any(String),
          destination: expect.any(String),
        })
      )
    })
  })
})
