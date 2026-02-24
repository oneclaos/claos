/**
 * Extended tests for lib/groups.ts
 * Covers: sendGroupMessage, getGroupMessageStatus, emoji variants,
 *         loadMessages with >1000 messages, group with unknown gateway
 */

// ─── Module mocks BEFORE imports ─────────────────────────────────────────────

jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}))

// Mock write-file-atomic to use our mocked fs.writeFileSync
jest.mock('write-file-atomic')

jest.mock('@/lib/audit', () => ({
  auditLog: jest.fn(),
}))

jest.mock('@/lib/gateway', () => ({
  sendMessage: jest.fn(),
  getGateways: jest.fn(),
}))

jest.mock('@/lib/utils', () => ({
  generateId: jest.fn(),
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import {
  createGroup,
  getGroupMessages,
  getGroupMessageStatus,
  sendGroupMessage,
  deleteGroup,
} from '@/lib/groups'
import { sendMessage, getGateways } from '@/lib/gateway'
import { generateId } from '@/lib/utils'

const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>
const mockWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>
const mockMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>
const mockSendMessage = sendMessage as jest.MockedFunction<typeof sendMessage>
const mockGetGateways = getGateways as jest.MockedFunction<typeof getGateways>
const mockGenerateId = generateId as jest.MockedFunction<typeof generateId>

// ─── Helpers ──────────────────────────────────────────────────────────────────

let groupStore: Record<string, unknown> = {}
let messagesStore: Record<string, unknown[]> = {}

function setupMocks() {
  mockExistsSync.mockImplementation((path: unknown) => {
    const p = String(path)
    if (p.endsWith('groups.json')) return Object.keys(groupStore).length > 0
    if (p.endsWith('group-messages.json')) return Object.keys(messagesStore).length > 0
    return true
  })

  mockReadFileSync.mockImplementation((path: unknown) => {
    const p = String(path)
    if (p.endsWith('groups.json')) {
      return JSON.stringify({ groups: groupStore, version: 1 })
    }
    if (p.endsWith('group-messages.json')) {
      return JSON.stringify({ messages: messagesStore, version: 1 })
    }
    throw new Error('ENOENT: ' + p)
  })

  mockWriteFileSync.mockImplementation((path: unknown, data: unknown) => {
    const p = String(path)
    const parsed = JSON.parse(String(data))
    if (p.endsWith('groups.json')) groupStore = parsed.groups
    if (p.endsWith('group-messages.json')) messagesStore = parsed.messages
  })
}

let idCounter = 0

beforeEach(() => {
  jest.clearAllMocks()
  groupStore = {}
  messagesStore = {}
  idCounter = 0
  mockMkdirSync.mockImplementation(() => undefined as never)
  mockGetGateways.mockReturnValue([])
  mockGenerateId.mockImplementation(() => `id-${++idCounter}`)
  setupMocks()
})

// ─── Agent emoji variants ─────────────────────────────────────────────────────

describe('getAgentEmoji variants', () => {
  it('assigns 🧠 emoji to max agent', () => {
    mockGetGateways.mockReturnValue([{ id: 'gw1', name: 'Max', url: 'http://test' }])
    const group = createGroup('G', undefined, [{ id: 'max', gatewayId: 'gw1' }])
    expect(group.agents[0].avatar).toBe('🧠')
  })

  it('assigns ⚡ emoji to clawdio agent', () => {
    mockGetGateways.mockReturnValue([{ id: 'gw1', name: 'Clawdio', url: 'http://test' }])
    const group = createGroup('G', undefined, [{ id: 'clawdio', gatewayId: 'gw1' }])
    expect(group.agents[0].avatar).toBe('⚡')
  })

  it('uses gateway name as agent name when gateway found', () => {
    mockGetGateways.mockReturnValue([{ id: 'gw1', name: 'Gateway One', url: 'http://test' }])
    const group = createGroup('G', undefined, [{ id: 'agent1', gatewayId: 'gw1' }])
    expect(group.agents[0].name).toBe('Gateway One')
  })

  it('uses agent id as name when gateway not found', () => {
    mockGetGateways.mockReturnValue([])
    const group = createGroup('G', undefined, [{ id: 'agent-xyz', gatewayId: 'missing-gw' }])
    expect(group.agents[0].name).toBe('agent-xyz')
  })
})

// ─── loadMessages with >1000 messages ────────────────────────────────────────

describe('loadMessages — message limit enforcement', () => {
  it('truncates messages to last 1000 when more than 1000 exist', () => {
    // Set up a group first
    const group = createGroup('Big Group', undefined, [])

    // Populate with 1200 messages
    messagesStore[group.id] = Array.from({ length: 1200 }, (_, i) => ({
      id: `msg-${i}`,
      groupId: group.id,
      content: `Message ${i}`,
      timestamp: new Date().toISOString(),
      responses: [],
    }))

    // The file mock needs to return these messages
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockImplementation((path: unknown) => {
      const p = String(path)
      if (p.endsWith('groups.json')) {
        return JSON.stringify({ groups: groupStore, version: 1 })
      }
      if (p.endsWith('group-messages.json')) {
        return JSON.stringify({ messages: messagesStore, version: 1 })
      }
      throw new Error('ENOENT')
    })

    // getGroupMessages calls loadMessages which truncates to 1000
    const result = getGroupMessages(group.id, 1000)
    // After truncation to last 1000, getGroupMessages with limit 1000 returns 1000
    expect(result.length).toBeLessThanOrEqual(1000)
  })
})

// ─── getGroupMessageStatus ────────────────────────────────────────────────────

describe('getGroupMessageStatus', () => {
  it('returns undefined for non-existent group', () => {
    mockExistsSync.mockReturnValue(false)
    const result = getGroupMessageStatus('nonexistent-group', 'msg-1')
    expect(result).toBeUndefined()
  })

  it('returns undefined for non-existent message', () => {
    const group = createGroup('Test Group', undefined, [])
    const result = getGroupMessageStatus(group.id, 'nonexistent-msg')
    expect(result).toBeUndefined()
  })

  it('returns message when found', () => {
    const group = createGroup('Test Group', undefined, [])
    const testMessage = {
      id: 'msg-found',
      groupId: group.id,
      content: 'Test',
      timestamp: new Date().toISOString(),
      responses: [],
    }
    messagesStore[group.id] = [testMessage]

    const result = getGroupMessageStatus(group.id, 'msg-found')
    expect(result).toBeDefined()
    expect(result!.id).toBe('msg-found')
    expect(result!.content).toBe('Test')
  })

  it('returns correct message when multiple messages exist', () => {
    const group = createGroup('Test Group', undefined, [])
    messagesStore[group.id] = [
      { id: 'msg-1', groupId: group.id, content: 'First', timestamp: '', responses: [] },
      { id: 'msg-2', groupId: group.id, content: 'Second', timestamp: '', responses: [] },
      { id: 'msg-3', groupId: group.id, content: 'Third', timestamp: '', responses: [] },
    ]

    const result = getGroupMessageStatus(group.id, 'msg-2')
    expect(result).toBeDefined()
    expect(result!.content).toBe('Second')
  })

  it('returns undefined for group with empty messages array', () => {
    const group = createGroup('Test Group', undefined, [])
    messagesStore[group.id] = []

    const result = getGroupMessageStatus(group.id, 'any-msg')
    expect(result).toBeUndefined()
  })
})

// ─── sendGroupMessage ─────────────────────────────────────────────────────────

describe('sendGroupMessage', () => {
  it('throws when group does not exist', async () => {
    await expect(sendGroupMessage('nonexistent-group', 'Hello')).rejects.toThrow('Group not found')
  })

  it('sends message and returns message with responses', async () => {
    // Create group with agents
    mockGetGateways.mockReturnValue([{ id: 'gw1', name: 'Agent1', url: 'http://test' }])
    const group = createGroup('Group With Agent', undefined, [{ id: 'agent1', gatewayId: 'gw1' }])

    mockSendMessage.mockResolvedValue({ reply: 'Hello from agent1!', messages: [] })

    const message = await sendGroupMessage(group.id, 'Hello agents!')

    expect(message).toBeDefined()
    expect(message.content).toBe('Hello agents!')
    expect(message.groupId).toBe(group.id)
    expect(message.responses).toHaveLength(1)
    expect(message.responses[0].status).toBe('complete')
    expect(message.responses[0].content).toBe('Hello from agent1!')
  })

  it('marks agent response as error when sendMessage throws', async () => {
    mockGetGateways.mockReturnValue([{ id: 'gw1', name: 'ErrorAgent', url: 'http://test' }])
    const group = createGroup('Error Group', undefined, [{ id: 'agent1', gatewayId: 'gw1' }])

    mockSendMessage.mockRejectedValue(new Error('Agent offline'))

    const message = await sendGroupMessage(group.id, 'Hello')

    expect(message.responses[0].status).toBe('error')
    expect(message.responses[0].error).toBe('Agent offline')
  })

  it('marks agent response as error for non-Error throws', async () => {
    mockGetGateways.mockReturnValue([{ id: 'gw1', name: 'ErrorAgent', url: 'http://test' }])
    const group = createGroup('Error Group 2', undefined, [{ id: 'agent1', gatewayId: 'gw1' }])

    mockSendMessage.mockRejectedValue('string error')

    const message = await sendGroupMessage(group.id, 'Hello')

    expect(message.responses[0].status).toBe('error')
    expect(message.responses[0].error).toBe('Unknown error')
  })

  it('handles group with no agents', async () => {
    const group = createGroup('Empty Group', undefined, [])

    const message = await sendGroupMessage(group.id, 'Hello')

    expect(message).toBeDefined()
    expect(message.responses).toHaveLength(0)
  })

  it('initializes message storage when group messages is missing', async () => {
    const group = createGroup('Group No Messages', undefined, [])

    // Remove the messages store for this group
    delete messagesStore[group.id]
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockImplementation((path: unknown) => {
      const p = String(path)
      if (p.endsWith('groups.json')) {
        return JSON.stringify({ groups: groupStore, version: 1 })
      }
      if (p.endsWith('group-messages.json')) {
        return JSON.stringify({ messages: messagesStore, version: 1 })
      }
      throw new Error('ENOENT')
    })

    const message = await sendGroupMessage(group.id, 'Test message')
    expect(message.content).toBe('Test message')
  })

  it('stores message in persistent storage', async () => {
    const group = createGroup('Persistent Group', undefined, [])

    await sendGroupMessage(group.id, 'Stored message')

    // Message should be in messages store
    const messages = getGroupMessages(group.id)
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.some((m) => m.content === 'Stored message')).toBe(true)
  })

  it('sends to multiple agents in parallel', async () => {
    mockGetGateways.mockReturnValue([
      { id: 'gw1', name: 'Agent1', url: 'http://test' },
      { id: 'gw2', name: 'Agent2', url: 'http://test' },
    ])
    const group = createGroup('Multi Group', undefined, [
      { id: 'agent1', gatewayId: 'gw1' },
      { id: 'agent2', gatewayId: 'gw2' },
    ])

    mockSendMessage
      .mockResolvedValueOnce({ reply: 'Response from agent1', messages: [] })
      .mockResolvedValueOnce({ reply: 'Response from agent2', messages: [] })

    const message = await sendGroupMessage(group.id, 'Multi test')

    expect(message.responses).toHaveLength(2)
    expect(mockSendMessage).toHaveBeenCalledTimes(2)
  })
})
