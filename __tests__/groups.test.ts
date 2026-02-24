/**
 * Tests for lib/groups.ts
 * Agent group CRUD + messaging — mocks fs + gateway
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
  generateId: jest.fn(() => 'test-id-' + Math.random().toString(36).substring(2, 8)),
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import {
  createGroup,
  getGroup,
  listGroups,
  deleteGroup,
  updateGroup,
  getGroupMessages,
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
    return true // DATA_DIR exists
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
    if (p.endsWith('groups.json')) {
      groupStore = parsed.groups
    }
    if (p.endsWith('group-messages.json')) {
      messagesStore = parsed.messages
    }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  groupStore = {}
  messagesStore = {}
  mockMkdirSync.mockImplementation(() => undefined as never)
  mockGetGateways.mockReturnValue([])
  let idCounter = 0
  mockGenerateId.mockImplementation(() => `test-id-${++idCounter}`)
  setupMocks()
})

// ─── createGroup ──────────────────────────────────────────────────────────────

describe('createGroup', () => {
  it('creates a group with the given name', () => {
    const group = createGroup('Test Group', 'A test', [])
    expect(group.name).toBe('Test Group')
    expect(group.description).toBe('A test')
  })

  it('assigns agents to the group', () => {
    mockGetGateways.mockReturnValue([{ id: 'gw1', name: 'Gateway 1', url: 'http://test' }])
    const group = createGroup('Group with agents', undefined, [{ id: 'agent1', gatewayId: 'gw1' }])
    expect(group.agents).toHaveLength(1)
    expect(group.agents[0].id).toBe('agent1')
  })

  it('persists group to file', () => {
    createGroup('Persistent Group', undefined, [])
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('groups.json'),
      expect.any(String),
      expect.any(Object)
    )
  })

  it('initializes empty messages for the group', () => {
    createGroup('Group', undefined, [])
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('group-messages.json'),
      expect.any(String),
      expect.any(Object)
    )
  })

  it('sets createdAt timestamp', () => {
    const before = new Date().toISOString()
    const group = createGroup('Timed Group', undefined, [])
    const after = new Date().toISOString()
    expect(group.createdAt >= before).toBe(true)
    expect(group.createdAt <= after).toBe(true)
  })

  it('assigns james emoji to james agent', () => {
    mockGetGateways.mockReturnValue([{ id: 'gw1', name: 'James', url: 'http://test' }])
    const group = createGroup('G', undefined, [{ id: 'james', gatewayId: 'gw1' }])
    expect(group.agents[0].avatar).toBe('🤖')
  })

  it('assigns default emoji to unknown agents', () => {
    mockGetGateways.mockReturnValue([])
    const group = createGroup('G', undefined, [{ id: 'unknown-agent', gatewayId: 'gw1' }])
    expect(group.agents[0].avatar).toBe('💬')
  })
})

// ─── getGroup ─────────────────────────────────────────────────────────────────

describe('getGroup', () => {
  it('returns undefined for non-existent group', () => {
    const result = getGroup('nonexistent-id')
    expect(result).toBeUndefined()
  })

  it('returns group that was created', () => {
    const created = createGroup('Test Get', undefined, [])
    const found = getGroup(created.id)
    expect(found).toBeDefined()
    expect(found?.name).toBe('Test Get')
  })
})

// ─── listGroups ───────────────────────────────────────────────────────────────

describe('listGroups', () => {
  it('returns empty array when no groups exist', () => {
    mockExistsSync.mockReturnValue(false) // No file
    const result = listGroups()
    expect(result).toEqual([])
  })

  it('returns all groups sorted by creation time (newest first)', () => {
    // Create two groups with different timestamps
    const g1 = createGroup('Group 1', undefined, [])
    const g2 = createGroup('Group 2', undefined, [])

    const groups = listGroups()
    expect(groups).toHaveLength(2)
    // Both should be present
    const names = groups.map((g) => g.name)
    expect(names).toContain('Group 1')
    expect(names).toContain('Group 2')
  })
})

// ─── deleteGroup ──────────────────────────────────────────────────────────────

describe('deleteGroup', () => {
  it('returns false when group does not exist', () => {
    const result = deleteGroup('nonexistent')
    expect(result).toBe(false)
  })

  it('deletes existing group and returns true', () => {
    const group = createGroup('To Delete', undefined, [])
    const result = deleteGroup(group.id)
    expect(result).toBe(true)
    expect(getGroup(group.id)).toBeUndefined()
  })

  it('also deletes group messages', () => {
    const group = createGroup('Group With Messages', undefined, [])
    deleteGroup(group.id)
    // Messages store should no longer have this group's entry
    const messages = getGroupMessages(group.id)
    expect(messages).toEqual([])
  })
})

// ─── updateGroup ──────────────────────────────────────────────────────────────

describe('updateGroup', () => {
  it('returns null for non-existent group', () => {
    const result = updateGroup('nonexistent', { name: 'New Name' })
    expect(result).toBeNull()
  })

  it('updates group name', () => {
    const group = createGroup('Original Name', undefined, [])
    const updated = updateGroup(group.id, { name: 'Updated Name' })
    expect(updated?.name).toBe('Updated Name')
  })

  it('updates group description', () => {
    const group = createGroup('Group', 'Old desc', [])
    const updated = updateGroup(group.id, { description: 'New desc' })
    expect(updated?.description).toBe('New desc')
  })

  it('preserves existing fields when updating', () => {
    const group = createGroup('Group', 'Description', [])
    const updated = updateGroup(group.id, { name: 'New Name' })
    expect(updated?.description).toBe('Description') // preserved
    expect(updated?.id).toBe(group.id) // preserved
  })

  it('persists update to file', () => {
    const group = createGroup('Group', undefined, [])
    mockWriteFileSync.mockClear()
    updateGroup(group.id, { name: 'Updated' })
    expect(mockWriteFileSync).toHaveBeenCalled()
  })
})

// ─── getGroupMessages ─────────────────────────────────────────────────────────

describe('getGroupMessages', () => {
  it('returns empty array for non-existent group', () => {
    mockExistsSync.mockReturnValue(false)
    const result = getGroupMessages('nonexistent')
    expect(result).toEqual([])
  })

  it('returns last N messages by limit', () => {
    const group = createGroup('Group', undefined, [])
    // Directly populate messages store
    messagesStore[group.id] = Array.from({ length: 10 }, (_, i) => ({
      id: `msg-${i}`,
      groupId: group.id,
      content: `Message ${i}`,
      timestamp: new Date().toISOString(),
      responses: [],
    }))

    const result = getGroupMessages(group.id, 3)
    expect(result).toHaveLength(3)
  })

  it('uses default limit of 50', () => {
    const group = createGroup('Group', undefined, [])
    messagesStore[group.id] = Array.from({ length: 60 }, (_, i) => ({
      id: `msg-${i}`,
      groupId: group.id,
      content: `Message ${i}`,
      timestamp: new Date().toISOString(),
      responses: [],
    }))

    const result = getGroupMessages(group.id)
    expect(result).toHaveLength(50)
  })
})

// ─── Groups file corruption resilience ───────────────────────────────────────

describe('resilience', () => {
  it('handles corrupted groups file gracefully', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockImplementation((path: unknown) => {
      const p = String(path)
      if (p.endsWith('groups.json')) return '{ invalid json'
      return '{}'
    })

    const result = listGroups()
    expect(result).toEqual([])
  })

  it('handles corrupted messages file gracefully', () => {
    const group = createGroup('G', undefined, [])
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockImplementation((path: unknown) => {
      const p = String(path)
      if (p.endsWith('group-messages.json')) return '{ invalid'
      return JSON.stringify({ groups: groupStore, version: 1 })
    })

    const result = getGroupMessages(group.id)
    expect(result).toEqual([])
  })
})
