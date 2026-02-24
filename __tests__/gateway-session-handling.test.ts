/**
 * Tests for gateway and session handling
 * Validates gatewayIds, group sessions, and individual sessions
 */

import { isGroupSession } from '@/lib/session-utils'
import type { Session, Gateway } from '@/lib/types'

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionKey: 'test-session-key',
    gateway: 'james',
    gatewayName: 'James',
    ...overrides,
  }
}

function makeGateway(overrides: Partial<Gateway> = {}): Gateway {
  return {
    id: 'james',
    name: 'James',
    url: 'ws://127.0.0.1:18789',
    online: true,
    ...overrides,
  }
}

function makeGroupSession(gatewayIds: string[]): Session {
  return {
    sessionKey: `claos-multiagent-${Date.now()}`,
    gateway: gatewayIds[0] || '',
    gatewayName: gatewayIds.map((id) => id).join(' + '),
    kind: 'group',
    gatewayIds,
  }
}

// ─── gatewayIds Validation ────────────────────────────────────────────────────

describe('gatewayIds validation', () => {
  describe('filtering invalid values', () => {
    it('should filter out undefined values from gatewayIds', () => {
      const rawIds: (string | undefined)[] = ['james', undefined, 'hunter']
      const filtered = rawIds.filter((id): id is string => !!id && typeof id === 'string')

      expect(filtered).toEqual(['james', 'hunter'])
      expect(filtered).not.toContain(undefined)
    })

    it('should filter out null values from gatewayIds', () => {
      const rawIds: (string | null)[] = ['james', null, 'hunter']
      const filtered = rawIds.filter((id): id is string => !!id && typeof id === 'string')

      expect(filtered).toEqual(['james', 'hunter'])
      expect(filtered).not.toContain(null)
    })

    it('should filter out empty strings from gatewayIds', () => {
      const rawIds = ['james', '', 'hunter', '   ']
      const filtered = rawIds.filter(
        (id): id is string => !!id && typeof id === 'string' && id.trim() !== ''
      )

      expect(filtered).toEqual(['james', 'hunter'])
    })

    it('should handle completely empty array', () => {
      const rawIds: string[] = []
      const filtered = rawIds.filter((id): id is string => !!id)

      expect(filtered).toEqual([])
      expect(filtered.length).toBe(0)
    })

    it('should handle array with only invalid values', () => {
      const rawIds: (string | undefined | null)[] = [undefined, null, '', '  ']
      const filtered = rawIds.filter(
        (id): id is string => !!id && typeof id === 'string' && id.trim() !== ''
      )

      expect(filtered).toEqual([])
    })
  })

  describe('validating against known gateways', () => {
    const availableGateways: Gateway[] = [
      makeGateway({ id: 'james', name: 'James' }),
      makeGateway({ id: 'hunter', name: 'Hunter' }),
      makeGateway({ id: 'moltbot', name: 'Moltbot' }),
    ]

    it('should only keep gatewayIds that exist in available gateways', () => {
      const rawIds = ['james', 'unknown-agent', 'hunter']
      const filtered = rawIds.filter((id) => availableGateways.some((g) => g.id === id))

      expect(filtered).toEqual(['james', 'hunter'])
      expect(filtered).not.toContain('unknown-agent')
    })

    it('should return empty array if no gatewayIds exist in available gateways', () => {
      const rawIds = ['fake1', 'fake2', 'nonexistent']
      const filtered = rawIds.filter((id) => availableGateways.some((g) => g.id === id))

      expect(filtered).toEqual([])
    })

    it('should preserve all valid gatewayIds', () => {
      const rawIds = ['james', 'hunter', 'moltbot']
      const filtered = rawIds.filter((id) => availableGateways.some((g) => g.id === id))

      expect(filtered).toEqual(['james', 'hunter', 'moltbot'])
      expect(filtered.length).toBe(3)
    })
  })
})

// ─── Group Sessions ───────────────────────────────────────────────────────────

describe('group sessions', () => {
  describe('identification', () => {
    it('should identify group session by sessionKey prefix', () => {
      const session = makeGroupSession(['james', 'hunter'])
      expect(isGroupSession(session)).toBe(true)
    })

    it('should identify group session by kind', () => {
      const session = makeSession({ kind: 'group', sessionKey: 'claos-multiagent-123' })
      expect(isGroupSession(session)).toBe(true)
    })

    it('should not identify regular session as group', () => {
      const session = makeSession({ sessionKey: 'claos-web-123' })
      expect(isGroupSession(session)).toBe(false)
    })

    it('should not identify session with similar prefix as group', () => {
      const session = makeSession({ sessionKey: 'claos-multi-123' })
      expect(isGroupSession(session)).toBe(false)
    })
  })

  describe('gatewayIds requirements', () => {
    it('should have at least 2 gatewayIds for a valid group', () => {
      const session = makeGroupSession(['james', 'hunter'])
      expect(session.gatewayIds?.length).toBeGreaterThanOrEqual(2)
    })

    it('should consider group invalid with only 1 gatewayId', () => {
      const session = makeGroupSession(['james'])
      const isValid = (session.gatewayIds?.length ?? 0) >= 2
      expect(isValid).toBe(false)
    })

    it('should consider group invalid with empty gatewayIds', () => {
      const session = makeGroupSession([])
      const isValid = (session.gatewayIds?.length ?? 0) >= 2
      expect(isValid).toBe(false)
    })

    it('should handle undefined gatewayIds gracefully', () => {
      const session = makeSession({
        sessionKey: 'claos-multiagent-123',
        kind: 'group',
        gatewayIds: undefined,
      })
      const gatewayIds = session.gatewayIds ?? []
      expect(gatewayIds.length).toBe(0)
    })
  })

  describe('gatewayIds preservation', () => {
    it('should preserve gatewayIds when serializing/deserializing', () => {
      const original = makeGroupSession(['james', 'hunter', 'moltbot'])
      const serialized = JSON.stringify(original)
      const deserialized: Session = JSON.parse(serialized)

      expect(deserialized.gatewayIds).toEqual(['james', 'hunter', 'moltbot'])
    })

    it('should preserve gatewayIds order', () => {
      const original = makeGroupSession(['moltbot', 'james', 'hunter'])
      const serialized = JSON.stringify(original)
      const deserialized: Session = JSON.parse(serialized)

      expect(deserialized.gatewayIds).toEqual(['moltbot', 'james', 'hunter'])
    })
  })
})

// ─── Individual Sessions ──────────────────────────────────────────────────────

describe('individual sessions', () => {
  describe('gateway property', () => {
    it('should have a valid gateway property', () => {
      const session = makeSession({ gateway: 'james' })
      expect(session.gateway).toBe('james')
      expect(typeof session.gateway).toBe('string')
    })

    it('should fallback to gateway when gatewayIds is undefined', () => {
      const session = makeSession({ gateway: 'james', gatewayIds: undefined })
      const gatewayIds = session.gatewayIds ?? [session.gateway]

      expect(gatewayIds).toEqual(['james'])
    })

    it('should handle empty gateway gracefully', () => {
      const session = makeSession({ gateway: '' })
      const gatewayIds = session.gatewayIds ?? [session.gateway]
      const filtered = gatewayIds.filter((id) => !!id)

      expect(filtered).toEqual([])
    })
  })

  describe('sessionKey format', () => {
    it('should accept various sessionKey formats', () => {
      const formats = [
        'claos-web-123',
        'claos-james-456',
        'agent:main:main',
        'webchat-session-789',
      ]

      formats.forEach((key) => {
        const session = makeSession({ sessionKey: key })
        expect(session.sessionKey).toBe(key)
        expect(isGroupSession(session)).toBe(false)
      })
    })
  })
})

// ─── Session Data Integrity ───────────────────────────────────────────────────

describe('session data integrity', () => {
  describe('required fields', () => {
    it('should have sessionKey', () => {
      const session = makeSession()
      expect(session.sessionKey).toBeDefined()
      expect(typeof session.sessionKey).toBe('string')
    })

    it('should have gateway', () => {
      const session = makeSession()
      expect(session.gateway).toBeDefined()
    })

    it('should have gatewayName', () => {
      const session = makeSession()
      expect(session.gatewayName).toBeDefined()
    })
  })

  describe('merging sessions', () => {
    it('should preserve gatewayIds when merging sessions', () => {
      const serverSession = makeSession({
        sessionKey: 'claos-multiagent-123',
        gateway: 'james',
        gatewayIds: undefined, // Server doesn't know about group composition
      })

      const savedGroup = makeGroupSession(['james', 'hunter', 'moltbot'])
      savedGroup.sessionKey = 'claos-multiagent-123'

      // Merge: preserve gatewayIds from saved group
      const merged = {
        ...serverSession,
        gatewayIds: savedGroup.gatewayIds,
      }

      expect(merged.gatewayIds).toEqual(['james', 'hunter', 'moltbot'])
    })

    it('should not overwrite existing gatewayIds with undefined', () => {
      const original = makeGroupSession(['james', 'hunter'])
      const update: Partial<Session> = { customName: 'My Group', gatewayIds: undefined }

      // Proper merge should preserve gatewayIds
      const merged: Session = {
        ...original,
        ...update,
        gatewayIds: update.gatewayIds ?? original.gatewayIds,
      }

      expect(merged.gatewayIds).toEqual(['james', 'hunter'])
    })
  })
})

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('should handle session with both gateway and gatewayIds', () => {
    const session = makeSession({
      gateway: 'james',
      gatewayIds: ['james', 'hunter'],
    })

    // For group sessions, gatewayIds takes precedence
    const idsToUse = session.gatewayIds?.length ? session.gatewayIds : [session.gateway]
    expect(idsToUse).toEqual(['james', 'hunter'])
  })

  it('should handle numeric-looking gatewayIds', () => {
    // Some gateways might have IDs like "agent-18750"
    const session = makeGroupSession(['agent-18750', 'agent-18789'])
    expect(session.gatewayIds).toEqual(['agent-18750', 'agent-18789'])
  })

  it('should handle special characters in gatewayIds', () => {
    const session = makeGroupSession(['james_v2', 'hunter-test', 'moltbot.dev'])
    expect(session.gatewayIds).toEqual(['james_v2', 'hunter-test', 'moltbot.dev'])
  })

  it('should handle very long gatewayIds arrays', () => {
    const manyIds = Array.from({ length: 10 }, (_, i) => `agent-${i}`)
    const session = makeGroupSession(manyIds)

    expect(session.gatewayIds?.length).toBe(10)
  })

  it('should handle duplicate gatewayIds', () => {
    const rawIds = ['james', 'hunter', 'james', 'moltbot', 'hunter']
    const unique = [...new Set(rawIds)]

    expect(unique).toEqual(['james', 'hunter', 'moltbot'])
  })
})
