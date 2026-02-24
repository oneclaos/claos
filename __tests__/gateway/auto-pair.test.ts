/**
 * Tests for lib/gateway/auto-pair.ts
 * Covers buildPortConfigMap() (via fs mocks) and scanAndAutoPair() (via fetch mock)
 */

// ─── Module mocks BEFORE imports ─────────────────────────────────────────────

jest.mock('fs', () => ({
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
}))

jest.mock('@/lib/gateway/config', () => ({
  addCustomGateway: jest.fn(),
  getCustomGateways: jest.fn().mockReturnValue([]),
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync } from 'fs'
import { scanAndAutoPair } from '@/lib/gateway/auto-pair'
import { addCustomGateway, getCustomGateways } from '@/lib/gateway/config'

const mockReaddirSync = readdirSync as jest.MockedFunction<typeof readdirSync>
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>
const mockAddCustomGateway = addCustomGateway as jest.MockedFunction<typeof addCustomGateway>
const mockGetCustomGateways = getCustomGateways as jest.MockedFunction<typeof getCustomGateways>

// ─── fetch mock ──────────────────────────────────────────────────────────────

const mockFetch = jest.fn()
global.fetch = mockFetch

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeHtmlResponse(name?: string): string {
  if (name) {
    return `<html><body>__CLAWDBOT_ASSISTANT_NAME__ = "${name}"</body></html>`
  }
  return '<html><body>Clawdbot Gateway</body></html>'
}

function makeFetchResponse(ok: boolean, html: string) {
  return {
    ok,
    text: jest.fn().mockResolvedValue(html),
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  mockGetCustomGateways.mockReturnValue([])
  // Default: no ports respond
  mockFetch.mockResolvedValue(makeFetchResponse(false, ''))
})

describe('scanAndAutoPair — no active ports', () => {
  it('returns empty array when no ports respond', async () => {
    mockReaddirSync.mockReturnValue([])
    const result = await scanAndAutoPair()
    expect(result).toEqual([])
  })
})

describe('scanAndAutoPair — active port, no config file', () => {
  beforeEach(() => {
    // Port 18750 responds with Clawdbot HTML (no named agent)
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('http://127.0.0.1:18750')) {
        return Promise.resolve(makeFetchResponse(true, makeHtmlResponse()))
      }
      return Promise.resolve(makeFetchResponse(false, ''))
    })
    // No user home dirs
    mockReaddirSync.mockReturnValue([])
  })

  it('reports agent as unpaired when no config file is found', async () => {
    const result = await scanAndAutoPair()
    expect(result).toHaveLength(1)
    expect(result[0].port).toBe(18750)
    expect(result[0].paired).toBe(false)
    expect(result[0].id).toMatch(/agent-18750/)
  })
})

describe('scanAndAutoPair — active port with named agent', () => {
  beforeEach(() => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('http://127.0.0.1:18760')) {
        return Promise.resolve(makeFetchResponse(true, makeHtmlResponse('James')))
      }
      return Promise.resolve(makeFetchResponse(false, ''))
    })
    mockReaddirSync.mockReturnValue([])
  })

  it('derives id as agent-{port} for unpaired named agent', async () => {
    const result = await scanAndAutoPair()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('James')
    // Unpaired agents use agent-{port} format so /api/setup/pair can extract port
    expect(result[0].id).toBe('agent-18760')
  })
})

describe('scanAndAutoPair — auto-pairs when config file is readable', () => {
  beforeEach(() => {
    // Port 18751 responds
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('http://127.0.0.1:18751')) {
        return Promise.resolve(makeFetchResponse(true, makeHtmlResponse('Alice')))
      }
      return Promise.resolve(makeFetchResponse(false, ''))
    })

    // Simulate user "alice" with a clawdbot.json that matches port 18751
    mockReaddirSync.mockReturnValue(['alice'] as unknown as ReturnType<typeof readdirSync>)
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const fp = String(filePath)
      if (fp.endsWith('alice/.clawdbot/clawdbot.json')) {
        return JSON.stringify({
          gateway: { port: 18751, auth: { token: 'tok-abc123' } }
        })
      }
      throw new Error('ENOENT')
    })
  })

  it('auto-pairs agent and calls addCustomGateway', async () => {
    const result = await scanAndAutoPair()
    expect(result).toHaveLength(1)
    expect(result[0].paired).toBe(true)
    expect(result[0].name).toBe('Alice')
    expect(mockAddCustomGateway).toHaveBeenCalledWith(
      expect.objectContaining({ port: 18751, token: 'tok-abc123' })
    )
  })
})

describe('scanAndAutoPair — already-stored gateway', () => {
  beforeEach(() => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('http://127.0.0.1:18752')) {
        return Promise.resolve(makeFetchResponse(true, makeHtmlResponse('Bob')))
      }
      return Promise.resolve(makeFetchResponse(false, ''))
    })
    mockReaddirSync.mockReturnValue([])
    // Simulate already-stored gateway on port 18752
    mockGetCustomGateways.mockReturnValue([
      { id: 'bob', name: 'Bob', url: 'http://127.0.0.1:18752', port: 18752 }
    ])
  })

  it('reports already-stored gateway as paired without calling addCustomGateway', async () => {
    const result = await scanAndAutoPair()
    expect(result).toHaveLength(1)
    expect(result[0].paired).toBe(true)
    expect(mockAddCustomGateway).not.toHaveBeenCalled()
  })
})

describe('scanAndAutoPair — openclaw config', () => {
  beforeEach(() => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('http://127.0.0.1:18753')) {
        return Promise.resolve(makeFetchResponse(true, makeHtmlResponse('Carol')))
      }
      return Promise.resolve(makeFetchResponse(false, ''))
    })

    mockReaddirSync.mockReturnValue(['carol'] as unknown as ReturnType<typeof readdirSync>)
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const fp = String(filePath)
      if (fp.endsWith('carol/.openclaw/openclaw.json')) {
        return JSON.stringify({
          gateway: { port: 18753, auth: { token: 'tok-openclaw' } }
        })
      }
      throw new Error('ENOENT')
    })
  })

  it('auto-pairs openclaw agent as type "openclaw"', async () => {
    const result = await scanAndAutoPair()
    expect(result).toHaveLength(1)
    expect(result[0].paired).toBe(true)
    expect(result[0].type).toBe('openclaw')
    expect(mockAddCustomGateway).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'openclaw', token: 'tok-openclaw' })
    )
  })
})

describe('scanAndAutoPair — fetch error / non-Clawdbot page', () => {
  it('ignores ports that return non-Clawdbot HTML', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('http://127.0.0.1:18754')) {
        return Promise.resolve(makeFetchResponse(true, '<html><body>Hello World</body></html>'))
      }
      return Promise.resolve(makeFetchResponse(false, ''))
    })
    mockReaddirSync.mockReturnValue([])

    const result = await scanAndAutoPair()
    expect(result).toHaveLength(0)
  })

  it('ignores ports where fetch throws (timeout/refuse)', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('http://127.0.0.1:18755')) {
        return Promise.reject(new Error('Connection refused'))
      }
      return Promise.resolve(makeFetchResponse(false, ''))
    })
    mockReaddirSync.mockReturnValue([])

    const result = await scanAndAutoPair()
    expect(result).toHaveLength(0)
  })
})

describe('scanAndAutoPair — /home not readable', () => {
  it('handles readdirSync throwing EACCES gracefully', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('http://127.0.0.1:18756')) {
        return Promise.resolve(makeFetchResponse(true, makeHtmlResponse()))
      }
      return Promise.resolve(makeFetchResponse(false, ''))
    })
    mockReaddirSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied, scandir \'/home\'')
    })

    const result = await scanAndAutoPair()
    // Should still return the agent (unpaired, since no config)
    expect(result).toHaveLength(1)
    expect(result[0].paired).toBe(false)
  })
})

describe('scanAndAutoPair — addCustomGateway throws (race condition)', () => {
  beforeEach(() => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('http://127.0.0.1:18757')) {
        return Promise.resolve(makeFetchResponse(true, makeHtmlResponse('Dave')))
      }
      return Promise.resolve(makeFetchResponse(false, ''))
    })
    mockReaddirSync.mockReturnValue(['dave'] as unknown as ReturnType<typeof readdirSync>)
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const fp = String(filePath)
      if (fp.endsWith('dave/.clawdbot/clawdbot.json')) {
        return JSON.stringify({ gateway: { port: 18757, auth: { token: 'tok-dave' } } })
      }
      throw new Error('ENOENT')
    })
    // Simulate race condition — id already exists
    mockAddCustomGateway.mockImplementation(() => {
      throw new Error('Gateway with id "dave" already exists')
    })
  })

  it('still reports agent as paired even if addCustomGateway throws', async () => {
    const result = await scanAndAutoPair()
    expect(result).toHaveLength(1)
    expect(result[0].paired).toBe(true)
  })
})
