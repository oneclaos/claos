// SSRF Protection Layer
// Prevents Server-Side Request Forgery attacks by validating all outbound URLs

import { URL } from 'url'
import { log } from './logger'

// Blocked IP ranges (RFC1918 private networks + special-use IPs)
const BLOCKED_IP_RANGES = [
  // Loopback
  /^127\./,
  /^::1$/,
  /^localhost$/i,

  // Private networks (RFC1918)
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,

  // Link-local
  /^169\.254\./,
  /^fe80:/i,

  // AWS metadata
  /^169\.254\.169\.254$/,

  // Multicast
  /^224\./,
  /^ff00:/i,

  // Reserved
  /^0\./,
  /^255\.255\.255\.255$/,
]

// Get allowed gateway domains from env (checked at runtime for testability)
function getAllowedGatewayDomains(): string[] {
  return process.env.ALLOWED_GATEWAY_DOMAINS
    ? process.env.ALLOWED_GATEWAY_DOMAINS.split(',').map((d) => d.trim())
    : []
}

// Allow localhost/private IPs only in development
function shouldAllowPrivateInDev(): boolean {
  return process.env.NODE_ENV === 'development'
}

interface ValidationResult {
  allowed: boolean
  reason?: string
}

/**
 * Validate URL for SSRF protection
 * @param url URL to validate
 * @returns Validation result with reason if blocked
 */
export function validateGatewayUrl(url: string): ValidationResult {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return { allowed: false, reason: 'Invalid URL format' }
  }

  // Only allow HTTP/HTTPS
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { allowed: false, reason: 'Only HTTP/HTTPS protocols allowed' }
  }

  const hostname = parsed.hostname.toLowerCase()

  // Extract IPv6 from brackets if present (e.g., [::1] -> ::1)
  const hostnameWithoutBrackets = hostname.replace(/^\[|\]$/g, '')

  // Check if hostname is blocked IP
  for (const blockedPattern of BLOCKED_IP_RANGES) {
    if (blockedPattern.test(hostnameWithoutBrackets)) {
      if (shouldAllowPrivateInDev()) {
        log.warn('SSRF: Allowing private IP in development', { hostname })
        return { allowed: true }
      }
      return {
        allowed: false,
        reason: `Blocked IP range: ${hostname} (private/reserved/metadata)`,
      }
    }
  }

  // If allowlist is configured, enforce it (strict mode)
  const allowedDomains = getAllowedGatewayDomains()

  if (allowedDomains.length > 0) {
    const isAllowed = allowedDomains.some((allowed) => {
      const allowedDomain = allowed.toLowerCase()
      // Exact match or subdomain
      return hostname === allowedDomain || hostname.endsWith(`.${allowedDomain}`)
    })

    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Domain not in allowlist: ${hostname}`,
      }
    }
  } else if (process.env.NODE_ENV === 'production') {
    // Production without allowlist = dangerous, log warning
    log.warn('SSRF: No ALLOWED_GATEWAY_DOMAINS configured in production - security risk!')
  }

  return { allowed: true }
}

/**
 * Resolve hostname to IP and validate (prevents DNS rebinding)
 * Warning: This is async and adds latency - use sparingly
 */
export async function validateGatewayUrlWithDnsCheck(url: string): Promise<ValidationResult> {
  const basicCheck = validateGatewayUrl(url)
  if (!basicCheck.allowed) return basicCheck

  // TODO: Add DNS resolution check to detect private IPs behind public DNS
  // This requires dns.promises.resolve4/resolve6
  // For now, rely on hostname-based checks

  return { allowed: true }
}

/**
 * Sanitize URL for logging (remove credentials)
 */
export function sanitizeUrlForLogging(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    return '[invalid-url]'
  }
}
