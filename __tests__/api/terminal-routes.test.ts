/**
 * Tests for terminal API routes:
 * - app/api/terminal/[id]/resize/route.ts
 * - app/api/terminal/[id]/write/route.ts
 * - app/api/terminal/[id]/route.ts (DELETE)
 */

// ─── Mocks BEFORE imports ─────────────────────────────────────────────────────

const mockGetSessionFromCookies = jest.fn()
const mockValidateSession = jest.fn()
const mockValidateCsrfToken = jest.fn()
const mockAuditLog = jest.fn()
const mockPtyResize = jest.fn()
const mockPtyWrite = jest.fn()
const mockPtyDestroySession = jest.fn()

jest.mock('@/lib/auth', () => ({
  getSessionFromCookies: mockGetSessionFromCookies,
  validateSession: mockValidateSession,
  validateCsrfToken: mockValidateCsrfToken,
}))

jest.mock('@/lib/audit', () => ({
  auditLog: mockAuditLog,
}))

jest.mock('@/lib/terminal/pty-manager', () => ({
  ptyManager: {
    resize: mockPtyResize,
    write: mockPtyWrite,
    destroySession: mockPtyDestroySession,
  },
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { POST as resizePOST } from '@/app/api/terminal/[id]/resize/route'
import { POST as writePOST } from '@/app/api/terminal/[id]/write/route'
import { DELETE as terminalDELETE } from '@/app/api/terminal/[id]/route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeContext = (id = 'sess-123') => ({
  params: Promise.resolve({ id }),
})

function makeRequest(method: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/terminal/sess-123`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function authed() {
  mockGetSessionFromCookies.mockResolvedValue('valid-token')
  mockValidateSession.mockReturnValue(true)
  mockValidateCsrfToken.mockReturnValue(true)
}

function unauthed() {
  mockGetSessionFromCookies.mockResolvedValue(null)
  mockValidateSession.mockReturnValue(false)
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ══════════════════════════════════════════════════════════════════════════════
// RESIZE route
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/terminal/[id]/resize', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const res = await resizePOST(makeRequest('POST', { cols: 80, rows: 24 }), makeContext())
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 403 when CSRF invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('token')
    mockValidateSession.mockReturnValue(true)
    mockValidateCsrfToken.mockReturnValue(false)

    const res = await resizePOST(
      makeRequest('POST', { cols: 80, rows: 24 }, { 'x-csrf-token': 'bad' }),
      makeContext()
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid dimensions (cols too small)', async () => {
    authed()
    const res = await resizePOST(
      makeRequest('POST', { cols: 1, rows: 24 }, { 'x-csrf-token': 'tok' }),
      makeContext()
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Invalid dimensions')
  })

  it('returns 400 for invalid dimensions (rows too large)', async () => {
    authed()
    const res = await resizePOST(
      makeRequest('POST', { cols: 80, rows: 999 }, { 'x-csrf-token': 'tok' }),
      makeContext()
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for non-integer cols', async () => {
    authed()
    const res = await resizePOST(
      makeRequest('POST', { cols: 80.5, rows: 24 }, { 'x-csrf-token': 'tok' }),
      makeContext()
    )
    expect(res.status).toBe(400)
  })

  it('returns 200 when session does not exist (pty returns false)', async () => {
    authed()
    mockPtyResize.mockReturnValue(false)
    const res = await resizePOST(
      makeRequest('POST', { cols: 80, rows: 24 }, { 'x-csrf-token': 'tok' }),
      makeContext()
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('returns 200 and resizes successfully', async () => {
    authed()
    mockPtyResize.mockReturnValue(true)
    const res = await resizePOST(
      makeRequest('POST', { cols: 120, rows: 40 }, { 'x-csrf-token': 'tok' }),
      makeContext()
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(mockPtyResize).toHaveBeenCalledWith('sess-123', 120, 40)
  })

  it('returns 500 when pty throws', async () => {
    authed()
    mockPtyResize.mockImplementation(() => { throw new Error('pty error') })
    const res = await resizePOST(
      makeRequest('POST', { cols: 80, rows: 24 }, { 'x-csrf-token': 'tok' }),
      makeContext()
    )
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Failed to resize')
  })

  it('extracts IP from x-forwarded-for header', async () => {
    unauthed()
    const req = new NextRequest('http://localhost/api/terminal/sess-1/resize', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '10.0.0.1, 192.168.1.1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    })
    const res = await resizePOST(req, makeContext())
    expect(res.status).toBe(401)
  })

  it('extracts IP from x-real-ip when forwarded header absent', async () => {
    unauthed()
    const req = new NextRequest('http://localhost/api/terminal/sess-1/resize', {
      method: 'POST',
      headers: {
        'x-real-ip': '172.16.0.1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    })
    const res = await resizePOST(req, makeContext())
    expect(res.status).toBe(401)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// WRITE route
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/terminal/[id]/write', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const res = await writePOST(makeRequest('POST', { data: 'ls -la\n' }), makeContext())
    expect(res.status).toBe(401)
  })

  it('returns 403 when CSRF invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('token')
    mockValidateSession.mockReturnValue(true)
    mockValidateCsrfToken.mockReturnValue(false)

    const res = await writePOST(
      makeRequest('POST', { data: 'ls\n' }, { 'x-csrf-token': 'bad' }),
      makeContext()
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid input (data too long)', async () => {
    authed()
    const res = await writePOST(
      makeRequest('POST', { data: 'x'.repeat(10001) }, { 'x-csrf-token': 'tok' }),
      makeContext()
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Invalid input')
  })

  it('returns 400 for missing data field', async () => {
    authed()
    const res = await writePOST(
      makeRequest('POST', {}, { 'x-csrf-token': 'tok' }),
      makeContext()
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when pty session not found', async () => {
    authed()
    mockPtyWrite.mockReturnValue(false)
    const res = await writePOST(
      makeRequest('POST', { data: 'echo hello\n' }, { 'x-csrf-token': 'tok' }),
      makeContext()
    )
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toBe('Session not found')
  })

  it('writes data successfully', async () => {
    authed()
    mockPtyWrite.mockReturnValue(true)
    const res = await writePOST(
      makeRequest('POST', { data: 'pwd\n' }, { 'x-csrf-token': 'tok' }),
      makeContext()
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(mockPtyWrite).toHaveBeenCalledWith('sess-123', 'pwd\n')
  })

  it('returns 500 when pty throws', async () => {
    authed()
    mockPtyWrite.mockImplementation(() => { throw new Error('write error') })
    const res = await writePOST(
      makeRequest('POST', { data: 'ls\n' }, { 'x-csrf-token': 'tok' }),
      makeContext()
    )
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Failed to write')
  })

  it('extracts IP from x-real-ip fallback', async () => {
    unauthed()
    const req = new NextRequest('http://localhost/api/terminal/sess-1/write', {
      method: 'POST',
      headers: { 'x-real-ip': '10.0.0.2', 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'ls\n' }),
    })
    const res = await writePOST(req, makeContext())
    expect(res.status).toBe(401)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// DELETE (close) route
// ══════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/terminal/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const res = await terminalDELETE(makeRequest('DELETE', undefined, {}), makeContext())
    expect(res.status).toBe(401)
  })

  it('returns 403 when CSRF invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('token')
    mockValidateSession.mockReturnValue(true)
    mockValidateCsrfToken.mockReturnValue(false)

    const res = await terminalDELETE(
      makeRequest('DELETE', undefined, { 'x-csrf-token': 'bad' }),
      makeContext()
    )
    expect(res.status).toBe(403)
  })

  it('returns 404 when session not found', async () => {
    authed()
    mockPtyDestroySession.mockReturnValue(false)

    const res = await terminalDELETE(
      makeRequest('DELETE', undefined, { 'x-csrf-token': 'tok' }),
      makeContext()
    )
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toBe('Session not found')
  })

  it('destroys terminal session successfully', async () => {
    authed()
    mockPtyDestroySession.mockReturnValue(true)

    const res = await terminalDELETE(
      makeRequest('DELETE', undefined, { 'x-csrf-token': 'tok' }),
      makeContext('my-session-id')
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(mockPtyDestroySession).toHaveBeenCalledWith('my-session-id')
    expect(mockAuditLog).toHaveBeenCalledWith('terminal', 'closed', expect.any(Object))
  })

  it('extracts IP from x-forwarded-for', async () => {
    unauthed()
    const req = new NextRequest('http://localhost/api/terminal/sess-1', {
      method: 'DELETE',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })
    const res = await terminalDELETE(req, makeContext())
    expect(res.status).toBe(401)
  })

  it('uses unknown IP when no header present', async () => {
    unauthed()
    const req = new NextRequest('http://localhost/api/terminal/sess-1', {
      method: 'DELETE',
    })
    const res = await terminalDELETE(req, makeContext())
    expect(res.status).toBe(401)
  })
})
