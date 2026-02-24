/**
 * Tests for lib/session-utils.ts
 * Pure functions — no mocks needed
 */

import {
  sessionDisplayName,
  isGroupSession,
  parseGroupMessage,
  gwDisplayName,
  gwPortLabel,
} from '@/lib/session-utils'
import type { Session, Gateway } from '@/lib/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionKey: 'test-session-key',
    gateway: 'gw1',
    gatewayName: 'Agent James',
    ...overrides,
  }
}

function makeGateway(overrides: Partial<Gateway> = {}): Gateway {
  return {
    id: 'gw1',
    name: 'Agent James',
    url: 'http://127.0.0.1:18750',
    online: true,
    ...overrides,
  }
}

// ─── sessionDisplayName ───────────────────────────────────────────────────────

describe('sessionDisplayName', () => {
  it('returns customName if set', () => {
    const s = makeSession({ customName: 'My Custom Name' })
    expect(sessionDisplayName(s)).toBe('My Custom Name')
  })

  it('returns gatewayName for regular sessions', () => {
    const s = makeSession({ gatewayName: 'Agent James' })
    expect(sessionDisplayName(s)).toBe('Agent James')
  })

  it('returns sessionKey as fallback if no gatewayName', () => {
    const s = makeSession({ gatewayName: undefined })
    expect(sessionDisplayName(s)).toBe('test-session-key')
  })

  it('returns cleaned group name from label for group sessions', () => {
    const s = makeSession({
      sessionKey: 'claos-multiagent-abc123',
      label: 'telegram:-1003123456',
      gatewayName: 'Gateway',
    })
    const result = sessionDisplayName(s)
    // Should clean the "telegram:" prefix
    expect(result).not.toContain('telegram:')
  })

  it('returns gatewayName for group sessions with no useful label', () => {
    const s = makeSession({
      sessionKey: 'claos-multiagent-abc123',
      label: 'claos-multiagent-abc123', // same as sessionKey → not useful
      gatewayName: 'Gateway',
    })
    // label === sessionKey → falls through to gatewayName
    const result = sessionDisplayName(s)
    expect(result).toBe('Gateway')
  })

  it('handles kind=group sessions', () => {
    const s = makeSession({
      sessionKey: 'some-session',
      kind: 'group',
      label: 'my-cool-group',
      gatewayName: 'Gateway',
    })
    const result = sessionDisplayName(s)
    expect(result).toBeTruthy()
  })
})

// ─── isGroupSession ───────────────────────────────────────────────────────────

describe('isGroupSession', () => {
  it('returns true for multiagent sessions', () => {
    expect(isGroupSession(makeSession({ sessionKey: 'claos-multiagent-123' }))).toBe(true)
  })

  // Note: isGroupSession only checks sessionKey prefix, not kind
  // kind is not reliable from the server (comes as 'other')
  it('returns true for multiagent sessionKey regardless of kind', () => {
    expect(
      isGroupSession(makeSession({ kind: 'group', sessionKey: 'claos-multiagent-456' }))
    ).toBe(true)
  })

  it('returns false for regular sessions', () => {
    expect(isGroupSession(makeSession({ sessionKey: 'regular-session' }))).toBe(false)
  })

  it('returns false for sessions with similar but different prefix', () => {
    expect(isGroupSession(makeSession({ sessionKey: 'claos-web-abc' }))).toBe(false)
  })
})

// ─── parseGroupMessage ────────────────────────────────────────────────────────

describe('parseGroupMessage', () => {
  it('parses a message with agent prefix', () => {
    const result = parseGroupMessage('**James**: Hello there!')
    expect(result.agent).toBe('James')
    expect(result.text).toBe('Hello there!')
  })

  it('returns null agent for regular messages', () => {
    const result = parseGroupMessage('Just a plain message')
    expect(result.agent).toBeNull()
    expect(result.text).toBe('Just a plain message')
  })

  it('handles multi-line text after prefix', () => {
    const result = parseGroupMessage('**Claude**: Line one\nLine two')
    expect(result.agent).toBe('Claude')
    expect(result.text).toBe('Line one\nLine two')
  })

  it('handles empty content', () => {
    const result = parseGroupMessage('')
    expect(result.agent).toBeNull()
    expect(result.text).toBe('')
  })

  it('handles agent name with spaces', () => {
    const result = parseGroupMessage('**Agent Max**: Response here')
    expect(result.agent).toBe('Agent Max')
    expect(result.text).toBe('Response here')
  })

  it('does not parse partial bold prefix', () => {
    const result = parseGroupMessage('*James*: Not a group message')
    expect(result.agent).toBeNull()
  })
})

// ─── gwDisplayName ────────────────────────────────────────────────────────────

describe('gwDisplayName', () => {
  it('returns gateway name', () => {
    const gw = makeGateway({ name: 'My VPS Agent' })
    expect(gwDisplayName(gw)).toBe('My VPS Agent')
  })
})

// ─── gwPortLabel ─────────────────────────────────────────────────────────────

describe('gwPortLabel', () => {
  it('returns ":port" for gateways with port', () => {
    const gw = makeGateway({ port: 18750 })
    expect(gwPortLabel(gw)).toBe(':18750')
  })

  it('returns null for gateways without port', () => {
    const gw = makeGateway({ port: undefined })
    expect(gwPortLabel(gw)).toBeNull()
  })

  it('returns null for port 0', () => {
    const gw = makeGateway({ port: 0 })
    expect(gwPortLabel(gw)).toBeNull()
  })
})
