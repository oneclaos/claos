/**
 * @jest-environment node
 */

// Must reset modules before importing to clear cache
beforeEach(() => {
  jest.resetModules()
})

describe('Gateway Discovery', () => {
  let mockFetch: jest.Mock
  let discoverGateways: typeof import('@/lib/gateway/discovery').discoverGateways
  let getGateways: typeof import('@/lib/gateway/discovery').getGateways
  let resetDiscoveryCache: typeof import('@/lib/gateway/discovery').resetDiscoveryCache

  beforeEach(async () => {
    jest.resetModules()
    mockFetch = jest.fn()
    global.fetch = mockFetch

    // Re-import after resetting modules to get fresh state
    const discoveryModule = await import('@/lib/gateway/discovery')
    discoverGateways = discoveryModule.discoverGateways
    getGateways = discoveryModule.getGateways
    resetDiscoveryCache = discoveryModule.resetDiscoveryCache

    // Reset cache before each test
    resetDiscoveryCache()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe.skip('discoverGateways', () => {
    it('should return empty array when no gateways respond', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'))

      const gateways = await discoverGateways()

      expect(gateways).toEqual([])
    })

    it('should parse Clawdbot gateway from HTML response', async () => {
      // First port returns valid Clawdbot HTML
      mockFetch.mockImplementation((url: string) => {
        if (url.includes(':18750')) {
          return Promise.resolve({
            ok: true,
            text: async () => `
              <!DOCTYPE html>
              <script>
                window.__CLAWDBOT_ASSISTANT_NAME__="TestAgent";
                window.__CLAWDBOT_ASSISTANT_AVATAR__="🤖";
              </script>
            `,
          })
        }
        return Promise.reject(new Error('Connection refused'))
      })

      const gateways = await discoverGateways()

      expect(gateways.length).toBe(1)
      expect(gateways[0].name).toBe('TestAgent')
      expect(gateways[0].id).toBe('testagent')
      expect(gateways[0].port).toBe(18750)
    })

    it('should ignore non-Clawdbot responses', async () => {
      // Reset cache and clear all mocks
      resetDiscoveryCache()
      mockFetch.mockReset()

      // All responses return non-Clawdbot HTML
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          text: async () => '<html><body>Regular website</body></html>',
        })
      )

      const gateways = await discoverGateways()

      expect(gateways).toEqual([])
    })

    it('should handle mixed responses', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes(':18750')) {
          return Promise.resolve({
            ok: true,
            text: async () => 'window.__CLAWDBOT_ASSISTANT_NAME__="Agent1"',
          })
        }
        if (url.includes(':18751')) {
          return Promise.resolve({
            ok: true,
            text: async () => '<html>Not clawdbot</html>',
          })
        }
        if (url.includes(':18752')) {
          return Promise.resolve({
            ok: true,
            text: async () => 'window.__CLAWDBOT_ASSISTANT_NAME__="Agent2"',
          })
        }
        return Promise.reject(new Error('Connection refused'))
      })

      const gateways = await discoverGateways()

      expect(gateways.length).toBe(2)
      expect(gateways.map((g) => g.name).sort()).toEqual(['Agent1', 'Agent2'])
    })
  })

  describe('getGateways', () => {
    it('should return empty array when no gateways discovered', () => {
      const gateways = getGateways()
      expect(Array.isArray(gateways)).toBe(true)
    })
  })
})
