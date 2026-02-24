import { z } from 'zod'
import { normalize, resolve } from 'path'

// ============================================
// Security Constants
// ============================================

// Max sizes
export const MAX_MESSAGE_LENGTH = 100_000 // 100KB
export const MAX_PATH_LENGTH = 500
export const MAX_FILE_PREVIEW_SIZE = 1_000_000 // 1MB
export const MAX_GROUP_NAME_LENGTH = 100
export const MAX_AGENTS_PER_GROUP = 10

// Allowed file extensions for preview
export const ALLOWED_PREVIEW_EXTENSIONS = [
  '.txt',
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.css',
  '.html',
  '.py',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.env',
  '.gitignore',
  '.dockerignore',
  '.conf',
  '.cfg',
  '.ini',
  '.log',
  '.xml',
  '.svg',
  '.csv',
] as const

// System users whose home dirs should be excluded by default for security
const EXCLUDED_HOME_USERS = [
  'root',
  'ubuntu',
  'admin',
  'administrator',
  'daemon',
  'bin',
  'sys',
  'sync',
  'games',
  'man',
  'lp',
  'mail',
  'news',
  'uucp',
  'proxy',
  'www-data',
  'backup',
  'list',
  'irc',
  'gnats',
  'nobody',
  'systemd-network',
  'systemd-resolve',
  'messagebus',
  'syslog',
  '_apt',
  'tss',
  'uuidd',
  'tcpdump',
  'sshd',
  'pollinate',
  'landscape',
]

/**
 * Get allowed base paths from environment or use smart defaults.
 *
 * Environment variable: ALLOWED_BASE_PATHS (comma-separated)
 * Example: ALLOWED_BASE_PATHS=/home/myuser,/srv/projects,/var/www
 *
 * Default behavior:
 * - Includes /home (but individual user dirs under /home are filtered)
 * - Includes /srv, /var/www, /tmp/claos-data
 * - Excludes system/admin user home directories via EXCLUDED_HOME_USERS
 */
function getAllowedBasePaths(): string[] {
  const paths = process.env.ALLOWED_BASE_PATHS
    ? process.env.ALLOWED_BASE_PATHS.split(',')
        .map((p) => p.trim())
        .filter(Boolean)
    : ['/home', '/srv', '/var/www', '/tmp/claos-data']

  // Normalize: remove trailing slashes (except for root '/')
  return paths.map((p) => (p === '/' ? p : p.replace(/\/+$/, '')))
}

/**
 * Check if a path is within an excluded system user's home directory.
 * This provides defense-in-depth even when /home is allowed.
 */
function isExcludedUserHome(normalizedPath: string): boolean {
  for (const user of EXCLUDED_HOME_USERS) {
    const userHome = `/home/${user}`
    if (normalizedPath === userHome || normalizedPath.startsWith(userHome + '/')) {
      return true
    }
  }
  // Also block /root explicitly
  if (normalizedPath === '/root' || normalizedPath.startsWith('/root/')) {
    return true
  }
  return false
}

/**
 * Get the default home path for file browsing.
 * Priority: ALLOWED_BASE_PATHS first entry → $HOME → /home
 */
export function getDefaultHomePath(): string {
  const allowedPaths = getAllowedBasePaths()

  // If ALLOWED_BASE_PATHS is explicitly set, use the first one
  if (process.env.ALLOWED_BASE_PATHS && allowedPaths.length > 0) {
    return allowedPaths[0]
  }

  // Otherwise use $HOME if it's within allowed paths
  const homeDir = process.env.HOME
  if (homeDir) {
    const isHomeAllowed = allowedPaths.some((base) => homeDir.startsWith(base) || homeDir === base)
    if (isHomeAllowed) {
      return homeDir
    }
  }

  // Fallback to first allowed path or /home
  return allowedPaths[0] || '/home'
}

// Export for documentation/reference (not used in validation logic)
export const DEFAULT_ALLOWED_PATHS = ['/home', '/srv', '/var/www', '/tmp/claos-data']

// Legacy alias for backward compatibility
export const ALLOWED_BASE_PATHS = DEFAULT_ALLOWED_PATHS

// Export excluded users for documentation
export const DEFAULT_EXCLUDED_USERS = EXCLUDED_HOME_USERS

// Blocked paths — sensitive system dirs always denied regardless of ALLOWED_BASE_PATHS
export const BLOCKED_PATHS = [
  // Kernel / hardware virtual filesystems
  '/proc',
  '/sys',
  '/dev',
  '/run',
  '/boot',
  // Root-only dirs
  '/root',
  '/lost+found',
  // Sensitive system config
  '/etc',
  // Secrets and auth material
  '/var/lib/private',
  '/var/lib/systemd/credential',
  // Package manager internals
  '/var/lib/apt',
  '/var/lib/dpkg',
  '/var/lib/snap',
  '/var/lib/flatpak',
  // System binaries (read risk low but write risk high)
  '/usr/bin',
  '/usr/sbin',
  '/usr/lib',
  '/usr/lib64',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
]

// Helper — checks if a resolved (real) path is within allowed paths and not blocked
// Use this after fs.realpath() to prevent symlink traversal
export function isPathAllowed(realPath: string): boolean {
  // Normalize and resolve the path to handle .. and . traversal
  const normalizedPath = resolve(normalize(realPath))

  // Block sensitive system paths first
  const isBlocked = BLOCKED_PATHS.some(
    (blocked) => normalizedPath === blocked || normalizedPath.startsWith(blocked + '/')
  )
  if (isBlocked) return false

  // Block excluded system user home directories
  if (isExcludedUserHome(normalizedPath)) return false

  const allowedPaths = getAllowedBasePaths()
  return allowedPaths.some(
    (base) => base === '/' || normalizedPath.startsWith(base + '/') || normalizedPath === base
  )
}

// ============================================
// Validation Schemas
// ============================================

// Safe path - no traversal, within allowed paths
export const safePathSchema = z
  .string()
  .max(MAX_PATH_LENGTH, 'Path too long')
  .refine((path) => !path.includes('..'), 'Path traversal not allowed')
  .refine((path) => !path.includes('\0'), 'Null bytes not allowed')
  .refine((path) => {
    const normalized = path.startsWith('/') ? path : `/${path}`
    // Check blocked paths first
    const isBlocked = BLOCKED_PATHS.some(
      (blocked) => normalized === blocked || normalized.startsWith(blocked + '/')
    )
    if (isBlocked) return false
    // Check excluded user home directories
    if (isExcludedUserHome(normalized)) return false
    const allowedPaths = getAllowedBasePaths()
    return allowedPaths.some((base) => normalized.startsWith(base))
  }, 'Path outside allowed directories')

// Gateway ID - alphanumeric with dashes
export const gatewayIdSchema = z
  .string()
  .min(1, 'Gateway ID required')
  .max(50, 'Gateway ID too long')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid gateway ID format')

// Session key
export const sessionKeySchema = z
  .string()
  .min(1, 'Session key required')
  .max(200, 'Session key too long')

// Message content
export const messageContentSchema = z
  .string()
  .min(1, 'Message cannot be empty')
  .max(MAX_MESSAGE_LENGTH, 'Message too long')

// Message role
export const messageRoleSchema = z.enum(['user', 'assistant', 'system'])

// Single message
export const messageSchema = z.object({
  role: messageRoleSchema,
  content: messageContentSchema,
  timestamp: z.string().optional(),
})

// Message history array
export const messageHistorySchema = z.array(messageSchema).max(100, 'History too long')

// ============================================
// API Request Schemas
// ============================================

// Send message request
export const sendMessageRequestSchema = z.object({
  gatewayId: gatewayIdSchema,
  message: messageContentSchema,
  history: messageHistorySchema.optional().default([]),
})

// Session list request
export const sessionListRequestSchema = z.object({
  gatewayId: gatewayIdSchema.optional(),
  channel: z.string().max(50).optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
})

// Session history request
export const sessionHistoryRequestSchema = z.object({
  gatewayId: gatewayIdSchema,
  sessionKey: sessionKeySchema,
  limit: z.number().int().min(1).max(500).optional().default(100),
})

// File browse request
export const fileBrowseRequestSchema = z.object({
  path: safePathSchema,
})

// File read request
export const fileReadRequestSchema = z.object({
  path: safePathSchema,
  maxSize: z
    .number()
    .int()
    .min(1)
    .max(MAX_FILE_PREVIEW_SIZE)
    .optional()
    .default(MAX_FILE_PREVIEW_SIZE),
})

// Group name
export const groupNameSchema = z
  .string()
  .min(1, 'Group name required')
  .max(MAX_GROUP_NAME_LENGTH, 'Group name too long')
  .regex(/^[\w\s-]+$/, 'Invalid group name characters')

// Agent selection
export const agentSelectionSchema = z.object({
  id: z.string().min(1).max(50),
  gatewayId: gatewayIdSchema,
})

// Create group request
export const createGroupRequestSchema = z.object({
  name: groupNameSchema,
  description: z.string().max(500).optional(),
  agents: z.array(agentSelectionSchema).min(1).max(MAX_AGENTS_PER_GROUP),
})

// Group message request
export const groupMessageRequestSchema = z.object({
  groupId: z.string().min(1).max(50),
  message: messageContentSchema,
})

// Chat send request (non-streaming)
export const chatSendRequestSchema = z.object({
  gatewayId: gatewayIdSchema,
  sessionKey: sessionKeySchema.optional(),
  message: messageContentSchema,
})

// Attachment schema for chat
export const attachmentSchema = z.object({
  content: z.string().max(10_000_000, 'Attachment too large (max 10MB)'),
  mimeType: z.string().max(100).optional(),
  fileName: z.string().max(255).optional(),
})

// Chat stream request
export const chatStreamRequestSchema = z.object({
  gatewayId: gatewayIdSchema,
  sessionKey: sessionKeySchema.optional().default('claos-web'),
  message: messageContentSchema,
  attachments: z.array(attachmentSchema).max(10).optional(),
  idempotencyKey: z.string().max(100).optional(),
})

// First-run password setup request
export const firstRunRequestSchema = z.object({
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(128, 'Password too long'),
})

// ============================================
// Auth Schemas
// ============================================

// Auth action enum
export const authActionSchema = z.enum(['login', 'verify-totp', 'logout', 'rotate', 'csrf'])

// Login request
export const loginRequestSchema = z.object({
  action: z.literal('login'),
  password: z.string().min(1, 'Password required').max(128, 'Password too long'),
})

// Verify TOTP request
export const verifyTotpRequestSchema = z.object({
  action: z.literal('verify-totp'),
  code: z.string().min(6, 'Code required').max(32, 'Code too long'),
  tempToken: z.string().min(1).max(128),
})

// Simple action requests (logout, rotate, csrf)
export const simpleAuthActionSchema = z.object({
  action: z.enum(['logout', 'rotate', 'csrf']),
})

// Combined auth request (discriminated union)
export const authRequestSchema = z.discriminatedUnion('action', [
  loginRequestSchema,
  verifyTotpRequestSchema,
  simpleAuthActionSchema,
])

// ============================================
// TOTP Schemas
// ============================================

export const totpActionSchema = z.enum([
  'setup',
  'verify-setup',
  'verify',
  'disable',
  'regenerate-recovery',
])

export const totpRequestSchema = z
  .object({
    action: totpActionSchema,
    code: z.string().min(6).max(32).optional(),
  })
  .refine(
    (data) => {
      // Code is required for all actions except 'setup'
      if (data.action !== 'setup' && !data.code) {
        return false
      }
      return true
    },
    { message: 'Code is required for this action', path: ['code'] }
  )

// ============================================
// Password Change Schema
// ============================================

export const passwordChangeRequestSchema = z.object({
  currentPassword: z.string().min(1, 'Current password required').max(128),
  newPassword: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(128, 'Password too long'),
})

// ============================================
// Gateway Schemas
// ============================================

export const addGatewayRequestSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name too long')
    .transform((s) => s.trim()),
  url: z
    .string()
    .min(1, 'URL is required')
    .max(500, 'URL too long')
    .regex(/^(ws|wss|http|https):\/\/.+/, 'URL must start with ws://, wss://, http://, or https://')
    .transform((s) => s.trim()),
  gatewayToken: z
    .string()
    .max(500)
    .optional()
    .transform((s) => s?.trim() || undefined),
})

// ============================================
// Setup/Pair Schema
// ============================================

export const pairAgentRequestSchema = z.object({
  agentId: z
    .string()
    .min(1, 'agentId is required')
    .max(50)
    .regex(/^agent-\d+$/, 'Invalid agentId format (expected "agent-{port}")'),
  token: z.string().min(1, 'token is required').max(500, 'Token too long'),
})

// ============================================
// Session Send Schema (alias to chatSendRequestSchema for clarity)
// ============================================

export const sessionSendRequestSchema = sendMessageRequestSchema

// ============================================
// Type exports from schemas
// ============================================

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>
export type SessionListRequest = z.infer<typeof sessionListRequestSchema>
export type SessionHistoryRequest = z.infer<typeof sessionHistoryRequestSchema>
export type FileBrowseRequest = z.infer<typeof fileBrowseRequestSchema>
export type FileReadRequest = z.infer<typeof fileReadRequestSchema>
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>
export type GroupMessageRequest = z.infer<typeof groupMessageRequestSchema>
export type ChatSendRequest = z.infer<typeof chatSendRequestSchema>
export type ChatStreamRequest = z.infer<typeof chatStreamRequestSchema>
export type FirstRunRequest = z.infer<typeof firstRunRequestSchema>
export type AuthRequest = z.infer<typeof authRequestSchema>
export type TotpRequest = z.infer<typeof totpRequestSchema>
export type PasswordChangeRequest = z.infer<typeof passwordChangeRequestSchema>
export type AddGatewayRequest = z.infer<typeof addGatewayRequestSchema>
export type PairAgentRequest = z.infer<typeof pairAgentRequestSchema>
export type SessionSendRequest = z.infer<typeof sessionSendRequestSchema>

// ============================================
// Validation helper
// ============================================

export function validateRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  // Return first error message only (no stack traces)
  const firstError = result.error.issues[0]
  return {
    success: false,
    error: firstError ? `${firstError.path.join('.')}: ${firstError.message}` : 'Validation failed',
  }
}
