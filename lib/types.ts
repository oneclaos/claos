// Shared types for Claos Dashboard

// ============================================
// Gateway Types
// ============================================

export interface Gateway {
  id: string
  name: string
  url: string
  online: boolean
  port?: number
}

export interface GatewayConfig {
  id: string
  name: string
  url: string
  token?: string
}

// ============================================
// Message Types
// ============================================

export type MessageRole = 'user' | 'assistant' | 'system'

export interface MessageAttachment {
  type: 'image' | 'audio' | 'text'
  name: string
  preview?: string // data URL for images
  mimeType?: string
}

export interface Message {
  role: MessageRole
  content: string
  timestamp?: string
  attachments?: MessageAttachment[] // local display only, not persisted to server
  // Request tracking - prevents message mixing between sessions
  requestId?: string // Unique ID per request, used to filter responses
  // Structured error fields (set on error messages from gateway)
  error?: boolean
  errorCode?: string
  retryable?: boolean
}

export interface ChatMessage extends Message {
  id: string
  agentId?: string
  agentName?: string
}

// ============================================
// Session Types
// ============================================

export interface Session {
  sessionKey: string
  /** Full raw gateway key e.g. "agent:telegram:xxx" — used for proper gateway kill */
  rawKey?: string
  kind?: string
  channel?: string
  lastActive?: string
  messages?: Message[]
  gateway: string
  gatewayName: string
  gatewayIds?: string[] // For group sessions: all gateway IDs to broadcast to
  label?: string
  customName?: string | null
  agentName?: string
  messageCount?: number
  lastMessage?: string
}

export interface SessionListResponse {
  sessions: Session[]
  total: number
}

// ============================================
// File Manager Types
// ============================================

export type FileType = 'file' | 'directory' | 'symlink'

export interface FileEntry {
  name: string
  path: string
  type: FileType
  size: number
  modified: string
  permissions?: string
}

export interface DirectoryListing {
  path: string
  entries: FileEntry[]
  parent: string | null
}

export interface FileContent {
  path: string
  content: string
  size: number
  mimeType: string
  encoding: 'utf-8' | 'binary'
}

// ============================================
// Agent Group Types
// ============================================

export interface Agent {
  id: string
  name: string
  gatewayId: string
  description?: string
  avatar?: string
}

export interface AgentGroup {
  id: string
  name: string
  description?: string
  agents: Agent[]
  createdAt: string
}

export interface GroupMessage {
  id: string
  groupId: string
  content: string
  timestamp: string
  responses: AgentResponse[]
}

export interface AgentResponse {
  agentId: string
  agentName: string
  content: string
  timestamp: string
  status: 'pending' | 'complete' | 'error'
  error?: string
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

// ============================================
// Chat Attachment Types
// ============================================

export interface PendingAttachment {
  id: string
  file: File
  type: 'image' | 'audio' | 'text'
  preview?: string // data URL for image thumbnails
  content?: string // base64 data URL for images, raw text for text files
  mimeType: string
  name: string
  status: 'loading' | 'ready' | 'error'
}
