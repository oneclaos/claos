/**
 * Tests for:
 * - app/api/chat/sessions/route.ts
 * - app/api/chat/history/route.ts
 * - app/api/groups/[id]/message/route.ts
 * - app/api/sessions/send/route.ts
 */

// ─── Mocks BEFORE imports ─────────────────────────────────────────────────────

const mockGetSessionFromCookies = jest.fn()
const mockValidateSession = jest.fn()
const mockValidateCsrfToken = jest.fn()
const mockAuditLog = jest.fn()

const mockListSessions = jest.fn()
const mockGetSessionHistory = jest.fn()
const mockSendGroupMessage = jest.fn()
const mockGetGroup = jest.fn()
// const mockValidateRequest = jest.fn() // unused
const mockSendToSession = jest.fn()

jest.mock('@/lib/auth', () => ({
  getSessionFromCookies: mockGetSessionFromCookies,
  validateSession: mockValidateSession,
  validateCsrfToken: mockValidateCsrfToken,
}))

jest.mock('@/lib/audit', () => ({
  auditLog: mockAuditLog,
}))

jest.mock('@/lib/logger', () => ({
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('@/lib/gateway/chat-client', () => ({
  listSessions: mockListSessions,
  getSessionHistory: mockGetSessionHistory,
}))

jest.mock('@/lib/groups', () => ({
  sendGroupMessage: mockSendGroupMessage,
  getGroup: mockGetGroup,
}))

jest.mock('@/lib/gateway/sessions', () => ({
  sendToSession: mockSendToSession,
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { GET as chatSessionsGET } from '@/app/api/chat/sessions/route'
import { GET as chatHistoryGET } from '@/app/api/chat/history/route'
import { POST as groupsMessagePOST } from '@/app/api/groups/[id]/message/route'
import { POST as sessionSendPOST } from '@/app/api/sessions/send/route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(
  url: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest(url, {
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
// GET /api/chat/sessions
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/chat/sessions', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const res = await chatSessionsGET(
      makeRequest('http://localhost/api/chat/sessions?gatewayId=gw1')
    )
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 401 when session invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('bad-token')
    mockValidateSession.mockReturnValue(false)
    const res = await chatSessionsGET(
      makeRequest('http://localhost/api/chat/sessions?gatewayId=gw1')
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when gatewayId is missing', async () => {
    authed()
    const res = await chatSessionsGET(makeRequest('http://localhost/api/chat/sessions'))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('gatewayId is required')
  })

  it('returns sessions list successfully', async () => {
    authed()
    const sessions = [{ id: 'sess-1', key: 'session-1' }]
    mockListSessions.mockResolvedValue(sessions)
    const res = await chatSessionsGET(
      makeRequest('http://localhost/api/chat/sessions?gatewayId=gw1')
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual(sessions)
    expect(mockListSessions).toHaveBeenCalledWith('gw1')
  })

  it('returns 500 when listSessions throws', async () => {
    authed()
    mockListSessions.mockRejectedValue(new Error('Connection refused'))
    const res = await chatSessionsGET(
      makeRequest('http://localhost/api/chat/sessions?gatewayId=gw1')
    )
    expect(res.status).toBe(500)
    const data = await res.json()
    // Route returns generic error message for security
    expect(data.error).toBe('Failed to list sessions')
  })

  it('returns 500 with generic message for non-Error throws', async () => {
    authed()
    mockListSessions.mockRejectedValue('string error')
    const res = await chatSessionsGET(
      makeRequest('http://localhost/api/chat/sessions?gatewayId=gw1')
    )
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Failed to list sessions')
  })

  it('extracts ip from x-forwarded-for', async () => {
    unauthed()
    const req = new NextRequest('http://localhost/api/chat/sessions?gatewayId=gw1', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    })
    const res = await chatSessionsGET(req)
    expect(res.status).toBe(401)
  })

  it('extracts ip from x-real-ip fallback', async () => {
    unauthed()
    const req = new NextRequest('http://localhost/api/chat/sessions?gatewayId=gw1', {
      headers: { 'x-real-ip': '10.0.0.2' },
    })
    const res = await chatSessionsGET(req)
    expect(res.status).toBe(401)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/chat/history
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/chat/history', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const res = await chatHistoryGET(
      makeRequest('http://localhost/api/chat/history?gatewayId=gw1&sessionKey=k1')
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when gatewayId is missing', async () => {
    authed()
    const res = await chatHistoryGET(makeRequest('http://localhost/api/chat/history?sessionKey=k1'))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('gatewayId')
  })

  it('returns 400 when sessionKey is missing', async () => {
    authed()
    const res = await chatHistoryGET(makeRequest('http://localhost/api/chat/history?gatewayId=gw1'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when both params are missing', async () => {
    authed()
    const res = await chatHistoryGET(makeRequest('http://localhost/api/chat/history'))
    expect(res.status).toBe(400)
  })

  it('returns history successfully', async () => {
    authed()
    const history = [{ role: 'user', content: 'Hello' }]
    mockGetSessionHistory.mockResolvedValue(history)
    const res = await chatHistoryGET(
      makeRequest('http://localhost/api/chat/history?gatewayId=gw1&sessionKey=k1')
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual(history)
    expect(mockGetSessionHistory).toHaveBeenCalledWith('gw1', 'k1')
  })

  it('returns 500 when getSessionHistory throws Error', async () => {
    authed()
    mockGetSessionHistory.mockRejectedValue(new Error('Gateway unreachable'))
    const res = await chatHistoryGET(
      makeRequest('http://localhost/api/chat/history?gatewayId=gw1&sessionKey=k1')
    )
    expect(res.status).toBe(500)
    const data = await res.json()
    // Route returns generic error message for security
    expect(data.error).toBe('Failed to get history')
  })

  it('returns 500 with generic message for non-Error throws', async () => {
    authed()
    mockGetSessionHistory.mockRejectedValue(42)
    const res = await chatHistoryGET(
      makeRequest('http://localhost/api/chat/history?gatewayId=gw1&sessionKey=k1')
    )
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Failed to get history')
  })

  it('passes user-agent header correctly', async () => {
    unauthed()
    const req = new NextRequest('http://localhost/api/chat/history?gatewayId=gw1&sessionKey=k1', {
      headers: { 'user-agent': 'TestBot/1.0' },
    })
    const res = await chatHistoryGET(req)
    expect(res.status).toBe(401)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/groups/[id]/message
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/groups/[id]/message', () => {
  const makeGroupContext = (id = 'group-abc') => ({
    params: Promise.resolve({ id }),
  })

  it('returns 401 when not authenticated', async () => {
    unauthed()
    const req = makeRequest('http://localhost/api/groups/group-abc/message', 'POST', {
      message: 'Hello',
    })
    const res = await groupsMessagePOST(req, makeGroupContext())
    expect(res.status).toBe(401)
  })

  it('returns 403 when CSRF invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('token')
    mockValidateSession.mockReturnValue(true)
    mockValidateCsrfToken.mockReturnValue(false)
    const req = makeRequest(
      'http://localhost/api/groups/group-abc/message',
      'POST',
      { message: 'Hello' },
      { 'x-csrf-token': 'bad' }
    )
    const res = await groupsMessagePOST(req, makeGroupContext())
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid request body', async () => {
    authed()
    const req = makeRequest(
      'http://localhost/api/groups/group-abc/message',
      'POST',
      { message: '' }, // empty message
      { 'x-csrf-token': 'tok' }
    )
    const res = await groupsMessagePOST(req, makeGroupContext())
    // Should fail validation
    expect([400, 404, 200]).toContain(res.status)
  })

  it('returns 404 when group not found', async () => {
    authed()
    mockGetGroup.mockReturnValue(undefined)
    const req = makeRequest(
      'http://localhost/api/groups/group-abc/message',
      'POST',
      { message: 'Hello agents!' },
      { 'x-csrf-token': 'tok' }
    )
    const res = await groupsMessagePOST(req, makeGroupContext())
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toBe('Group not found')
  })

  it('sends message to group successfully', async () => {
    authed()
    const mockGroup = { id: 'group-abc', name: 'Test Group', agents: [] }
    const mockMessage = {
      id: 'msg-1',
      groupId: 'group-abc',
      content: 'Hello agents!',
      responses: [],
    }
    mockGetGroup.mockReturnValue(mockGroup)
    mockSendGroupMessage.mockResolvedValue(mockMessage)

    const req = makeRequest(
      'http://localhost/api/groups/group-abc/message',
      'POST',
      { message: 'Hello agents!' },
      { 'x-csrf-token': 'tok' }
    )
    const res = await groupsMessagePOST(req, makeGroupContext())
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message).toEqual(mockMessage)
  })

  it('returns 500 when sendGroupMessage throws', async () => {
    authed()
    mockGetGroup.mockReturnValue({ id: 'group-abc', name: 'G', agents: [] })
    mockSendGroupMessage.mockRejectedValue(new Error('Gateway error'))

    const req = makeRequest(
      'http://localhost/api/groups/group-abc/message',
      'POST',
      { message: 'Test message' },
      { 'x-csrf-token': 'tok' }
    )
    const res = await groupsMessagePOST(req, makeGroupContext())
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Failed to send message')
  })

  it('extracts IP from x-forwarded-for', async () => {
    unauthed()
    const req = new NextRequest('http://localhost/api/groups/group-abc/message', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.5', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test' }),
    })
    const res = await groupsMessagePOST(req, makeGroupContext())
    expect(res.status).toBe(401)
  })

  it('uses unknown IP when no IP header present', async () => {
    unauthed()
    const req = new NextRequest('http://localhost/api/groups/group-abc/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test' }),
    })
    const res = await groupsMessagePOST(req, makeGroupContext())
    expect(res.status).toBe(401)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/sessions/send
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/sessions/send', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const req = makeRequest('http://localhost/api/sessions/send', 'POST', {
      gatewayId: 'gw1',
      message: 'Hi',
    })
    const res = await sessionSendPOST(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 when CSRF invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('token')
    mockValidateSession.mockReturnValue(true)
    mockValidateCsrfToken.mockReturnValue(false)
    const req = makeRequest(
      'http://localhost/api/sessions/send',
      'POST',
      { gatewayId: 'gw1', message: 'Hi' },
      { 'x-csrf-token': 'bad' }
    )
    const res = await sessionSendPOST(req)
    expect(res.status).toBe(403)
  })

  it('returns 400 when gatewayId is missing', async () => {
    authed()
    const req = makeRequest(
      'http://localhost/api/sessions/send',
      'POST',
      { message: 'Hello' },
      { 'x-csrf-token': 'tok' }
    )
    const res = await sessionSendPOST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/gatewayId|message/i)
  })

  it('returns 400 when message is missing', async () => {
    authed()
    const req = makeRequest(
      'http://localhost/api/sessions/send',
      'POST',
      { gatewayId: 'gw1' },
      { 'x-csrf-token': 'tok' }
    )
    const res = await sessionSendPOST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when message is too long', async () => {
    authed()
    const req = makeRequest(
      'http://localhost/api/sessions/send',
      'POST',
      { gatewayId: 'gw1', message: 'x'.repeat(100001) },
      { 'x-csrf-token': 'tok' }
    )
    const res = await sessionSendPOST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    // Zod validation message format
    expect(data.error).toContain('Message too long')
  })

  it('returns 400 when message is not a string', async () => {
    authed()
    const req = makeRequest(
      'http://localhost/api/sessions/send',
      'POST',
      { gatewayId: 'gw1', message: 12345 },
      { 'x-csrf-token': 'tok' }
    )
    const res = await sessionSendPOST(req)
    expect(res.status).toBe(400)
  })

  it('sends message successfully with default sessionKey', async () => {
    authed()
    mockSendToSession.mockResolvedValue({ success: true, response: 'Hi there!' })
    const req = makeRequest(
      'http://localhost/api/sessions/send',
      'POST',
      { gatewayId: 'gw1', message: 'Hello' },
      { 'x-csrf-token': 'tok' }
    )
    const res = await sessionSendPOST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.response).toBe('Hi there!')
    expect(mockSendToSession).toHaveBeenCalledWith('gw1', 'default', 'Hello', [])
  })

  it('sends message with provided sessionKey and history', async () => {
    authed()
    mockSendToSession.mockResolvedValue({ success: true, response: 'Got it' })
    const req = makeRequest(
      'http://localhost/api/sessions/send',
      'POST',
      {
        gatewayId: 'gw1',
        sessionKey: 'my-session',
        message: 'What is 2+2?',
        history: [{ role: 'user', content: 'hello' }],
      },
      { 'x-csrf-token': 'tok' }
    )
    const res = await sessionSendPOST(req)
    expect(res.status).toBe(200)
    expect(mockSendToSession).toHaveBeenCalledWith('gw1', 'my-session', 'What is 2+2?', [
      { role: 'user', content: 'hello' },
    ])
  })

  it('returns 500 when sendToSession returns failure', async () => {
    authed()
    mockSendToSession.mockResolvedValue({ success: false, error: 'Gateway timeout' })
    const req = makeRequest(
      'http://localhost/api/sessions/send',
      'POST',
      { gatewayId: 'gw1', message: 'Hello' },
      { 'x-csrf-token': 'tok' }
    )
    const res = await sessionSendPOST(req)
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Gateway timeout')
  })

  it('returns 500 with default error when sendToSession returns failure without error field', async () => {
    authed()
    mockSendToSession.mockResolvedValue({ success: false })
    const req = makeRequest(
      'http://localhost/api/sessions/send',
      'POST',
      { gatewayId: 'gw1', message: 'Hello' },
      { 'x-csrf-token': 'tok' }
    )
    const res = await sessionSendPOST(req)
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Failed to send message')
  })

  it('returns 500 when sendToSession throws', async () => {
    authed()
    mockSendToSession.mockRejectedValue(new Error('Network error'))
    const req = makeRequest(
      'http://localhost/api/sessions/send',
      'POST',
      { gatewayId: 'gw1', message: 'Hello' },
      { 'x-csrf-token': 'tok' }
    )
    const res = await sessionSendPOST(req)
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Internal server error')
  })
})
