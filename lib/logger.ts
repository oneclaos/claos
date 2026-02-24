// Structured Logging with Correlation IDs and Secrets Redaction
// Senior-grade observability for production systems

import { randomBytes } from 'crypto'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

interface StructuredLog {
  timestamp: string
  level: LogLevel
  message: string
  correlationId?: string
  context?: LogContext
  error?: {
    name: string
    message: string
    stack?: string
  }
}

// Patterns for secret detection (case-insensitive)
const SECRET_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /access[_-]?key/i,
  /auth/i,
  /bearer/i,
  /credentials?/i,
  /private[_-]?key/i,
]

// PII patterns
const PII_PATTERNS = [/email/i, /ssn/i, /credit[_-]?card/i, /passport/i]

const REDACTED = '[REDACTED]'

/**
 * Redact sensitive data from logs
 */
function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') return redactStringValue(obj, false)
  if (typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveData)
  }

  const redacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    // Check if key matches secret patterns
    const isSensitiveKey = [...SECRET_PATTERNS, ...PII_PATTERNS].some((pattern) =>
      pattern.test(key)
    )

    if (isSensitiveKey && typeof value === 'string') {
      // For sensitive fields with string values, redact with pattern detection
      redacted[key] = redactStringValue(value, true)
    } else if (isSensitiveKey) {
      // For non-string sensitive fields, just redact completely
      redacted[key] = REDACTED
    } else {
      redacted[key] = redactSensitiveData(value)
    }
  }

  return redacted
}

/**
 * Redact sensitive patterns from string values
 * Returns pattern-specific redaction or full redaction
 * @param isSensitiveField - Whether this is being called for a known-sensitive field
 */
function redactStringValue(value: string, isSensitiveField = false): string {
  // Redact JWT tokens (starts with eyJ)
  if (value.startsWith('eyJ') && value.length > 50) {
    return `${value.substring(0, 10)}...[REDACTED_JWT]`
  }

  // Redact hex tokens (common for session tokens) - check before base64
  if (/^[a-f0-9]{32,}$/.test(value)) {
    return `${value.substring(0, 8)}...[REDACTED_HEX]`
  }

  // Redact long base64-looking strings
  if (/^[A-Za-z0-9+/=]{32,}$/.test(value)) {
    return `${value.substring(0, 8)}...[REDACTED_BASE64]`
  }

  // If this is a sensitive field and no pattern matched, redact completely
  if (isSensitiveField) {
    return REDACTED
  }

  // Otherwise return as-is
  return value
}

/**
 * Logger class with structured logging
 */
class Logger {
  private minLevel: LogLevel = 'info'
  private correlationId?: string

  constructor() {
    // Set log level from env
    const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel
    if (envLevel && ['debug', 'info', 'warn', 'error'].includes(envLevel)) {
      this.minLevel = envLevel
    }
  }

  /**
   * Set correlation ID for this logger instance
   */
  withCorrelationId(correlationId: string): Logger {
    const logger = new Logger()
    logger.correlationId = correlationId
    logger.minLevel = this.minLevel
    return logger
  }

  /**
   * Generate new correlation ID
   */
  static generateCorrelationId(): string {
    return randomBytes(16).toString('hex')
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    const currentLevelIndex = levels.indexOf(this.minLevel)
    const messageLevelIndex = levels.indexOf(level)
    return messageLevelIndex >= currentLevelIndex
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
    if (!this.shouldLog(level)) return

    const log: StructuredLog = {
      timestamp: new Date().toISOString(),
      level,
      message,
    }

    if (this.correlationId) {
      log.correlationId = this.correlationId
    }

    if (context) {
      log.context = redactSensitiveData(context) as LogContext
    }

    if (error) {
      log.error = {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
      }
    }

    // Output as JSON (parsable by log aggregators like Datadog, ELK)
    const output = JSON.stringify(log)

    switch (level) {
      case 'error':
        console.error(output)
        break
      case 'warn':
        console.warn(output)
        break
      default:
        console.log(output)
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context)
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context)
  }

  error(message: string, errorOrContext?: Error | LogContext, context?: LogContext): void {
    // Support both: error(msg, Error, ctx) and error(msg, ctx)
    if (errorOrContext instanceof Error) {
      this.log('error', message, context, errorOrContext)
    } else {
      this.log('error', message, errorOrContext)
    }
  }
}

// Export singleton instance
export const logger = new Logger()

// Alias for convenience (some code uses `log` instead of `logger`)
export const log = logger

// Export class for creating scoped loggers
export { Logger }
