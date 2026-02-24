// Tests for structured logger

import { Logger, logger } from '@/lib/logger'

describe('Structured Logger', () => {
  let consoleLogSpy: jest.SpyInstance
  let consoleWarnSpy: jest.SpyInstance
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  describe('Basic Logging', () => {
    it('should log info messages as JSON', () => {
      logger.info('Test message')

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"level":"info"'))
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"message":"Test message"')
      )
    })

    it('should include timestamp in ISO format', () => {
      logger.info('Test')

      const logOutput = consoleLogSpy.mock.calls[0][0]
      const parsed = JSON.parse(logOutput)

      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })

    it('should log different levels correctly', () => {
      logger.debug('Debug message')
      logger.info('Info message')
      logger.warn('Warn message')
      logger.error('Error message')

      // Default log level is 'info', so debug is not logged
      expect(consoleLogSpy).toHaveBeenCalledTimes(1) // Only info
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1)
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('Context Logging', () => {
    it('should include context object', () => {
      logger.info('User action', { userId: '123', action: 'login' })

      const logOutput = consoleLogSpy.mock.calls[0][0]
      const parsed = JSON.parse(logOutput)

      expect(parsed.context).toEqual({
        userId: '123',
        action: 'login',
      })
    })

    it('should handle nested context', () => {
      logger.info('Complex data', {
        user: { id: '123', name: 'Alice' },
        meta: { timestamp: Date.now() },
      })

      const logOutput = consoleLogSpy.mock.calls[0][0]
      const parsed = JSON.parse(logOutput)

      expect(parsed.context.user).toEqual({ id: '123', name: 'Alice' })
      expect(parsed.context.meta.timestamp).toBeDefined()
    })
  })

  describe('Secrets Redaction', () => {
    it('should redact password fields', () => {
      logger.info('User created', {
        username: 'alice',
        password: 'secret123',
        email: 'alice@example.com',
      })

      const logOutput = consoleLogSpy.mock.calls[0][0]
      const parsed = JSON.parse(logOutput)

      expect(parsed.context.password).toBe('[REDACTED]')
      expect(parsed.context.username).toBe('alice')
      expect(parsed.context.email).toBe('[REDACTED]') // PII redacted
    })

    it('should redact API tokens', () => {
      logger.info('API call', {
        url: '/api/users',
        apiKey: 'sk_live_abc123xyz789',
        bearerToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      })

      const logOutput = consoleLogSpy.mock.calls[0][0]
      const parsed = JSON.parse(logOutput)

      expect(parsed.context.apiKey).toBe('[REDACTED]')
      expect(parsed.context.bearerToken).toBe('[REDACTED]')
      expect(parsed.context.url).toBe('/api/users')
    })

    it('should redact JWT tokens in string values', () => {
      logger.info('Auth token received', {
        token:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      })

      const logOutput = consoleLogSpy.mock.calls[0][0]
      const parsed = JSON.parse(logOutput)

      expect(parsed.context.token).toContain('[REDACTED_JWT]')
      expect(parsed.context.token).not.toContain('eyJzdWIi')
    })

    it('should redact long hex strings (session tokens)', () => {
      logger.info('Session created', {
        sessionId: 'a'.repeat(64),
      })

      const logOutput = consoleLogSpy.mock.calls[0][0]
      const parsed = JSON.parse(logOutput)

      expect(parsed.context.sessionId).toContain('[REDACTED_HEX]')
    })

    it('should redact nested secrets', () => {
      logger.info('Config loaded', {
        database: {
          host: 'localhost',
          password: 'db_secret_123',
        },
        api: {
          token: 'api_token_xyz',
        },
      })

      const logOutput = consoleLogSpy.mock.calls[0][0]
      const parsed = JSON.parse(logOutput)

      expect(parsed.context.database.password).toBe('[REDACTED]')
      expect(parsed.context.api.token).toBe('[REDACTED]')
      expect(parsed.context.database.host).toBe('localhost')
    })
  })

  describe('Error Logging', () => {
    it('should log error with stack trace in dev', () => {
      const originalEnv = process.env.NODE_ENV
      ;(process.env as { NODE_ENV: string }).NODE_ENV = 'development'

      const error = new Error('Something failed')
      logger.error('Operation failed', error)

      const logOutput = consoleErrorSpy.mock.calls[0][0]
      const parsed = JSON.parse(logOutput)

      expect(parsed.error.name).toBe('Error')
      expect(parsed.error.message).toBe('Something failed')
      expect(parsed.error.stack).toBeDefined()
      ;(process.env as { NODE_ENV: string }).NODE_ENV = originalEnv!
    })

    it('should omit stack trace in production', () => {
      const originalEnv = process.env.NODE_ENV
      ;(process.env as { NODE_ENV: string }).NODE_ENV = 'production'

      const error = new Error('Something failed')
      logger.error('Operation failed', error)

      const logOutput = consoleErrorSpy.mock.calls[0][0]
      const parsed = JSON.parse(logOutput)

      expect(parsed.error.stack).toBeUndefined()
      ;(process.env as { NODE_ENV: string }).NODE_ENV = originalEnv!
    })
  })

  describe('Correlation ID', () => {
    it('should generate valid correlation IDs', () => {
      const id = Logger.generateCorrelationId()
      expect(id).toMatch(/^[a-f0-9]{32}$/)
    })

    it('should include correlation ID in logs', () => {
      const scopedLogger = logger.withCorrelationId('abc123')
      scopedLogger.info('Request received')

      const logOutput = consoleLogSpy.mock.calls[0][0]
      const parsed = JSON.parse(logOutput)

      expect(parsed.correlationId).toBe('abc123')
    })

    it('should not include correlation ID when not set', () => {
      logger.info('Standalone log')

      const logOutput = consoleLogSpy.mock.calls[0][0]
      const parsed = JSON.parse(logOutput)

      expect(parsed.correlationId).toBeUndefined()
    })
  })

  describe('Log Levels', () => {
    it('should respect LOG_LEVEL env var', () => {
      const originalLevel = process.env.LOG_LEVEL
      process.env.LOG_LEVEL = 'warn'

      const testLogger = new Logger()
      testLogger.debug('Debug')
      testLogger.info('Info')
      testLogger.warn('Warn')

      expect(consoleLogSpy).not.toHaveBeenCalled()
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1)

      process.env.LOG_LEVEL = originalLevel
    })
  })
})
