/**
 * Tests for app/api/files/ route handlers
 * Covers: route.ts (browse), read/route.ts, create/route.ts, delete/route.ts, write/route.ts
 */

// ─── Module mocks BEFORE imports ─────────────────────────────────────────────

const mockGetSessionFromCookies = jest.fn()
const mockValidateSession = jest.fn()
const mockValidateCsrfToken = jest.fn()
const mockAuditLog = jest.fn()

// fs/promises mocks
const mockStat = jest.fn()
const mockReaddir = jest.fn()
const mockReadFile = jest.fn()
const mockWriteFile = jest.fn()
const mockMkdir = jest.fn()
const mockRm = jest.fn()
const mockRename = jest.fn()
const mockRealpath = jest.fn()

jest.mock('@/lib/auth', () => ({
  getSessionFromCookies: mockGetSessionFromCookies,
  validateSession: mockValidateSession,
  validateCsrfToken: mockValidateCsrfToken,
}))

jest.mock('@/lib/audit', () => ({
  auditLog: mockAuditLog,
}))

jest.mock('@/lib/logger', () => ({
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('fs/promises', () => ({
  stat: mockStat,
  readdir: mockReaddir,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  rm: mockRm,
  rename: mockRename,
  realpath: mockRealpath,
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { GET as browseGET } from '@/app/api/files/route'
import { GET as readGET } from '@/app/api/files/read/route'
import { POST as createPOST } from '@/app/api/files/create/route'
import { DELETE as deleteDELETE } from '@/app/api/files/delete/route'
import { PUT as writePUT } from '@/app/api/files/write/route'

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

const makeDirStat = () => ({
  isDirectory: () => true,
  isSymbolicLink: () => false,
  size: 4096,
  mtime: new Date('2024-01-01'),
})

const makeFileStat = (size = 1000) => ({
  isDirectory: () => false,
  isSymbolicLink: () => false,
  size,
  mtime: new Date('2024-01-01'),
})

beforeEach(() => {
  jest.clearAllMocks()
  mockMkdir.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)
  mockRm.mockResolvedValue(undefined)
  mockRename.mockResolvedValue(undefined)
})

// ─── Browse (GET /api/files) ──────────────────────────────────────────────────

describe('GET /api/files (browse)', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const req = makeRequest('GET', undefined, {}, 'http://localhost/api/files?path=/home/clawd')
    const res = await browseGET(req)
    expect(res.status).toBe(401)
  })

  it('returns directory listing', async () => {
    authed()
    mockStat
      .mockResolvedValueOnce(makeDirStat()) // dir check
      .mockResolvedValue(makeFileStat()) // per-entry stat

    mockReaddir.mockResolvedValue([
      { name: 'file1.txt', isDirectory: () => false, isSymbolicLink: () => false },
      { name: 'subdir', isDirectory: () => true, isSymbolicLink: () => false },
    ])

    const req = makeRequest('GET', undefined, {}, 'http://localhost/api/files?path=/home/clawd')
    const res = await browseGET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.entries).toBeDefined()
    expect(Array.isArray(data.entries)).toBe(true)
  })

  it('returns 404 when path not found', async () => {
    authed()
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockStat.mockRejectedValue(err)

    const req = makeRequest(
      'GET',
      undefined,
      {},
      'http://localhost/api/files?path=/home/clawd/nonexistent'
    )
    const res = await browseGET(req)
    expect(res.status).toBe(404)
  })

  it('returns 403 when permission denied on stat', async () => {
    authed()
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    mockStat.mockRejectedValue(err)

    const req = makeRequest(
      'GET',
      undefined,
      {},
      'http://localhost/api/files?path=/home/clawd/protected'
    )
    const res = await browseGET(req)
    expect(res.status).toBe(403)
  })

  it('returns 400 when path is a file', async () => {
    authed()
    mockStat.mockResolvedValue(makeFileStat())

    const req = makeRequest(
      'GET',
      undefined,
      {},
      'http://localhost/api/files?path=/home/clawd/file.txt'
    )
    const res = await browseGET(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.isFile).toBe(true)
  })

  it('returns 403 when permission denied on readdir', async () => {
    authed()
    mockStat.mockResolvedValue(makeDirStat())
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    mockReaddir.mockRejectedValue(err)

    const req = makeRequest(
      'GET',
      undefined,
      {},
      'http://localhost/api/files?path=/home/clawd/protected'
    )
    const res = await browseGET(req)
    expect(res.status).toBe(403)
  })

  it('sorts directories before files', async () => {
    authed()
    mockStat.mockResolvedValueOnce(makeDirStat()).mockResolvedValue(makeFileStat())
    mockReaddir.mockResolvedValue([
      { name: 'bfile.txt', isDirectory: () => false, isSymbolicLink: () => false },
      { name: 'adir', isDirectory: () => true, isSymbolicLink: () => false },
    ])

    const req = makeRequest('GET', undefined, {}, 'http://localhost/api/files?path=/home/clawd')
    const res = await browseGET(req)
    const data = await res.json()
    expect(data.entries[0].type).toBe('directory')
    expect(data.entries[1].type).toBe('file')
  })

  it('hides hidden files (starting with .)', async () => {
    authed()
    mockStat.mockResolvedValueOnce(makeDirStat()).mockResolvedValue(makeFileStat())
    mockReaddir.mockResolvedValue([
      { name: '.hidden', isDirectory: () => false, isSymbolicLink: () => false },
      { name: 'visible.txt', isDirectory: () => false, isSymbolicLink: () => false },
    ])

    const req = makeRequest('GET', undefined, {}, 'http://localhost/api/files?path=/home/clawd')
    const res = await browseGET(req)
    const data = await res.json()
    const names = data.entries.map((e: { name: string }) => e.name)
    expect(names).not.toContain('.hidden')
    expect(names).toContain('visible.txt')
  })
})

// ─── Read (GET /api/files/read) ───────────────────────────────────────────────

describe('GET /api/files/read', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const req = makeRequest(
      'GET',
      undefined,
      {},
      'http://localhost/api/files/read?path=/home/clawd/file.txt'
    )
    const res = await readGET(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when path missing', async () => {
    authed()
    const req = makeRequest('GET', undefined, {}, 'http://localhost/api/files/read')
    const res = await readGET(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when realpath fails (file not found)', async () => {
    authed()
    mockRealpath.mockRejectedValue(new Error('ENOENT'))

    const req = makeRequest(
      'GET',
      undefined,
      {},
      'http://localhost/api/files/read?path=/home/clawd/missing.txt'
    )
    const res = await readGET(req)
    expect(res.status).toBe(404)
  })

  it('returns 400 when file extension not allowed', async () => {
    authed()
    mockRealpath.mockResolvedValue('/home/clawd/file.exe')
    mockStat.mockResolvedValue(makeFileStat())

    const req = makeRequest(
      'GET',
      undefined,
      {},
      'http://localhost/api/files/read?path=/home/clawd/file.exe'
    )
    const res = await readGET(req)
    expect(res.status).toBe(400)
  })

  it('returns file content for allowed extension', async () => {
    authed()
    mockRealpath.mockResolvedValue('/home/clawd/file.txt')
    mockStat.mockResolvedValue(makeFileStat(100))
    mockReadFile.mockResolvedValue('Hello World')

    const req = makeRequest(
      'GET',
      undefined,
      {},
      'http://localhost/api/files/read?path=/home/clawd/file.txt'
    )
    const res = await readGET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.content).toBe('Hello World')
    expect(data.path).toBe('/home/clawd/file.txt')
  })

  it('returns 400 when path is a directory', async () => {
    authed()
    mockRealpath.mockResolvedValue('/home/clawd/somedir')
    mockStat.mockResolvedValue(makeDirStat())

    const req = makeRequest(
      'GET',
      undefined,
      {},
      'http://localhost/api/files/read?path=/home/clawd/somedir'
    )
    const res = await readGET(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when file too large', async () => {
    authed()
    mockRealpath.mockResolvedValue('/home/clawd/big.txt')
    mockStat.mockResolvedValue(makeFileStat(2_000_000)) // > 1MB

    const req = makeRequest(
      'GET',
      undefined,
      {},
      'http://localhost/api/files/read?path=/home/clawd/big.txt'
    )
    const res = await readGET(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('large')
  })

  it('returns 403 for sensitive files', async () => {
    authed()
    mockRealpath.mockResolvedValue('/home/clawd/.env')

    const req = makeRequest(
      'GET',
      undefined,
      {},
      'http://localhost/api/files/read?path=/home/clawd/.env'
    )
    const res = await readGET(req)
    expect(res.status).toBe(403)
  })

  it('truncates content when larger than maxSize', async () => {
    authed()
    const bigBuffer = Buffer.alloc(600_000, 'a')
    mockRealpath.mockResolvedValue('/home/clawd/medium.txt')
    mockStat.mockResolvedValue(makeFileStat(600_000))
    mockReadFile.mockResolvedValue(bigBuffer)

    const req = makeRequest(
      'GET',
      undefined,
      {},
      'http://localhost/api/files/read?path=/home/clawd/medium.txt&maxSize=100'
    )
    const res = await readGET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.content).toContain('truncated')
  })
})

// ─── Create (POST /api/files/create) ─────────────────────────────────────────

describe('POST /api/files/create', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const req = makeRequest(
      'POST',
      { path: '/home/clawd/new.txt' },
      {},
      'http://localhost/api/files/create'
    )
    const res = await createPOST(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 when CSRF invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('valid-token')
    mockValidateSession.mockReturnValue(true)
    mockValidateCsrfToken.mockReturnValue(false)

    const req = makeRequest(
      'POST',
      { path: '/home/clawd/new.txt' },
      { 'x-csrf-token': 'bad' },
      'http://localhost/api/files/create'
    )
    const res = await createPOST(req)
    expect(res.status).toBe(403)
  })

  it('returns 403 when trying to create blocked extension', async () => {
    authed()
    mockStat.mockRejectedValue(new Error('ENOENT')) // doesn't exist yet

    const req = makeRequest(
      'POST',
      { path: '/home/clawd/script.sh' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/create'
    )
    const res = await createPOST(req)
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toContain('.sh')
  })

  it('returns 403 when trying to create sensitive file', async () => {
    authed()
    mockStat.mockRejectedValue(new Error('ENOENT'))

    const req = makeRequest(
      'POST',
      { path: '/home/clawd/.env' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/create'
    )
    const res = await createPOST(req)
    expect(res.status).toBe(403)
  })

  it('returns 409 when file already exists', async () => {
    authed()
    mockStat.mockResolvedValue(makeFileStat()) // exists

    const req = makeRequest(
      'POST',
      { path: '/home/clawd/existing.txt' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/create'
    )
    const res = await createPOST(req)
    expect(res.status).toBe(409)
  })

  it('creates a file successfully', async () => {
    authed()
    mockStat.mockRejectedValue(new Error('ENOENT')) // does not exist

    const req = makeRequest(
      'POST',
      { path: '/home/clawd/newfile.txt' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/create'
    )
    const res = await createPOST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.type).toBe('file')
    expect(mockWriteFile).toHaveBeenCalled()
  })

  it('creates a directory successfully', async () => {
    authed()
    mockStat.mockRejectedValue(new Error('ENOENT'))

    const req = makeRequest(
      'POST',
      { path: '/home/clawd/newdir', isDirectory: true },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/create'
    )
    const res = await createPOST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.type).toBe('directory')
    expect(mockMkdir).toHaveBeenCalled()
  })
})

// ─── Delete (DELETE /api/files/delete) ───────────────────────────────────────

describe('DELETE /api/files/delete', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const req = makeRequest(
      'DELETE',
      undefined,
      {},
      'http://localhost/api/files/delete?path=/home/clawd/file.txt'
    )
    const res = await deleteDELETE(req)
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
      'http://localhost/api/files/delete?path=/home/clawd/file.txt'
    )
    const res = await deleteDELETE(req)
    expect(res.status).toBe(403)
  })

  it('returns 400 when path missing', async () => {
    authed()
    const req = makeRequest(
      'DELETE',
      undefined,
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/delete'
    )
    const res = await deleteDELETE(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when path not found (realpath fails)', async () => {
    authed()
    mockRealpath.mockRejectedValue(new Error('ENOENT'))

    const req = makeRequest(
      'DELETE',
      undefined,
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/delete?path=/home/clawd/missing.txt'
    )
    const res = await deleteDELETE(req)
    expect(res.status).toBe(404)
  })

  it('returns 403 when deleting protected path (.env)', async () => {
    authed()
    mockRealpath.mockResolvedValue('/home/clawd/.env')
    mockStat.mockResolvedValue(makeFileStat())

    const req = makeRequest(
      'DELETE',
      undefined,
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/delete?path=/home/clawd/.env'
    )
    const res = await deleteDELETE(req)
    expect(res.status).toBe(403)
  })

  it('deletes file permanently', async () => {
    authed()
    mockRealpath.mockResolvedValue('/home/clawd/deleteme.txt')
    mockStat.mockResolvedValue(makeFileStat())

    const req = makeRequest(
      'DELETE',
      undefined,
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/delete?path=/home/clawd/deleteme.txt'
    )
    const res = await deleteDELETE(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.trashed).toBe(false)
    expect(mockRm).toHaveBeenCalled()
  })

  it('moves to trash when trash=true', async () => {
    authed()
    mockRealpath.mockResolvedValue('/home/clawd/trashme.txt')
    mockStat.mockResolvedValue(makeFileStat())

    const req = makeRequest(
      'DELETE',
      undefined,
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/delete?path=/home/clawd/trashme.txt&trash=true'
    )
    const res = await deleteDELETE(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.trashed).toBe(true)
    expect(data.trashPath).toBeDefined()
    expect(mockRename).toHaveBeenCalled()
    expect(mockRm).not.toHaveBeenCalled()
  })

  it('returns 404 when stat fails after realpath', async () => {
    authed()
    mockRealpath.mockResolvedValue('/home/clawd/ghostfile.txt')
    mockStat.mockResolvedValue(null) // stat returns null → not found

    const req = makeRequest(
      'DELETE',
      undefined,
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/delete?path=/home/clawd/ghostfile.txt'
    )
    const res = await deleteDELETE(req)
    expect(res.status).toBe(404)
  })
})

// ─── Write (PUT /api/files/write) ─────────────────────────────────────────────

describe('PUT /api/files/write', () => {
  it('returns 401 when not authenticated', async () => {
    unauthed()
    const req = makeRequest(
      'PUT',
      { path: '/home/clawd/file.txt', content: 'hello' },
      {},
      'http://localhost/api/files/write'
    )
    const res = await writePUT(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 when CSRF invalid', async () => {
    mockGetSessionFromCookies.mockResolvedValue('valid-token')
    mockValidateSession.mockReturnValue(true)
    mockValidateCsrfToken.mockReturnValue(false)

    const req = makeRequest(
      'PUT',
      { path: '/home/clawd/file.txt', content: 'hi' },
      { 'x-csrf-token': 'bad' },
      'http://localhost/api/files/write'
    )
    const res = await writePUT(req)
    expect(res.status).toBe(403)
  })

  it('returns 403 when writing to sensitive path (.env)', async () => {
    authed()
    mockRealpath.mockResolvedValue('/home/clawd')

    const req = makeRequest(
      'PUT',
      { path: '/home/clawd/.env', content: 'SECRET=xxx' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/write'
    )
    const res = await writePUT(req)
    expect(res.status).toBe(403)
  })

  it('writes file successfully (new file)', async () => {
    authed()
    mockRealpath.mockResolvedValue('/home/clawd')
    mockStat.mockResolvedValue(null) // doesn't exist (new file)

    const req = makeRequest(
      'PUT',
      { path: '/home/clawd/test.txt', content: 'Hello World' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/write'
    )
    const res = await writePUT(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.isNewFile).toBe(true)
    expect(mockWriteFile).toHaveBeenCalled()
  })

  it('writes file successfully (existing file)', async () => {
    authed()
    mockRealpath.mockResolvedValue('/home/clawd')
    mockStat.mockResolvedValue(makeFileStat())

    const req = makeRequest(
      'PUT',
      { path: '/home/clawd/existing.txt', content: 'Updated content' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/write'
    )
    const res = await writePUT(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.isNewFile).toBe(false)
  })

  it('returns 403 when parent directory not accessible', async () => {
    authed()
    mockRealpath.mockRejectedValue(new Error('ENOENT'))

    const req = makeRequest(
      'PUT',
      { path: '/home/clawd/deep/file.txt', content: 'hi' },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/write'
    )
    const res = await writePUT(req)
    expect(res.status).toBe(403)
  })

  it('returns size in bytes', async () => {
    authed()
    mockRealpath.mockResolvedValue('/home/clawd')
    mockStat.mockResolvedValue(null)

    const content = 'Test content here'
    const req = makeRequest(
      'PUT',
      { path: '/home/clawd/sized.txt', content },
      { 'x-csrf-token': 'tok' },
      'http://localhost/api/files/write'
    )
    const res = await writePUT(req)
    const data = await res.json()
    expect(data.size).toBe(Buffer.byteLength(content, 'utf-8'))
  })
})
