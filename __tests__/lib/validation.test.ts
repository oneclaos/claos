// Tests for validation schemas and security checks

import { isPathAllowed, BLOCKED_PATHS } from '@/lib/validation'

describe('File Path Validation', () => {
  describe('isPathAllowed', () => {
    beforeEach(() => {
      // Reset to default restrictive paths
      delete process.env.ALLOWED_BASE_PATHS
    })

    describe('Default Restrictive Allowlist', () => {
      it('should allow paths in /home', () => {
        expect(isPathAllowed('/home/user/file.txt')).toBe(true)
      })

      it('should allow paths in /srv', () => {
        expect(isPathAllowed('/srv/app/config.json')).toBe(true)
      })

      it('should allow paths in /var/www', () => {
        expect(isPathAllowed('/var/www/html/index.html')).toBe(true)
      })

      it('should BLOCK root filesystem by default', () => {
        expect(isPathAllowed('/etc/config.conf')).toBe(false)
        expect(isPathAllowed('/usr/bin/bash')).toBe(false)
        expect(isPathAllowed('/root/secret.txt')).toBe(false)
      })
    })

    describe('Blocked Paths (Always Denied)', () => {
      beforeEach(() => {
        // Even with full access, these should be blocked
        process.env.ALLOWED_BASE_PATHS = '/'
      })

      const criticalPaths = [
        '/etc/shadow',
        '/etc/passwd',
        '/etc/sudoers',
        '/root/file.txt',
        '/proc/1/environ',
        '/sys/kernel/debug',
        '/dev/random',
      ]

      criticalPaths.forEach((path) => {
        it(`should always block ${path}`, () => {
          expect(isPathAllowed(path)).toBe(false)
        })
      })
    })

    describe('Custom Allowlist via Env', () => {
      it('should respect ALLOWED_BASE_PATHS env var', () => {
        process.env.ALLOWED_BASE_PATHS = '/custom/path,/another/path'

        expect(isPathAllowed('/custom/path/file.txt')).toBe(true)
        expect(isPathAllowed('/another/path/file.txt')).toBe(true)
        expect(isPathAllowed('/home/user/file.txt')).toBe(false) // No longer allowed
      })

      it('should handle trailing slashes', () => {
        process.env.ALLOWED_BASE_PATHS = '/home/'
        expect(isPathAllowed('/home/user/file.txt')).toBe(true)
      })

      it('should handle full filesystem access with root slash', () => {
        process.env.ALLOWED_BASE_PATHS = '/'

        // Should allow paths not in BLOCKED_PATHS
        expect(isPathAllowed('/home/user/file.txt')).toBe(true)
        expect(isPathAllowed('/opt/app/config.json')).toBe(true)

        // But still block critical paths
        expect(isPathAllowed('/etc/shadow')).toBe(false)
        expect(isPathAllowed('/root/secret.key')).toBe(false)
        expect(isPathAllowed('/proc/1/environ')).toBe(false)
      })
    })
  })
})
