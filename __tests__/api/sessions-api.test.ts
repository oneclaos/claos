/**
 * Tests for app/api/sessions/route.ts and app/api/sessions/spawn/route.ts
 */

// ─── Module mocks BEFORE imports ─────────────────────────────────────────────

const mockGetSessionFromCookies = jest.fn()
const mockValidateSession = jest.fn()
const mockValidateCsrfToken = jest.fn()
const mockListAllSessions = jest.fn()
const mockListSessions = jest.fn()
const mockGetGateways = jest.fn()
const mockSpawnSession = jest.fn()
const mockGetAllGateways = jest.fn()
const mockAuditLog = jest.fn()

jest.mock('@/lib/auth', () => ({
  getSessionFromCookies: mockGetSessionFromCookies,
  validateSession: mockValidateSession,
  validateCsrfToken: mockValidateCsrfToken,
}))

jest.mock('@/lib/gateway', () => ({
  listAllSessions: mockListAllSessions,
  listSessions: mockListSessions,
  getGateways: mockGetGateways,
}))

jest.mock('@/lib/gateway/sessions', () => ({
  spawnSession: mockSpawnSession,
  listSessions: mockListSessions,
  listAllSessions: mockListAllSessions,
}))

jest.mock('@/lib/gateway/registry', () => ({
  getAllGateways: mockGetAllGateways,
}))

jest.mock('@/lib/audit', () => ({
  auditLog: mockAuditLog,
}))

jest.mock('@/lib/logger', () => ({
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { GET as sessionsGET, POST as sessionsPOST } from '@/app/api/sessions/route'
import { POST as spawnPOST } from '@/app/api/sessions/spawn/route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeSession = (id: string, gatewayId = 'gw-1') => ({
  sessionKey: id,
  key: id,
  gateway: gatewayId,
  gatewayName: 'Test GW',
  channel: 'telegram',
  lastActive: new Date().toISOString(),
})

const makeGw = (id: string) => ({ id, name: `GW ${id}`, url: `ws://gw${id}` })

function makeRequest(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
  url = 'http://localhost/api/sessions'
): NextRequest {
  const opts: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  return new NextRequest(url, opts as never)
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

// ─── /api/sessions GET ────────────────────────────────────────────────────────

describe('GET /api/sessions', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const res = await sessionsGET()
    expect(res.status).toBe(401)
  })

  it('returns all sessions', async () => {
    authed()
    mockListAllSessions.mockResolvedValue([makeSession('sess-1'), makeSession('sess-2')])

    const res = await sessionsGET()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.sessions).toHaveLength(2)
    expect(data.total).toBe(2)
  })

  it('returns 500 on error', async () => {
    authed()
    mockListAllSessions.mockRejectedValue(new Error('Failed'))

    const res = await sessionsGET()
    expect(res.status).toBe(500)
  })
})

// ─── /api/sessions POST ───────────────────────────────────────────────────────

describe('POST /api/sessions', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const req = makeRequest('POST', { gatewayId: 'gw-1', limit: 10, offset: 0 })
    const res = await sessionsPOST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 or 500 on invalid body', async () => {
    authed()
    const req = makeRequest('POST', { invalid: true })
    const res = await sessionsPOST(req)
    expect([400, 500]).toContain(res.status)
  })

  it('returns all sessions when no gatewayId specified', async () => {
    authed()
    mockListAllSessions.mockResolvedValue([makeSession('s1'), makeSession('s2'), makeSession('s3')])

    const req = makeRequest('POST', { limit: 10, offset: 0 })
    const res = await sessionsPOST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.sessions).toHaveLength(3)
    expect(data.total).toBe(3)
  })

  it('filters by gatewayId when specified', async () => {
    authed()
    mockGetGateways.mockReturnValue([makeGw('gw-1')])
    mockListSessions.mockResolvedValue([makeSession('s1', 'gw-1')])

    const req = makeRequest('POST', { gatewayId: 'gw-1', limit: 10, offset: 0 })
    const res = await sessionsPOST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.sessions).toHaveLength(1)
  })

  it('returns 404 when gatewayId not found', async () => {
    authed()
    mockGetGateways.mockReturnValue([])

    const req = makeRequest('POST', { gatewayId: 'nonexistent', limit: 10, offset: 0 })
    const res = await sessionsPOST(req)
    expect(res.status).toBe(404)
  })

  it('filters by channel', async () => {
    authed()
    mockListAllSessions.mockResolvedValue([
      { ...makeSession('s1'), channel: 'telegram' },
      { ...makeSession('s2'), channel: 'discord' },
    ])

    const req = makeRequest('POST', { limit: 10, offset: 0, channel: 'telegram' })
    const res = await sessionsPOST(req)
    const data = await res.json()
    expect(data.sessions).toHaveLength(1)
    expect(data.sessions[0].channel).toBe('telegram')
  })

  it('paginates results', async () => {
    authed()
    const sessions = Array.from({ length: 20 }, (_, i) => makeSession(`s${i}`))
    mockListAllSessions.mockResolvedValue(sessions)

    const req = makeRequest('POST', { limit: 5, offset: 10 })
    const res = await sessionsPOST(req)
    const data = await res.json()
    expect(data.sessions).toHaveLength(5)
    expect(data.total).toBe(20)
    expect(data.hasMore).toBe(true)
  })
})

// ─── /api/sessions/spawn POST ─────────────────────────────────────────────────

describe('POST /api/sessions/spawn', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const req = makeRequest(
      'POST',
      { gatewayId: 'gw-1' },
      {},
      'http://localhost/api/sessions/spawn'
    )
    const res = await spawnPOST(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 when CSRF invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('valid-token')
    mockValidateSession.mockReturnValue(true)
    mockValidateCsrfToken.mockReturnValue(false)

    const req = makeRequest(
      'POST',
      { gatewayId: 'gw-1' },
      { 'x-csrf-token': 'bad' },
      'http://localhost/api/sessions/spawn'
    )
    const res = await spawnPOST(req)
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid body (empty gatewayId)', async () => {
    authed()
    const req = makeRequest(
      'POST',
      { gatewayId: '' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/sessions/spawn'
    )
    const res = await spawnPOST(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when gateway not found', async () => {
    authed()
    mockGetAllGateways.mockResolvedValue([])

    const req = makeRequest(
      'POST',
      { gatewayId: 'nonexistent' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/sessions/spawn'
    )
    const res = await spawnPOST(req)
    expect(res.status).toBe(404)
  })

  it('spawns session successfully', async () => {
    authed()
    mockGetAllGateways.mockResolvedValue([makeGw('gw-1')])
    mockSpawnSession.mockResolvedValue({ success: true, sessionKey: 'web-12345' })

    const req = makeRequest(
      'POST',
      { gatewayId: 'gw-1' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/sessions/spawn'
    )
    const res = await spawnPOST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.sessionKey).toBe('web-12345')
    expect(data.gateway).toBe('gw-1')
  })

  it('returns 500 when spawnSession fails', async () => {
    authed()
    mockGetAllGateways.mockResolvedValue([makeGw('gw-1')])
    mockSpawnSession.mockResolvedValue({ success: false, error: 'Connection refused' })

    const req = makeRequest(
      'POST',
      { gatewayId: 'gw-1' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/sessions/spawn'
    )
    const res = await spawnPOST(req)
    expect(res.status).toBe(500)
  })

  it('spawns with custom sessionKey and message', async () => {
    authed()
    mockGetAllGateways.mockResolvedValue([makeGw('gw-1')])
    mockSpawnSession.mockResolvedValue({ success: true, sessionKey: 'custom-key' })

    const req = makeRequest(
      'POST',
      { gatewayId: 'gw-1', sessionKey: 'custom-key', message: 'Hello agent' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/sessions/spawn'
    )
    const res = await spawnPOST(req)
    expect(res.status).toBe(200)
    expect(mockSpawnSession).toHaveBeenCalledWith('gw-1', 'Hello agent', 'custom-key')
  })

  it('returns 500 on unexpected exception', async () => {
    authed()
    mockGetAllGateways.mockRejectedValue(new Error('Unexpected error'))

    const req = makeRequest(
      'POST',
      { gatewayId: 'gw-1' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/sessions/spawn'
    )
    const res = await spawnPOST(req)
    expect(res.status).toBe(500)
  })
})
