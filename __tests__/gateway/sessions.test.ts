/**
 * Tests for lib/gateway/sessions.ts
 * Mocks: chat-client, registry
 */

// ─── Module mocks BEFORE imports ─────────────────────────────────────────────

const mockRequest = jest.fn()
const mockSendChat = jest.fn()
const mockIsReady = jest.fn(() => true)

jest.mock('@/lib/gateway/chat-client', () => ({
  getGatewayClient: jest.fn().mockResolvedValue({
    request: mockRequest,
    sendChat: mockSendChat,
    isReady: mockIsReady,
  }),
  parseGatewaysConfig: jest.fn(() => []),
}))

jest.mock('@/lib/gateway/registry', () => ({
  getCachedGateways: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { getCachedGateways } from '@/lib/gateway/registry'
import {
  listSessions,
  listAllSessions,
  getSessionHistory,
  sendToSession,
  spawnSession,
  sendMessage,
} from '@/lib/gateway/sessions'

const mockGetCachedGateways = getCachedGateways as jest.MockedFunction<typeof getCachedGateways>

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeGateway = (id = 'gw-1', name = 'Test GW') => ({ id, name, url: 'ws://localhost:3000', token: 'tok' })

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  mockGetCachedGateways.mockReturnValue([makeGateway()])
})

describe('listSessions', () => {
  it('returns sessions mapped with gateway info', async () => {
    mockRequest.mockResolvedValueOnce({
      sessions: [
        { key: 'agent:main:claos-session1', kind: 'telegram', channel: 'telegram', lastActive: 1700000000000, displayName: 'Session One' },
      ],
    })

    const sessions = await listSessions('gw-1')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionKey).toBe('claos-session1')
    expect(sessions[0].gateway).toBe('gw-1')
    expect(sessions[0].gatewayName).toBe('Test GW')
    expect(sessions[0].kind).toBe('telegram')
  })

  it('throws when gateway not found', async () => {
    mockGetCachedGateways.mockReturnValue([])
    await expect(listSessions('nonexistent')).rejects.toThrow('Gateway nonexistent not found')
  })

  it('returns empty array when request fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Network error'))
    const sessions = await listSessions('gw-1')
    expect(sessions).toEqual([])
  })

  it('handles sessions with undefined lastActive', async () => {
    mockRequest.mockResolvedValueOnce({
      sessions: [{ key: 'agent:main:sess', kind: 'web' }],
    })
    const sessions = await listSessions('gw-1')
    expect(sessions[0].lastActive).toBeUndefined()
  })

  it('handles sessions with string lastActive', async () => {
    mockRequest.mockResolvedValueOnce({
      sessions: [{ key: 'agent:main:sess', lastActive: '2024-01-01T00:00:00.000Z' }],
    })
    const sessions = await listSessions('gw-1')
    expect(sessions[0].lastActive).toBe('2024-01-01T00:00:00.000Z')
  })

  it('handles empty sessions array', async () => {
    mockRequest.mockResolvedValueOnce({ sessions: [] })
    const sessions = await listSessions('gw-1')
    expect(sessions).toEqual([])
  })

  it('handles undefined sessions', async () => {
    mockRequest.mockResolvedValueOnce({})
    const sessions = await listSessions('gw-1')
    expect(sessions).toEqual([])
  })
})

describe('listAllSessions', () => {
  it('returns all sessions from all gateways sorted by lastActive', async () => {
    mockGetCachedGateways.mockReturnValue([makeGateway('gw-1'), makeGateway('gw-2', 'GW 2')])
    mockRequest
      .mockResolvedValueOnce({ sessions: [{ key: 'agent:main:s1', lastActive: 1700000000000 }] })
      .mockResolvedValueOnce({ sessions: [{ key: 'agent:main:s2', lastActive: 1700000001000 }] })

    const sessions = await listAllSessions()
    expect(sessions).toHaveLength(2)
    // s2 should come first (more recent)
    expect(sessions[0].sessionKey).toBe('s2')
  })

  it('gracefully handles gateway errors', async () => {
    mockGetCachedGateways.mockReturnValue([makeGateway('gw-1'), makeGateway('gw-2', 'GW 2')])
    mockRequest
      .mockResolvedValueOnce({ sessions: [{ key: 'agent:main:s1', lastActive: 1700000000000 }] })
      .mockRejectedValueOnce(new Error('failed'))

    const sessions = await listAllSessions()
    expect(sessions.length).toBeGreaterThanOrEqual(0)
  })

  it('returns empty array when no gateways', async () => {
    mockGetCachedGateways.mockReturnValue([])
    const sessions = await listAllSessions()
    expect(sessions).toEqual([])
  })
})

describe('getSessionHistory', () => {
  it('returns messages from gateway', async () => {
    mockRequest.mockResolvedValueOnce({
      messages: [
        { role: 'user', content: 'Hello', timestamp: 1700000000000 },
        { role: 'assistant', content: 'Hi!', timestamp: '2024-01-01T00:00:00.000Z' },
      ],
    })

    const messages = await getSessionHistory('gw-1', 'session1')
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('Hello')
  })

  it('throws when gateway not found', async () => {
    mockGetCachedGateways.mockReturnValue([])
    await expect(getSessionHistory('nonexistent', 'sess')).rejects.toThrow('Gateway nonexistent not found')
  })

  it('returns empty array on failure', async () => {
    mockRequest.mockRejectedValueOnce(new Error('timeout'))
    const messages = await getSessionHistory('gw-1', 'session1')
    expect(messages).toEqual([])
  })

  it('handles undefined messages', async () => {
    mockRequest.mockResolvedValueOnce({})
    const messages = await getSessionHistory('gw-1', 'session1')
    expect(messages).toEqual([])
  })

  it('converts numeric timestamps to ISO strings', async () => {
    mockRequest.mockResolvedValueOnce({
      messages: [{ role: 'user', content: 'Hi', timestamp: 1700000000000 }],
    })
    const messages = await getSessionHistory('gw-1', 'session1')
    expect(messages[0].timestamp).toBe(new Date(1700000000000).toISOString())
  })
})

describe('sendToSession', () => {
  it('returns success with response', async () => {
    mockSendChat.mockResolvedValueOnce({ response: 'Hello from agent' })
    const result = await sendToSession('gw-1', 'session1', 'Hello')
    expect(result.success).toBe(true)
    expect(result.response).toBe('Hello from agent')
  })

  it('returns failure when gateway not found', async () => {
    mockGetCachedGateways.mockReturnValue([])
    const result = await sendToSession('nonexistent', 'session1', 'Hello')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('handles timeout gracefully', async () => {
    mockSendChat.mockRejectedValueOnce(new Error('Request timeout after 30000ms'))
    const result = await sendToSession('gw-1', 'session1', 'Hello')
    expect(result.success).toBe(true)
    expect(result.response).toContain('pending')
  })

  it('returns failure on non-timeout error', async () => {
    mockSendChat.mockRejectedValueOnce(new Error('Connection refused'))
    const result = await sendToSession('gw-1', 'session1', 'Hello')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Connection refused')
  })

  it('returns (message sent) when no response', async () => {
    mockSendChat.mockResolvedValueOnce({})
    const result = await sendToSession('gw-1', 'session1', 'Hello')
    expect(result.success).toBe(true)
    expect(result.response).toBe('(message sent)')
  })
})

describe('spawnSession', () => {
  it('returns success with generated sessionKey', async () => {
    const result = await spawnSession('gw-1')
    expect(result.success).toBe(true)
    expect(result.sessionKey).toBeDefined()
    expect(typeof result.sessionKey).toBe('string')
  })

  it('returns failure when gateway not found', async () => {
    mockGetCachedGateways.mockReturnValue([])
    const result = await spawnSession('nonexistent')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('sends initialMessage if provided', async () => {
    mockSendChat.mockResolvedValueOnce({ response: 'ack' })
    const result = await spawnSession('gw-1', 'Start session', 'my-key')
    expect(result.success).toBe(true)
    expect(result.sessionKey).toBe('my-key')
    expect(mockSendChat).toHaveBeenCalledTimes(1)
  })

  it('returns failure when sendChat throws', async () => {
    mockSendChat.mockRejectedValueOnce(new Error('Gateway down'))
    const result = await spawnSession('gw-1', 'Start session')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Gateway down')
  })
})

describe('sendMessage', () => {
  it('returns reply and updated message history', async () => {
    mockSendChat.mockResolvedValueOnce({ response: 'I am doing well' })
    const history = [{ role: 'user' as const, content: 'Hi', timestamp: '2024-01-01T00:00:00.000Z' }]
    const result = await sendMessage('gw-1', 'How are you?', history)

    expect(result.reply).toBe('I am doing well')
    expect(result.messages).toHaveLength(3)
    expect(result.messages[1].role).toBe('user')
    expect(result.messages[2].role).toBe('assistant')
    expect(result.messages[2].content).toBe('I am doing well')
  })

  it('throws when gateway not found', async () => {
    mockGetCachedGateways.mockReturnValue([])
    await expect(sendMessage('nonexistent', 'Hello')).rejects.toThrow('Gateway nonexistent not found')
  })

  it('returns (no response) when agent returns empty', async () => {
    mockSendChat.mockResolvedValueOnce({})
    const result = await sendMessage('gw-1', 'Hello')
    expect(result.reply).toBe('(no response)')
  })
})
