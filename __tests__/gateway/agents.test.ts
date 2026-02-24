/**
 * Tests for lib/gateway/agents.ts
 * Agent discovery and gateway listing — mocks discovery + http-client
 */

// ─── Module mocks BEFORE imports ─────────────────────────────────────────────

jest.mock('@/lib/gateway/discovery', () => ({
  discoverGateways: jest.fn(),
  getGateways: jest.fn(),
}))

jest.mock('@/lib/gateway/http-client', () => ({
  checkGatewayHealth: jest.fn(),
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { getAvailableAgents, listGatewaysWithStatus, isGatewayHealthy } from '@/lib/gateway/agents'
import { discoverGateways, getGateways } from '@/lib/gateway/discovery'
import { checkGatewayHealth } from '@/lib/gateway/http-client'
import type { GatewayConfig } from '@/lib/gateway/types'

const mockDiscoverGateways = discoverGateways as jest.MockedFunction<typeof discoverGateways>
const mockGetGateways = getGateways as jest.MockedFunction<typeof getGateways>
const mockCheckGatewayHealth = checkGatewayHealth as jest.MockedFunction<typeof checkGatewayHealth>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGateway(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    id: 'gw1',
    name: 'James',
    url: 'http://127.0.0.1:18750',
    port: 18750,
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  mockDiscoverGateways.mockResolvedValue([])
  mockGetGateways.mockReturnValue([])
  mockCheckGatewayHealth.mockResolvedValue(false)
})

describe('getAvailableAgents', () => {
  it('returns empty array when no gateways discovered', async () => {
    mockDiscoverGateways.mockResolvedValue([])
    const result = await getAvailableAgents()
    expect(result).toEqual([])
  })

  it('maps gateways to agents', async () => {
    mockDiscoverGateways.mockResolvedValue([
      makeGateway({ id: 'james', name: 'James' })
    ])

    const result = await getAvailableAgents()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('james')
    expect(result[0].name).toBe('James')
    expect(result[0].gatewayId).toBe('james')
    expect(result[0].description).toBe('Chat with James')
  })

  it('assigns known emojis to known agents', async () => {
    const namedAgents = ['james', 'hunter', 'moltbot', 'clawdio', 'max', 'claude', 'cursor']
    for (const name of namedAgents) {
      mockDiscoverGateways.mockResolvedValue([makeGateway({ id: name, name })])
      const result = await getAvailableAgents()
      expect(result[0].avatar).not.toBe('💬') // Should have a specific emoji
    }
  })

  it('assigns default emoji to unknown agents', async () => {
    mockDiscoverGateways.mockResolvedValue([
      makeGateway({ id: 'unknown-bot', name: 'Unknown Bot' })
    ])
    const result = await getAvailableAgents()
    expect(result[0].avatar).toBe('💬')
  })

  it('assigns openclaw emoji to openclaw agents', async () => {
    mockDiscoverGateways.mockResolvedValue([
      makeGateway({ id: 'openclaw', name: 'OpenClaw' })
    ])
    const result = await getAvailableAgents()
    expect(result[0].avatar).toBe('🦞')
  })

  it('maps multiple gateways', async () => {
    mockDiscoverGateways.mockResolvedValue([
      makeGateway({ id: 'james', name: 'James' }),
      makeGateway({ id: 'max', name: 'Max' }),
    ])

    const result = await getAvailableAgents()
    expect(result).toHaveLength(2)
  })
})

describe('listGatewaysWithStatus', () => {
  it('returns empty array when no gateways', async () => {
    mockDiscoverGateways.mockResolvedValue([])
    const result = await listGatewaysWithStatus()
    expect(result).toEqual([])
  })

  it('marks all discovered gateways as online', async () => {
    mockDiscoverGateways.mockResolvedValue([
      makeGateway({ id: 'gw1', name: 'GW 1' }),
      makeGateway({ id: 'gw2', name: 'GW 2' }),
    ])

    const result = await listGatewaysWithStatus()
    expect(result).toHaveLength(2)
    expect(result[0].online).toBe(true)
    expect(result[1].online).toBe(true)
  })

  it('includes all gateway fields', async () => {
    mockDiscoverGateways.mockResolvedValue([
      makeGateway({ id: 'gw1', name: 'GW 1', url: 'http://test.com', port: 18750 })
    ])

    const result = await listGatewaysWithStatus()
    expect(result[0].id).toBe('gw1')
    expect(result[0].name).toBe('GW 1')
    expect(result[0].url).toBe('http://test.com')
    expect(result[0].port).toBe(18750)
  })
})

describe('isGatewayHealthy', () => {
  it('returns false when gateway not found', async () => {
    mockGetGateways.mockReturnValue([])
    const result = await isGatewayHealthy('nonexistent')
    expect(result).toBe(false)
  })

  it('returns true when gateway is healthy', async () => {
    mockGetGateways.mockReturnValue([makeGateway({ id: 'gw1' })])
    mockCheckGatewayHealth.mockResolvedValue(true)

    const result = await isGatewayHealthy('gw1')
    expect(result).toBe(true)
  })

  it('returns false when gateway is unhealthy', async () => {
    mockGetGateways.mockReturnValue([makeGateway({ id: 'gw1' })])
    mockCheckGatewayHealth.mockResolvedValue(false)

    const result = await isGatewayHealthy('gw1')
    expect(result).toBe(false)
  })
})
