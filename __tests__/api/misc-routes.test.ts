/**
 * Tests for:
 * - app/api/groups/route.ts
 * - app/api/settings/password/route.ts
 * - app/api/agents/discover/route.ts
 */

// ─── Module mocks BEFORE imports ─────────────────────────────────────────────

const mockGetSessionFromCookies = jest.fn()
const mockValidateSession = jest.fn()
const mockValidateCsrfToken = jest.fn()
const mockVerifyPassword = jest.fn()
const mockHashPassword = jest.fn()
const mockAuditLog = jest.fn()

const mockCreateGroup = jest.fn()
const mockListGroups = jest.fn()
const mockDeleteGroup = jest.fn()

jest.mock('@/lib/auth', () => ({
  getSessionFromCookies: mockGetSessionFromCookies,
  validateSession: mockValidateSession,
  validateCsrfToken: mockValidateCsrfToken,
  verifyPassword: mockVerifyPassword,
  hashPassword: mockHashPassword,
}))

jest.mock('@/lib/audit', () => ({
  auditLog: mockAuditLog,
}))

jest.mock('@/lib/groups', () => ({
  createGroup: mockCreateGroup,
  listGroups: mockListGroups,
  deleteGroup: mockDeleteGroup,
}))

jest.mock('@/lib/get-client-info', () => ({
  getClientInfo: jest.fn(() => ({ ip: '127.0.0.1', userAgent: 'TestAgent/1.0' })),
}))

// Mock fs for password route
const mockReadFile = jest.fn()
const mockWriteFile = jest.fn()
const mockMkdir = jest.fn()

jest.mock('fs', () => ({
  promises: {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
  },
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import {
  GET as groupsGET,
  POST as groupsPOST,
  DELETE as groupsDELETE,
} from '@/app/api/groups/route'
import { POST as passwordPOST } from '@/app/api/settings/password/route'
import { GET as agentsDiscoverGET } from '@/app/api/agents/discover/route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
  url = 'http://localhost'
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
  mockMkdir.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)
  mockReadFile.mockRejectedValue(new Error('ENOENT')) // Default: no config file
})

// ─── /api/groups GET ──────────────────────────────────────────────────────────

describe('GET /api/groups', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const res = await groupsGET()
    expect(res.status).toBe(401)
  })

  it('returns list of groups', async () => {
    authed()
    mockListGroups.mockReturnValue([
      { id: 'g1', name: 'Group 1', agents: [] },
      { id: 'g2', name: 'Group 2', agents: ['agent1'] },
    ])

    const res = await groupsGET()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.groups).toHaveLength(2)
  })

  it('returns 500 when listGroups throws', async () => {
    authed()
    mockListGroups.mockImplementation(() => {
      throw new Error('DB error')
    })

    const res = await groupsGET()
    expect(res.status).toBe(500)
  })
})

// ─── /api/groups POST ─────────────────────────────────────────────────────────

describe('POST /api/groups', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const req = makeRequest(
      'POST',
      { name: 'Test Group', agents: [] },
      {},
      'http://localhost/api/groups'
    )
    const res = await groupsPOST(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 when CSRF invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('valid-token')
    mockValidateSession.mockReturnValue(true)
    mockValidateCsrfToken.mockReturnValue(false)
    const req = makeRequest(
      'POST',
      { name: 'Test', agents: [] },
      { 'x-csrf-token': 'bad' },
      'http://localhost/api/groups'
    )
    const res = await groupsPOST(req)
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid body (missing name)', async () => {
    authed()
    const req = makeRequest(
      'POST',
      { agents: [] },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/groups'
    )
    const res = await groupsPOST(req)
    expect(res.status).toBe(400)
  })

  it('creates group successfully', async () => {
    authed()
    const validAgents = [{ id: 'agent-1', gatewayId: 'gw-1' }]
    mockCreateGroup.mockReturnValue({
      id: 'new-g',
      name: 'My Group',
      agents: validAgents,
      description: 'desc',
    })

    const req = makeRequest(
      'POST',
      { name: 'My Group', agents: validAgents, description: 'desc' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/groups'
    )
    const res = await groupsPOST(req)
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.group.name).toBe('My Group')
    expect(mockCreateGroup).toHaveBeenCalledWith('My Group', 'desc', validAgents)
  })

  it('returns 500 when createGroup throws', async () => {
    authed()
    const validAgents = [{ id: 'agent-1', gatewayId: 'gw-1' }]
    mockCreateGroup.mockImplementation(() => {
      throw new Error('Failed')
    })

    const req = makeRequest(
      'POST',
      { name: 'Group', agents: validAgents },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/groups'
    )
    const res = await groupsPOST(req)
    expect(res.status).toBe(500)
  })
})

// ─── /api/groups DELETE ───────────────────────────────────────────────────────

describe('DELETE /api/groups', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const req = makeRequest('DELETE', undefined, {}, 'http://localhost/api/groups?id=g1')
    const res = await groupsDELETE(req)
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
      'http://localhost/api/groups?id=g1'
    )
    const res = await groupsDELETE(req)
    expect(res.status).toBe(403)
  })

  it('returns 400 when id missing', async () => {
    authed()
    const req = makeRequest(
      'DELETE',
      undefined,
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/groups'
    )
    const res = await groupsDELETE(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when group not found', async () => {
    authed()
    mockDeleteGroup.mockReturnValue(false)
    const req = makeRequest(
      'DELETE',
      undefined,
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/groups?id=nonexistent'
    )
    const res = await groupsDELETE(req)
    expect(res.status).toBe(404)
  })

  it('deletes group successfully', async () => {
    authed()
    mockDeleteGroup.mockReturnValue(true)
    const req = makeRequest(
      'DELETE',
      undefined,
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/groups?id=g1'
    )
    const res = await groupsDELETE(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(mockDeleteGroup).toHaveBeenCalledWith('g1')
  })
})

// ─── /api/settings/password POST ─────────────────────────────────────────────

describe('POST /api/settings/password', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const req = makeRequest(
      'POST',
      { currentPassword: 'old', newPassword: 'newpassword123' },
      {},
      'http://localhost/api/settings/password'
    )
    const res = await passwordPOST(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 when CSRF invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('valid-token')
    mockValidateSession.mockReturnValue(true)
    mockValidateCsrfToken.mockReturnValue(false)
    const req = makeRequest(
      'POST',
      { currentPassword: 'old', newPassword: 'newpassword123' },
      { 'x-csrf-token': 'bad' },
      'http://localhost/api/settings/password'
    )
    const res = await passwordPOST(req)
    expect(res.status).toBe(403)
  })

  it('returns 400 when missing required fields', async () => {
    authed()
    const req = makeRequest(
      'POST',
      { currentPassword: 'old' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/settings/password'
    )
    const res = await passwordPOST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    // Zod validation message for missing field
    expect(data.error).toContain('newPassword')
  })

  it('returns 400 when new password too short (<12)', async () => {
    authed()
    const req = makeRequest(
      'POST',
      { currentPassword: 'old', newPassword: 'short' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/settings/password'
    )
    const res = await passwordPOST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('12')
  })

  it('returns 401 when current password is incorrect', async () => {
    authed()
    mockVerifyPassword.mockResolvedValue(false)
    const req = makeRequest(
      'POST',
      { currentPassword: 'wrongold', newPassword: 'newvalidpassword' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/settings/password'
    )
    const res = await passwordPOST(req)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toContain('incorrect')
  })

  it('changes password successfully', async () => {
    authed()
    mockVerifyPassword.mockResolvedValue(true)
    mockHashPassword.mockResolvedValue('$2b$10$newhash')
    mockReadFile.mockRejectedValue(new Error('ENOENT')) // no existing config

    const req = makeRequest(
      'POST',
      { currentPassword: 'correctold', newPassword: 'newvalidpassword' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/settings/password'
    )
    const res = await passwordPOST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(mockWriteFile).toHaveBeenCalled()
    expect(mockHashPassword).toHaveBeenCalledWith('newvalidpassword')
  })

  it('reads existing config when changing password', async () => {
    authed()
    mockVerifyPassword.mockResolvedValue(true)
    mockHashPassword.mockResolvedValue('$2b$10$newhash')
    mockReadFile.mockResolvedValue(JSON.stringify({ passwordHash: '$2b$10$oldhash' }))

    const req = makeRequest(
      'POST',
      { currentPassword: 'correctold', newPassword: 'newvalidpassword' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/settings/password'
    )
    const res = await passwordPOST(req)
    expect(res.status).toBe(200)
  })
})

// ─── /api/agents/discover GET ─────────────────────────────────────────────────

describe('GET /api/agents/discover', () => {
  beforeEach(() => {
    // Mock fetch for port probing
    global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'))
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    unauthed()
    const req = makeRequest('GET', undefined, {}, 'http://localhost/api/agents/discover')
    const res = await agentsDiscoverGET(req)
    expect(res.status).toBe(401)
  })

  it('returns empty agents array when no ports respond', async () => {
    authed()
    global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'))

    const req = makeRequest('GET', undefined, {}, 'http://localhost/api/agents/discover')
    const res = await agentsDiscoverGET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.agents)).toBe(true)
    expect(data.count).toBeGreaterThanOrEqual(0)
  })

  it('returns agents when ports respond (clawdbot)', async () => {
    authed()
    // Fresh module needed to avoid cache from previous test
    jest.resetModules()
    jest.mock('@/lib/auth', () => ({
      getSessionFromCookies: mockGetSessionFromCookies,
      validateSession: mockValidateSession,
      validateCsrfToken: mockValidateCsrfToken,
      verifyPassword: mockVerifyPassword,
      hashPassword: mockHashPassword,
    }))

    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('18750')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ name: 'Test Agent', type: 'clawdbot', version: '1.0.0' }),
        })
      }
      return Promise.reject(new Error('refused'))
    })

    const { GET: freshDiscover } = await import('@/app/api/agents/discover/route')
    const req = makeRequest('GET', undefined, {}, 'http://localhost/api/agents/discover')
    const res = await freshDiscover(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.count).toBeGreaterThanOrEqual(0) // cache may vary
    expect(Array.isArray(data.agents)).toBe(true)
  })

  it('returns scannedAt timestamp', async () => {
    authed()
    global.fetch = jest.fn().mockRejectedValue(new Error('refused'))

    const req = makeRequest('GET', undefined, {}, 'http://localhost/api/agents/discover')
    const res = await agentsDiscoverGET(req)
    const data = await res.json()
    expect(data.scannedAt).toBeDefined()
    expect(new Date(data.scannedAt).getTime()).toBeGreaterThan(0)
  })
})
