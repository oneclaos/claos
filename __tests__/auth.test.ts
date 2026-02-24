// Tests for authentication module

import {
  hashPassword,
  verifyPassword,
  createSession,
  validateSession,
  deleteSession,
  generateCsrfToken,
  validateCsrfToken,
  checkRateLimit,
  recordLoginAttempt
} from '@/lib/auth'

describe('Authentication', () => {
  
  describe('Password Hashing', () => {
    it('should hash password with bcrypt', async () => {
      const password = 'test-password-123'
      const hash = await hashPassword(password)
      
      expect(hash).toBeDefined()
      expect(hash).not.toBe(password)
      expect(hash.startsWith('$2b$')).toBe(true)
    })

    it('should verify correct password', async () => {
      const password = 'test-password-123'
      const hash = await hashPassword(password)
      
      const isValid = await verifyPassword(password, hash)
      expect(isValid).toBe(true)
    })

    it('should reject incorrect password', async () => {
      const password = 'test-password-123'
      const hash = await hashPassword(password)
      
      const isValid = await verifyPassword('wrong-password', hash)
      expect(isValid).toBe(false)
    })

    it('should handle invalid hash gracefully', async () => {
      const isValid = await verifyPassword('password', 'invalid-hash')
      expect(isValid).toBe(false)
    })
  })

  describe('Session Management', () => {
    it('should create a session token', () => {
      const ip = '192.168.1.1'
      const userAgent = 'Mozilla/5.0'
      
      const token = createSession(ip, userAgent)
      
      expect(token).toBeDefined()
      expect(token.length).toBe(64)
      expect(/^[a-f0-9]+$/.test(token)).toBe(true)
    })

    it('should validate a valid session', () => {
      const ip = '192.168.1.1'
      const userAgent = 'Mozilla/5.0'
      
      const token = createSession(ip, userAgent)
      const isValid = validateSession(token)
      
      expect(isValid).toBe(true)
    })

    it('should reject invalid session token', () => {
      expect(validateSession('invalid-token')).toBe(false)
      expect(validateSession('')).toBe(false)
      expect(validateSession('a'.repeat(64))).toBe(false) // Valid format but doesn't exist
    })

    it('should delete session', () => {
      const token = createSession('192.168.1.1', 'Mozilla')
      
      expect(validateSession(token)).toBe(true)
      
      deleteSession(token)
      
      expect(validateSession(token)).toBe(false)
    })
  })

  describe('CSRF Protection', () => {
    it('should generate CSRF token', () => {
      const sessionToken = createSession('192.168.1.1', 'Mozilla')
      const csrfToken = generateCsrfToken(sessionToken)
      
      expect(csrfToken).toBeDefined()
      expect(csrfToken.includes('.')).toBe(true)
    })

    it('should validate correct CSRF token', () => {
      const sessionToken = createSession('192.168.1.1', 'Mozilla')
      const csrfToken = generateCsrfToken(sessionToken)
      
      const isValid = validateCsrfToken(csrfToken, sessionToken)
      expect(isValid).toBe(true)
    })

    it('should reject invalid CSRF token', () => {
      const sessionToken = createSession('192.168.1.1', 'Mozilla')
      
      expect(validateCsrfToken('invalid.token', sessionToken)).toBe(false)
      expect(validateCsrfToken('', sessionToken)).toBe(false)
    })

    it('should reject CSRF token for different session', () => {
      const session1 = createSession('192.168.1.1', 'Mozilla')
      const session2 = createSession('192.168.1.2', 'Chrome')
      
      const csrfToken = generateCsrfToken(session1)
      
      // Token from session1 should not work with session2
      const isValid = validateCsrfToken(csrfToken, session2)
      expect(isValid).toBe(false)
    })
  })

  describe('Rate Limiting', () => {
    it('should allow first attempt', () => {
      const result = checkRateLimit('10.0.0.1')
      expect(result.allowed).toBe(true)
    })

    it('should track failed attempts', () => {
      const ip = '10.0.0.2'
      
      // Record 4 failed attempts
      for (let i = 0; i < 4; i++) {
        recordLoginAttempt(ip, false)
      }
      
      // Should still be allowed
      let result = checkRateLimit(ip)
      expect(result.allowed).toBe(true)
      
      // 5th failure
      recordLoginAttempt(ip, false)
      
      // Now should be locked
      result = checkRateLimit(ip)
      expect(result.allowed).toBe(false)
      expect(result.retryAfter).toBeGreaterThan(0)
    })

    it('should reset on successful login', () => {
      const ip = '10.0.0.3'
      
      // Record some failures
      recordLoginAttempt(ip, false)
      recordLoginAttempt(ip, false)
      
      // Successful login should reset
      recordLoginAttempt(ip, true)
      
      // Should be allowed
      const result = checkRateLimit(ip)
      expect(result.allowed).toBe(true)
    })
  })
})
