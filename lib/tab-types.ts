// Tab types and Zod validation schema for Claos tab system

import { z } from 'zod'

// ============================================
// Core Types — v1 (legacy, backward compat)
// ============================================

export type TabView = 'empty' | 'chat' | 'terminal' | 'files' | 'status' | 'settings'

export interface Tab {
  id: string
  // v1 legacy field — kept for backward compat with existing components
  view: TabView
  // v3 field — section replaces view; null means "empty/new tab"
  section?: TabSection | null
  label: string
  sessionKey?: string
  gatewayId?: string
  isPinned: boolean
  isActive: boolean
  hasUnread: boolean
  unreadCount: number
  openedAt: number
}

// ============================================
// Core Types — v3
// ============================================

export type TabSection = 'chat' | 'terminal' | 'files' | 'status'

export interface NavigateChatConfig {
  sessionKey?: string
  gatewayId?: string
  label?: string
}

// ============================================
// Constants — v1 (legacy)
// ============================================

export const TAB_STORAGE_KEY = 'claos_tabs'
export const TAB_STORAGE_VERSION = 1

export const TAB_ICONS: Record<TabView, string> = {
  empty: '⊕',
  chat: '💬',
  terminal: '💻',
  files: '📁',
  status: '📊',
  settings: '⚙️',
}

export const TAB_DEFAULT_LABELS: Record<TabView, string> = {
  empty: 'New',
  chat: 'Chat',
  terminal: 'Terminal',
  files: 'Files',
  status: 'Status',
  settings: 'Settings',
}

// ============================================
// Constants — v3
// ============================================

export const LS_TABS_KEY = 'claos_tabs_v3'

export const SECTION_LABELS: Record<TabSection, string> = {
  chat: 'Chat',
  terminal: 'Terminal',
  files: 'Files',
  status: 'Status',
}

// ============================================
// Zod Schemas — v1 (legacy localStorage validation)
// ============================================

export const TabViewSchema = z.enum(['empty', 'chat', 'terminal', 'files', 'status', 'settings'])

export const TabSchema = z.object({
  id: z.string(),
  view: TabViewSchema,
  label: z.string(),
  sessionKey: z.string().optional(),
  gatewayId: z.string().optional(),
  isPinned: z.boolean(),
  isActive: z.boolean(),
  hasUnread: z.boolean(),
  unreadCount: z.number().int().min(0),
  openedAt: z.number(),
})

export const TabStorageSchema = z.object({
  version: z.literal(1),
  tabs: z.array(TabSchema),
  activeTabId: z.string().nullable(),
})

export type TabStorage = z.infer<typeof TabStorageSchema>

// ============================================
// Zod Schemas — v1 persisted state (migration source)
// Tab in v1 has sessionKey but no section/view field
// ============================================

export const PersistedTabV1Schema = z.object({
  id: z.string(),
  sessionKey: z.string().optional(),
  gatewayId: z.string().optional(),
  label: z.string(),
  isPinned: z.boolean(),
  isActive: z.boolean(),
  hasUnread: z.boolean(),
  unreadCount: z.number().int().min(0),
  openedAt: z.number(),
})

export const PersistedTabStateSchemaV1Zod = z.object({
  version: z.literal(1),
  tabs: z.array(PersistedTabV1Schema),
  activeTabId: z.string().nullable(),
})

// ============================================
// Zod Schemas — v2 persisted state (migration source)
// Tab in v2 uses `kind` field instead of `section`
// ============================================

export const TabKindSchema = z.enum(['chat', 'terminal', 'files', 'status'])

export const PersistedTabV2Schema = z.object({
  id: z.string(),
  kind: TabKindSchema,
  sessionKey: z.string().optional(),
  gatewayId: z.string().optional(),
  label: z.string(),
  isPinned: z.boolean(),
  isActive: z.boolean(),
  hasUnread: z.boolean(),
  unreadCount: z.number().int().min(0),
  openedAt: z.number(),
})

export const PersistedTabStateSchemaV2Zod = z.object({
  version: z.literal(2),
  tabs: z.array(PersistedTabV2Schema),
  activeTabId: z.string().nullable(),
})

// ============================================
// Zod Schemas — v3 persisted state (current)
// Tab uses `section: TabSection | null`
// ============================================

export const TabSectionSchema = z.enum(['chat', 'terminal', 'files', 'status'])

export const PersistedTabV3Schema = z.object({
  id: z.string(),
  section: TabSectionSchema.nullable(),
  sessionKey: z.string().optional(),
  gatewayId: z.string().optional(),
  label: z.string(),
  isPinned: z.boolean(),
  isActive: z.boolean(),
  hasUnread: z.boolean(),
  unreadCount: z.number().int().min(0),
  openedAt: z.number(),
})

export const PersistedTabStateSchemaZod = z.object({
  version: z.literal(3),
  tabs: z.array(PersistedTabV3Schema),
  activeTabId: z.string().nullable(),
})

export type PersistedTabState = z.infer<typeof PersistedTabStateSchemaZod>

// ============================================
// Default factory
// ============================================

export function createTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: crypto.randomUUID(),
    view: 'empty',
    label: 'New',
    isPinned: false,
    isActive: false,
    hasUnread: false,
    unreadCount: 0,
    openedAt: Date.now(),
    ...overrides,
  }
}
