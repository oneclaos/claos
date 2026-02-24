/**
 * Security Tests: SSRF (Server-Side Request Forgery) Protection
 *
 * AUDIT REQUIREMENT: Test that internal/private IPs are blocked
 */

import { validateGatewayUrl } from '@/lib/ssrf-protection'

describe('SSRF Protection - validateGatewayUrl', () => {
  describe('Blocked IP Ranges', () => {
    it('blocks localhost (127.0.0.1)', () => {
      const result = validateGatewayUrl('http://127.0.0.1:8080/api')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Blocked IP range')
    })

    it('blocks localhost (127.x.x.x range)', () => {
      expect(validateGatewayUrl('http://127.0.0.2:8080/api').allowed).toBe(false)
      expect(validateGatewayUrl('http://127.255.255.255:8080/api').allowed).toBe(false)
    })

    it('blocks localhost hostname', () => {
      const result = validateGatewayUrl('http://localhost:8080/api')
      expect(result.allowed).toBe(false)
    })

    it('blocks IPv6 loopback (::1)', () => {
      const result = validateGatewayUrl('http://[::1]:8080/api')
      expect(result.allowed).toBe(false)
    })

    it('blocks 10.x.x.x (RFC1918 Class A)', () => {
      expect(validateGatewayUrl('http://10.0.0.1:8080').allowed).toBe(false)
      expect(validateGatewayUrl('http://10.255.255.255:8080').allowed).toBe(false)
    })

    it('blocks 172.16-31.x.x (RFC1918 Class B)', () => {
      expect(validateGatewayUrl('http://172.16.0.1:8080').allowed).toBe(false)
      expect(validateGatewayUrl('http://172.31.255.255:8080').allowed).toBe(false)
      // 172.15.x.x and 172.32.x.x should not match this pattern
    })

    it('blocks 192.168.x.x (RFC1918 Class C)', () => {
      expect(validateGatewayUrl('http://192.168.0.1:8080').allowed).toBe(false)
      expect(validateGatewayUrl('http://192.168.255.255:8080').allowed).toBe(false)
    })

    it('blocks link-local (169.254.x.x)', () => {
      expect(validateGatewayUrl('http://169.254.1.1:8080').allowed).toBe(false)
    })

    it('blocks AWS/Cloud metadata endpoint (169.254.169.254)', () => {
      // CRITICAL: This is the AWS metadata service
      const result = validateGatewayUrl('http://169.254.169.254/latest/meta-data/')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('metadata')
    })

    it('blocks multicast (224.x.x.x)', () => {
      expect(validateGatewayUrl('http://224.0.0.1:8080').allowed).toBe(false)
    })

    it('blocks reserved (0.x.x.x)', () => {
      expect(validateGatewayUrl('http://0.0.0.1:8080').allowed).toBe(false)
    })

    it('blocks broadcast (255.255.255.255)', () => {
      expect(validateGatewayUrl('http://255.255.255.255:8080').allowed).toBe(false)
    })
  })

  describe('Allowed URLs', () => {
    it('allows public IP addresses', () => {
      expect(validateGatewayUrl('http://8.8.8.8:8080/api').allowed).toBe(true)
      expect(validateGatewayUrl('https://1.1.1.1:443/api').allowed).toBe(true)
    })

    it('allows public domains', () => {
      expect(validateGatewayUrl('https://api.example.com/v1').allowed).toBe(true)
      expect(validateGatewayUrl('http://gateway.clawdbot.com:18750').allowed).toBe(true)
    })
  })

  describe('Protocol Validation', () => {
    it('only allows HTTP and HTTPS', () => {
      expect(validateGatewayUrl('http://example.com').allowed).toBe(true)
      expect(validateGatewayUrl('https://example.com').allowed).toBe(true)
    })

    it('blocks file:// protocol', () => {
      const result = validateGatewayUrl('file:///etc/passwd')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('HTTP/HTTPS')
    })

    it('blocks ftp:// protocol', () => {
      const result = validateGatewayUrl('ftp://example.com/file')
      expect(result.allowed).toBe(false)
    })

    it('blocks javascript: protocol', () => {
      const result = validateGatewayUrl('javascript:alert(1)')
      expect(result.allowed).toBe(false)
    })
  })

  describe('Invalid URLs', () => {
    it('rejects malformed URLs', () => {
      const result = validateGatewayUrl('not-a-url')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Invalid URL')
    })

    it('rejects empty string', () => {
      const result = validateGatewayUrl('')
      expect(result.allowed).toBe(false)
    })
  })

  describe('Attack Scenarios', () => {
    it('blocks Redis SSRF attempt', () => {
      // Attacker tries to reach internal Redis
      expect(validateGatewayUrl('http://127.0.0.1:6379').allowed).toBe(false)
    })

    it('blocks internal admin panel access', () => {
      // Attacker tries to reach internal service
      expect(validateGatewayUrl('http://10.0.0.5:8080/admin').allowed).toBe(false)
    })

    it('blocks cloud metadata exfiltration', () => {
      // AWS
      expect(
        validateGatewayUrl('http://169.254.169.254/latest/meta-data/iam/security-credentials/')
          .allowed
      ).toBe(false)
      // GCP
      expect(validateGatewayUrl('http://169.254.169.254/computeMetadata/v1/').allowed).toBe(false)
    })

    it('blocks docker socket access', () => {
      // Docker socket over HTTP
      expect(validateGatewayUrl('http://127.0.0.1:2375/containers/json').allowed).toBe(false)
    })
  })
})
