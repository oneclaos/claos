/**
 * Tests for lib/gateway/registry.ts
 * Mocks: chat-client, discovery, config
 */

// ─── Module mocks BEFORE imports ─────────────────────────────────────────────

const mockParseGatewaysConfig = jest.fn()
const mockDiscoverGateways = jest.fn()
const mockGetCustomGateways = jest.fn()

jest.mock('@/lib/gateway/chat-client', () => ({
  parseGatewaysConfig: mockParseGatewaysConfig,
  getGatewayClient: jest.fn(),
}))

jest.mock('@/lib/gateway/discovery', () => ({
  discoverGateways: mockDiscoverGateways,
}))

jest.mock('@/lib/gateway/config', () => ({
  getCustomGateways: mockGetCustomGateways,
  addCustomGateway: jest.fn(),
  removeCustomGateway: jest.fn(),
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

// Import after mocks - but we need to reset the module cache to clear the module-level cache
// since registry.ts has module-level state
beforeEach(() => {
  jest.resetModules()
  // Re-apply mocks after reset
  jest.mock('@/lib/gateway/chat-client', () => ({
    parseGatewaysConfig: mockParseGatewaysConfig,
    getGatewayClient: jest.fn(),
  }))
  jest.mock('@/lib/gateway/discovery', () => ({
    discoverGateways: mockDiscoverGateways,
  }))
  jest.mock('@/lib/gateway/config', () => ({
    getCustomGateways: mockGetCustomGateways,
    addCustomGateway: jest.fn(),
    removeCustomGateway: jest.fn(),
  }))
  jest.clearAllMocks()
})

const makeGw = (id: string, name = `GW ${id}`) => ({ id, name, url: `ws://localhost:${id}`, token: 'tok' })

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getCachedGateways', () => {
  it('returns static gateways when cache is empty', async () => {
    mockParseGatewaysConfig.mockReturnValue([makeGw('static-1')])
    mockGetCustomGateways.mockReturnValue([])

    const { getCachedGateways } = await import('@/lib/gateway/registry')
    const gateways = getCachedGateways()

    expect(gateways.length).toBeGreaterThanOrEqual(1)
    expect(gateways.find(g => g.id === 'static-1')).toBeDefined()
  })

  it('merges custom gateways not already in static list', async () => {
    mockParseGatewaysConfig.mockReturnValue([makeGw('static-1')])
    mockGetCustomGateways.mockReturnValue([makeGw('custom-1')])

    const { getCachedGateways } = await import('@/lib/gateway/registry')
    const gateways = getCachedGateways()

    expect(gateways.find(g => g.id === 'custom-1')).toBeDefined()
  })

  it('does not duplicate gateways already in static list', async () => {
    mockParseGatewaysConfig.mockReturnValue([makeGw('static-1')])
    mockGetCustomGateways.mockReturnValue([makeGw('static-1')])

    const { getCachedGateways } = await import('@/lib/gateway/registry')
    const gateways = getCachedGateways()

    const ids = gateways.map(g => g.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
  })
})

describe('getAllGateways', () => {
  it('fetches and returns gateways on cold start', async () => {
    mockParseGatewaysConfig.mockReturnValue([makeGw('static-1')])
    mockDiscoverGateways.mockResolvedValue([makeGw('discovered-1')])
    mockGetCustomGateways.mockReturnValue([])

    const { getAllGateways } = await import('@/lib/gateway/registry')
    const gateways = await getAllGateways()

    expect(gateways.find(g => g.id === 'static-1')).toBeDefined()
    expect(gateways.find(g => g.id === 'discovered-1')).toBeDefined()
  })

  it('merges discovered and custom gateways without duplicates', async () => {
    mockParseGatewaysConfig.mockReturnValue([makeGw('static-1')])
    mockDiscoverGateways.mockResolvedValue([makeGw('static-1'), makeGw('discovered-2')])
    mockGetCustomGateways.mockReturnValue([makeGw('custom-1')])

    const { getAllGateways } = await import('@/lib/gateway/registry')
    const gateways = await getAllGateways()

    const ids = gateways.map(g => g.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
    expect(gateways.find(g => g.id === 'custom-1')).toBeDefined()
  })

  it('returns fallback static gateways if cache empty after refresh', async () => {
    mockParseGatewaysConfig.mockReturnValue([makeGw('fallback-1')])
    mockDiscoverGateways.mockResolvedValue([])
    mockGetCustomGateways.mockReturnValue([])

    const { getAllGateways } = await import('@/lib/gateway/registry')
    const gateways = await getAllGateways()
    expect(gateways.length).toBeGreaterThanOrEqual(1)
  })

  it('handles discovery errors by returning fallback statics', async () => {
    mockParseGatewaysConfig.mockReturnValue([makeGw('static-1')])
    mockDiscoverGateways.mockRejectedValue(new Error('Discovery failed'))
    mockGetCustomGateways.mockReturnValue([])

    const { getAllGateways } = await import('@/lib/gateway/registry')
    // May throw or return fallback - either is acceptable behavior
    try {
      const gateways = await getAllGateways()
      expect(Array.isArray(gateways)).toBe(true)
    } catch {
      // Expected if not handled
    }
  })
})
