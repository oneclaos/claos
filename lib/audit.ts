import { appendFileSync, existsSync, mkdirSync, statSync, renameSync, unlinkSync } from 'fs'
import { join } from 'path'
import { log } from './logger'

// ============================================
// Audit Logging System
// ============================================

const DATA_DIR = process.env.DATA_DIR || '/tmp/claos-data'
const AUDIT_DIR = join(DATA_DIR, 'audit')
const MAX_LOG_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_LOG_FILES = 5

type AuditCategory = 'auth' | 'file' | 'gateway' | 'group' | 'system' | 'security' | 'terminal'

interface AuditEntry {
  timestamp: string
  category: AuditCategory
  action: string
  details: Record<string, unknown>
  level: 'info' | 'warn' | 'error'
}

function ensureAuditDir(): void {
  if (!existsSync(AUDIT_DIR)) {
    mkdirSync(AUDIT_DIR, { recursive: true, mode: 0o700 })
  }
}

function getLogPath(): string {
  return join(AUDIT_DIR, 'audit.log')
}

function rotateLogsIfNeeded(): void {
  const logPath = getLogPath()
  if (!existsSync(logPath)) return

  try {
    const stats = statSync(logPath)
    if (stats.size < MAX_LOG_SIZE) return

    // Rotate logs
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const oldPath = `${logPath}.${i}`
      const newPath = `${logPath}.${i + 1}`
      if (existsSync(oldPath)) {
        if (i === MAX_LOG_FILES - 1) {
          // Delete oldest
          unlinkSync(oldPath)
        } else {
          renameSync(oldPath, newPath)
        }
      }
    }
    renameSync(logPath, `${logPath}.1`)
  } catch {
    // Ignore rotation errors
  }
}

function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'authorization', 'cookie']

  for (const [key, value] of Object.entries(details)) {
    const lowerKey = key.toLowerCase()
    if (sensitiveKeys.some((s) => lowerKey.includes(s))) {
      sanitized[key] = '[REDACTED]'
    } else if (typeof value === 'string' && value.length > 500) {
      sanitized[key] = value.slice(0, 500) + '...[truncated]'
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

export function auditLog(
  category: AuditCategory,
  action: string,
  details: Record<string, unknown> = {},
  level: 'info' | 'warn' | 'error' = 'info'
): void {
  try {
    ensureAuditDir()
    rotateLogsIfNeeded()

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      category,
      action,
      details: sanitizeDetails(details),
      level,
    }

    const logLine = JSON.stringify(entry) + '\n'
    appendFileSync(getLogPath(), logLine, { encoding: 'utf-8', mode: 0o600 })

    // Also log to console in development
    if (process.env.NODE_ENV !== 'production') {
      const icon = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '📝'
      console.log(`${icon} [AUDIT] ${category}:${action}`, entry.details)
    }
  } catch (err) {
    // Fail silently but log error
    log.error('Failed to write audit log', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Convenience functions
export const audit = {
  auth: (action: string, details?: Record<string, unknown>) => auditLog('auth', action, details),

  file: (action: string, details?: Record<string, unknown>) => auditLog('file', action, details),

  gateway: (action: string, details?: Record<string, unknown>) =>
    auditLog('gateway', action, details),

  group: (action: string, details?: Record<string, unknown>) => auditLog('group', action, details),

  system: (action: string, details?: Record<string, unknown>) =>
    auditLog('system', action, details),

  security: (action: string, details?: Record<string, unknown>, level: 'warn' | 'error' = 'warn') =>
    auditLog('security', action, details, level),
}
