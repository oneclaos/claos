/**
 * Tests for app/api/gateways/route.ts
 */

// ─── Module mocks BEFORE imports ─────────────────────────────────────────────

const mockGetSessionFromCookies = jest.fn()
const mockValidateSession = jest.fn()
const mockValidateCsrfToken = jest.fn()
const mockGetAllGateways = jest.fn()
const mockGetCustomGateways = jest.fn()
const mockAddCustomGateway = jest.fn()
const mockRemoveCustomGateway = jest.fn()

jest.mock('@/lib/auth', () => ({
  getSessionFromCookies: mockGetSessionFromCookies,
  validateSession: mockValidateSession,
  validateCsrfToken: mockValidateCsrfToken,
}))

jest.mock('@/lib/gateway/registry', () => ({
  getAllGateways: mockGetAllGateways,
}))

jest.mock('@/lib/gateway/config', () => ({
  getCustomGateways: mockGetCustomGateways,
  addCustomGateway: mockAddCustomGateway,
  removeCustomGateway: mockRemoveCustomGateway,
}))

jest.mock('@/lib/logger', () => ({
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { GET, POST, DELETE } from '@/app/api/gateways/route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeGw = (id: string) => ({ id, name: `GW ${id}`, url: `ws://gw${id}`, token: 'tok' })

function makeRequest(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
  url = 'http://localhost/api/gateways'
): NextRequest {
  const opts: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  }
  if (body !== undefined) {
    opts.body = JSON.stringify(body)
  }
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

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
})

describe('GET /api/gateways', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const res = await GET()
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('returns merged gateways list', async () => {
    authed()
    mockGetAllGateways.mockResolvedValue([makeGw('gw-1'), makeGw('gw-2')])
    mockGetCustomGateways.mockReturnValue([makeGw('gw-custom')])

    const res = await GET()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.gateways)).toBe(true)
    // Should have gw-1, gw-2, gw-custom
    expect(data.gateways.length).toBe(3)
  })

  it('does not duplicate custom gateways already in auto list', async () => {
    authed()
    mockGetAllGateways.mockResolvedValue([makeGw('gw-1')])
    mockGetCustomGateways.mockReturnValue([makeGw('gw-1')])

    const res = await GET()
    const data = await res.json()
    expect(data.gateways.length).toBe(1)
  })

  it('tags auto gateways as custom: false', async () => {
    authed()
    mockGetAllGateways.mockResolvedValue([makeGw('gw-1')])
    mockGetCustomGateways.mockReturnValue([])

    const res = await GET()
    const data = await res.json()
    expect(data.gateways[0].custom).toBe(false)
  })

  it('tags custom-only gateways as custom: true', async () => {
    authed()
    mockGetAllGateways.mockResolvedValue([])
    mockGetCustomGateways.mockReturnValue([makeGw('my-custom')])

    const res = await GET()
    const data = await res.json()
    expect(data.gateways[0].custom).toBe(true)
  })

  it('returns 500 on unexpected error', async () => {
    authed()
    mockGetAllGateways.mockRejectedValue(new Error('DB exploded'))

    const res = await GET()
    expect(res.status).toBe(500)
  })
})

describe('POST /api/gateways', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const req = makeRequest('POST', { name: 'Test', url: 'ws://test' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 when CSRF token invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('valid-token')
    mockValidateSession.mockReturnValue(true)
    mockValidateCsrfToken.mockReturnValue(false)

    const req = makeRequest('POST', { name: 'Test', url: 'ws://test' })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('returns 400 when name is missing', async () => {
    authed()
    const req = makeRequest('POST', { url: 'ws://test' }, { 'x-csrf-token': 'tok' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when url is missing', async () => {
    authed()
    const req = makeRequest('POST', { name: 'Test' }, { 'x-csrf-token': 'tok' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when URL has invalid scheme', async () => {
    authed()
    const req = makeRequest(
      'POST',
      { name: 'Test', url: 'ftp://invalid' },
      { 'x-csrf-token': 'tok' }
    )
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('creates gateway with valid data (ws URL)', async () => {
    authed()
    const req = makeRequest(
      'POST',
      { name: 'My Gateway', url: 'ws://localhost:3000' },
      { 'x-csrf-token': 'tok' }
    )
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.gateway.name).toBe('My Gateway')
    expect(mockAddCustomGateway).toHaveBeenCalledTimes(1)
  })

  it('creates gateway with wss URL', async () => {
    authed()
    const req = makeRequest(
      'POST',
      { name: 'Secure GW', url: 'wss://secure.example.com' },
      { 'x-csrf-token': 'tok' }
    )
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('creates gateway with https URL', async () => {
    authed()
    const req = makeRequest(
      'POST',
      { name: 'HTTP GW', url: 'https://api.example.com' },
      { 'x-csrf-token': 'tok' }
    )
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('includes gatewayToken when provided', async () => {
    authed()
    const req = makeRequest(
      'POST',
      { name: 'Secure', url: 'wss://x.com', gatewayToken: 'mytoken' },
      { 'x-csrf-token': 'tok' }
    )
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.gateway.token).toBe('mytoken')
  })

  it('generates id from name (slugified)', async () => {
    authed()
    const req = makeRequest(
      'POST',
      { name: 'My Cool Gateway!!', url: 'ws://x.com' },
      { 'x-csrf-token': 'tok' }
    )
    const res = await POST(req)
    const data = await res.json()
    expect(data.gateway.id).toBe('my-cool-gateway')
  })
})

describe('DELETE /api/gateways', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const req = makeRequest('DELETE', undefined, {}, 'http://localhost/api/gateways?id=gw-1')
    const res = await DELETE(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 when CSRF invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('valid-token')
    mockValidateSession.mockReturnValue(true)
    mockValidateCsrfToken.mockReturnValue(false)

    const req = makeRequest(
      'DELETE',
      undefined,
      { 'x-csrf-token': 'bad' },
      'http://localhost/api/gateways?id=gw-1'
    )
    const res = await DELETE(req)
    expect(res.status).toBe(403)
  })

  it('returns 400 when id is missing', async () => {
    authed()
    const req = makeRequest(
      'DELETE',
      undefined,
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/gateways'
    )
    const res = await DELETE(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when gateway not in custom list', async () => {
    authed()
    mockGetCustomGateways.mockReturnValue([])

    const req = makeRequest(
      'DELETE',
      undefined,
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/gateways?id=gw-nonexistent'
    )
    const res = await DELETE(req)
    expect(res.status).toBe(404)
  })

  it('deletes gateway successfully', async () => {
    authed()
    mockGetCustomGateways.mockReturnValue([makeGw('gw-custom')])

    const req = makeRequest(
      'DELETE',
      undefined,
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/gateways?id=gw-custom'
    )
    const res = await DELETE(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(mockRemoveCustomGateway).toHaveBeenCalledWith('gw-custom')
  })
})
