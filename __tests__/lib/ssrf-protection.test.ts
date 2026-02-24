// Tests for SSRF Protection

import { validateGatewayUrl, sanitizeUrlForLogging } from '@/lib/ssrf-protection'

describe('SSRF Protection', () => {
  describe('validateGatewayUrl', () => {
    describe('Blocked IPs', () => {
      const blockedUrls = [
        'http://127.0.0.1:8080',
        'http://localhost:3000',
        'http://10.0.0.1',
        'http://172.16.0.1',
        'http://192.168.1.1',
        'http://169.254.169.254/latest/meta-data/', // AWS metadata
        'http://169.254.1.1',
        'http://224.0.0.1', // Multicast
        'http://0.0.0.0',
        'http://[::1]', // IPv6 loopback
        'http://[fe80::1]', // IPv6 link-local
      ]

      blockedUrls.forEach((url) => {
        it(`should block ${url} in production`, () => {
          ;(process.env as { NODE_ENV: string }).NODE_ENV = 'production'
          const result = validateGatewayUrl(url)
          expect(result.allowed).toBe(false)
          expect(result.reason).toBeDefined()
        })
      })

      it('should allow localhost in development mode', () => {
        ;(process.env as { NODE_ENV: string }).NODE_ENV = 'development'
        const result = validateGatewayUrl('http://localhost:8080')
        expect(result.allowed).toBe(true)
      })
    })

    describe('Protocol Validation', () => {
      it('should allow HTTP', () => {
        const result = validateGatewayUrl('http://example.com')
        expect(result.allowed).toBe(true)
      })

      it('should allow HTTPS', () => {
        const result = validateGatewayUrl('https://example.com')
        expect(result.allowed).toBe(true)
      })

      const blockedProtocols = [
        'file:///etc/passwd',
        'ftp://example.com',
        'gopher://example.com',
        'dict://example.com:2628',
        'ldap://example.com',
      ]

      blockedProtocols.forEach((url) => {
        it(`should block ${url.split(':')[0]} protocol`, () => {
          const result = validateGatewayUrl(url)
          expect(result.allowed).toBe(false)
          expect(result.reason).toContain('HTTP/HTTPS')
        })
      })
    })

    describe('Domain Allowlist', () => {
      beforeEach(() => {
        process.env.ALLOWED_GATEWAY_DOMAINS = 'example.com,trusted.org'
      })

      afterEach(() => {
        delete process.env.ALLOWED_GATEWAY_DOMAINS
      })

      it('should allow exact domain match', () => {
        const result = validateGatewayUrl('https://example.com/api')
        expect(result.allowed).toBe(true)
      })

      it('should allow subdomain', () => {
        const result = validateGatewayUrl('https://api.example.com')
        expect(result.allowed).toBe(true)
      })

      it('should block non-allowlisted domain', () => {
        const result = validateGatewayUrl('https://evil.com')
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('not in allowlist')
      })
    })

    describe('Invalid URLs', () => {
      const invalidUrls = ['not-a-url', 'ht!tp://bad', '']

      invalidUrls.forEach((url) => {
        it(`should reject invalid URL: "${url}"`, () => {
          const result = validateGatewayUrl(url)
          expect(result.allowed).toBe(false)
          expect(result.reason).toContain('Invalid URL')
        })
      })
    })
  })

  describe('sanitizeUrlForLogging', () => {
    it('should remove credentials from URL', () => {
      const url = 'https://user:password@example.com/path'
      const sanitized = sanitizeUrlForLogging(url)
      expect(sanitized).not.toContain('user')
      expect(sanitized).not.toContain('password')
      expect(sanitized).toContain('example.com')
    })

    it('should handle invalid URLs gracefully', () => {
      const sanitized = sanitizeUrlForLogging('not-a-url')
      expect(sanitized).toBe('[invalid-url]')
    })
  })
})
