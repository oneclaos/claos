// Agent Groups - File-based persistent storage
// Production-ready implementation with audit logging

import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import writeFileAtomic from 'write-file-atomic'
import { generateId } from './utils'
import { auditLog } from './audit'
import type { AgentGroup, GroupMessage, Agent } from './types'
import { sendMessage, getGateways } from './gateway'
import { TIMEOUTS } from './constants'

// ============================================
// Configuration
// ============================================

const DATA_DIR = process.env.DATA_DIR || join(process.env.HOME || homedir(), '.claos')
const GROUPS_FILE = join(DATA_DIR, 'groups.json')
const MESSAGES_FILE = join(DATA_DIR, 'group-messages.json')

// ============================================
// Storage Layer
// ============================================

interface GroupsStore {
  groups: Record<string, AgentGroup>
  version: number
}

interface MessagesStore {
  messages: Record<string, GroupMessage[]>
  version: number
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  }
}

function loadGroups(): GroupsStore {
  ensureDataDir()
  if (!existsSync(GROUPS_FILE)) {
    return { groups: {}, version: 1 }
  }
  try {
    const data = readFileSync(GROUPS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch (err) {
    auditLog('group', 'load_error', { error: String(err) }, 'error')
    return { groups: {}, version: 1 }
  }
}

function saveGroups(store: GroupsStore): void {
  ensureDataDir()
  store.version++
  // Atomic write prevents race conditions and partial writes
  writeFileAtomic.sync(GROUPS_FILE, JSON.stringify(store, null, 2), { mode: 0o600 })
}

function loadMessages(): MessagesStore {
  ensureDataDir()
  if (!existsSync(MESSAGES_FILE)) {
    return { messages: {}, version: 1 }
  }
  try {
    const data = readFileSync(MESSAGES_FILE, 'utf-8')
    const store = JSON.parse(data)

    // Limit messages per group to prevent unbounded growth
    for (const groupId of Object.keys(store.messages)) {
      if (store.messages[groupId].length > 1000) {
        store.messages[groupId] = store.messages[groupId].slice(-1000)
      }
    }

    return store
  } catch (err) {
    auditLog('group', 'messages_load_error', { error: String(err) }, 'error')
    return { messages: {}, version: 1 }
  }
}

function saveMessages(store: MessagesStore): void {
  ensureDataDir()
  store.version++
  // Atomic write prevents race conditions and partial writes
  writeFileAtomic.sync(MESSAGES_FILE, JSON.stringify(store, null, 2), { mode: 0o600 })
}

// ============================================
// Group CRUD
// ============================================

export function createGroup(
  name: string,
  description: string | undefined,
  agentIds: Array<{ id: string; gatewayId: string }>
): AgentGroup {
  const gateways = getGateways()

  const agents: Agent[] = agentIds.map(({ id, gatewayId }) => {
    const gateway = gateways.find((g) => g.id === gatewayId)
    return {
      id,
      name: gateway?.name || id,
      gatewayId,
      description: `Agent ${gateway?.name || id}`,
      avatar: getAgentEmoji(id),
    }
  })

  const group: AgentGroup = {
    id: generateId(),
    name,
    description,
    agents,
    createdAt: new Date().toISOString(),
  }

  const store = loadGroups()
  store.groups[group.id] = group
  saveGroups(store)

  // Initialize empty messages for this group
  const messagesStore = loadMessages()
  messagesStore.messages[group.id] = []
  saveMessages(messagesStore)

  auditLog('group', 'created', { groupId: group.id, name, agentCount: agents.length })

  return group
}

export function getGroup(groupId: string): AgentGroup | undefined {
  const store = loadGroups()
  return store.groups[groupId]
}

export function listGroups(): AgentGroup[] {
  const store = loadGroups()
  return Object.values(store.groups).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

export function deleteGroup(groupId: string): boolean {
  const store = loadGroups()

  if (!store.groups[groupId]) {
    return false
  }

  delete store.groups[groupId]
  saveGroups(store)

  // Also delete messages
  const messagesStore = loadMessages()
  delete messagesStore.messages[groupId]
  saveMessages(messagesStore)

  auditLog('group', 'deleted', { groupId })

  return true
}

export function updateGroup(
  groupId: string,
  updates: { name?: string; description?: string; agents?: Agent[] }
): AgentGroup | null {
  const store = loadGroups()
  const group = store.groups[groupId]

  if (!group) return null

  const updated = {
    ...group,
    ...updates,
  }

  store.groups[groupId] = updated
  saveGroups(store)

  auditLog('group', 'updated', { groupId, updates: Object.keys(updates) })

  return updated
}

// ============================================
// Group Messaging
// ============================================

export interface AgentResponseEvent {
  agentId: string
  agentName: string
  content: string
  timestamp: string
  status: 'complete' | 'error'
  error?: string
}

type StreamCallback = (response: AgentResponseEvent) => void

export async function sendGroupMessageStream(
  groupId: string,
  content: string,
  onResponse: StreamCallback
): Promise<GroupMessage> {
  const store = loadGroups()
  const group = store.groups[groupId]

  if (!group) {
    throw new Error('Group not found')
  }

  const messageId = generateId()
  const timestamp = new Date().toISOString()

  // Create message with pending responses
  const message: GroupMessage = {
    id: messageId,
    groupId,
    content,
    timestamp,
    responses: group.agents.map((agent) => ({
      agentId: agent.id,
      agentName: agent.name,
      content: '',
      timestamp: '',
      status: 'pending' as const,
    })),
  }

  // Store initial message
  const messagesStore = loadMessages()
  if (!messagesStore.messages[groupId]) {
    messagesStore.messages[groupId] = []
  }
  messagesStore.messages[groupId].push(message)
  saveMessages(messagesStore)

  auditLog('group', 'message_sent', { groupId, messageId, agentCount: group.agents.length })

  // Send to all agents in parallel with timeout per agent
  const AGENT_TIMEOUT = TIMEOUTS.AGENT_TASK // 1 minute per agent

  const responsePromises = group.agents.map(async (agent, index) => {
    const startTime = Date.now()
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), AGENT_TIMEOUT)

      const result = await sendMessage(agent.gatewayId, content, [], `claos-group-${groupId}`)
      clearTimeout(timeoutId)

      const responseEvent: AgentResponseEvent = {
        agentId: agent.id,
        agentName: agent.name,
        content: result.reply,
        timestamp: new Date().toISOString(),
        status: 'complete',
      }

      message.responses[index] = responseEvent

      // Stream the response immediately
      onResponse(responseEvent)

      auditLog('group', 'agent_response', {
        groupId,
        messageId,
        agentId: agent.id,
        durationMs: Date.now() - startTime,
      })

      // Update message incrementally
      const updatedStore = loadMessages()
      const msgIndex = updatedStore.messages[groupId]?.findIndex((m) => m.id === messageId)
      if (msgIndex !== undefined && msgIndex >= 0) {
        updatedStore.messages[groupId][msgIndex] = message
        saveMessages(updatedStore)
      }
    } catch (error) {
      const responseEvent: AgentResponseEvent = {
        agentId: agent.id,
        agentName: agent.name,
        content: '',
        timestamp: new Date().toISOString(),
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }

      message.responses[index] = responseEvent

      // Stream the error immediately
      onResponse(responseEvent)

      auditLog(
        'group',
        'agent_error',
        {
          groupId,
          messageId,
          agentId: agent.id,
          error: error instanceof Error ? error.message : 'unknown',
        },
        'warn'
      )

      // Update message incrementally
      const updatedStore = loadMessages()
      const msgIndex = updatedStore.messages[groupId]?.findIndex((m) => m.id === messageId)
      if (msgIndex !== undefined && msgIndex >= 0) {
        updatedStore.messages[groupId][msgIndex] = message
        saveMessages(updatedStore)
      }
    }
  })

  // Wait for all responses with global timeout
  const GLOBAL_TIMEOUT = 120000 // 2 minutes total
  await Promise.race([
    Promise.all(responsePromises),
    new Promise((resolve) => setTimeout(resolve, GLOBAL_TIMEOUT)),
  ])

  // Final save
  const updatedStore = loadMessages()
  const msgIndex = updatedStore.messages[groupId]?.findIndex((m) => m.id === messageId)
  if (msgIndex !== undefined && msgIndex >= 0) {
    updatedStore.messages[groupId][msgIndex] = message
    saveMessages(updatedStore)
  }

  return message
}

export async function sendGroupMessage(groupId: string, content: string): Promise<GroupMessage> {
  // Non-streaming version for backward compatibility
  return sendGroupMessageStream(groupId, content, () => {
    // No-op callback
  })
}

export function getGroupMessages(groupId: string, limit: number = 50): GroupMessage[] {
  const store = loadMessages()
  const messages = store.messages[groupId] || []
  return messages.slice(-limit)
}

export function getGroupMessageStatus(
  groupId: string,
  messageId: string
): GroupMessage | undefined {
  const store = loadMessages()
  const messages = store.messages[groupId] || []
  return messages.find((m) => m.id === messageId)
}

// ============================================
// Helpers
// ============================================

function getAgentEmoji(agentId: string): string {
  const emojis: Record<string, string> = {
    james: '🤖',
    max: '🧠',
    clawdio: '⚡',
    default: '💬',
  }
  return emojis[agentId.toLowerCase()] || emojis.default
}

// Export types for API routes
export type { AgentGroup, GroupMessage }
