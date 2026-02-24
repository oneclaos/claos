import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Note: middleware runs in the Edge Runtime where Node.js 'crypto' is unavailable.
// We use the Web Crypto API (globalThis.crypto) which is available everywhere.

// ── Rate Limiting (in-memory, per-instance) ──────────────────────────────────
// Lightweight rate limiter for Edge Runtime. For horizontal scaling, use Redis.
interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 500 // max requests per window for general API
const RATE_LIMIT_MAX_SENSITIVE = 100 // max requests per window for sensitive routes

// Sensitive routes that get stricter rate limiting
// Note: /api/terminal removed - stream/resize are called frequently
const sensitiveRoutes = [
  '/api/files/write',
  '/api/files/create',
  '/api/files/delete',
  '/api/sessions/spawn',
  '/api/settings/password',
]

function checkRateLimit(
  ip: string,
  isSensitive: boolean
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  const key = isSensitive ? `sensitive:${ip}` : `general:${ip}`
  const maxRequests = isSensitive ? RATE_LIMIT_MAX_SENSITIVE : RATE_LIMIT_MAX_REQUESTS

  let entry = rateLimitStore.get(key)

  // Clean up expired entries periodically (every 100 checks)
  if (Math.random() < 0.01) {
    for (const [k, v] of rateLimitStore) {
      if (v.resetAt < now) rateLimitStore.delete(k)
    }
  }

  if (!entry || entry.resetAt < now) {
    entry = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }
    rateLimitStore.set(key, entry)
    return { allowed: true, remaining: maxRequests - 1, resetAt: entry.resetAt }
  }

  entry.count++
  const allowed = entry.count <= maxRequests
  return { allowed, remaining: Math.max(0, maxRequests - entry.count), resetAt: entry.resetAt }
}

function getClientIp(request: NextRequest): string {
  // Check common proxy headers
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp
  }
  // Fallback - in Edge Runtime, we can't reliably get IP without headers
  return 'unknown'
}

// Routes that don't require authentication
const publicRoutes = [
  '/login',
  '/setup',
  '/first-run',
  '/api/auth',
  '/api/first-run',
  '/api/health',
  '/api/csp-report',
]

// Routes that require CSRF validation (mutating operations)
// Keep exhaustive — middleware is the first line of defence
const csrfProtectedRoutes = [
  '/api/files/write',
  '/api/files/create',
  '/api/files/delete',
  '/api/files/move',
  '/api/groups',
  '/api/send',
  '/api/terminal',
  '/api/sessions/send',
  '/api/sessions/spawn',
  '/api/sessions/rename',
  '/api/settings/password',
  '/api/gateways',
]

// Static security headers (CSP is generated per-request to include the nonce)
const staticSecurityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
}

/**
 * Build a per-request Content-Security-Policy with a nonce.
 *
 * WHY nonce instead of 'unsafe-inline':
 *   Next.js App Router injects inline <script> tags for RSC hydration payloads.
 *   Rather than allow all inline scripts with 'unsafe-inline', we generate a
 *   random nonce per request and pass it to Next.js via the x-nonce request
 *   header. Next.js reads this header and applies the nonce to its inline
 *   scripts, so only those trusted scripts execute.
 *
 * WHY style-src keeps 'unsafe-inline':
 *   Tailwind CSS and Radix UI use inline style attributes for dynamic values
 *   (animation delays, popover positions, etc.). Removing 'unsafe-inline' from
 *   style-src would require nonces on every inline style element — something
 *   Next.js does not automate. This is acceptable: style injection attacks are
 *   far less dangerous than script injection.
 */
function buildCSP(nonce: string): string {
  // 'unsafe-eval' is required by highlight.js (markdown syntax highlighting).
  // This is an internal, authenticated dashboard — the risk is acceptable.
  const scriptSrc = `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com https://cdn.fontshare.com",
    "img-src 'self' data: https:",
    "font-src 'self' https://fonts.gstatic.com https://api.fontshare.com https://cdn.fontshare.com",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'report-uri /api/csp-report',
  ].join('; ')
}

/**
 * Create a NextResponse.next() that forwards the nonce as a request header
 * so that the root layout can read it via `headers().get('x-nonce')`.
 */
function nextWithNonce(request: NextRequest, nonce: string): NextResponse {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

/** Apply CSP + static security headers to any response. */
function addSecurityHeaders(
  response: NextResponse,
  csp: string,
  origin?: string | null
): NextResponse {
  response.headers.set('Content-Security-Policy', csp)
  for (const [key, value] of Object.entries(staticSecurityHeaders)) {
    response.headers.set(key, value)
  }

  // CORS headers - strict same-origin policy
  // Only allow requests from the same origin (no cross-origin API access)
  if (origin) {
    // Reflect origin only if it matches our expected pattern (same host)
    // In production, this would check against a whitelist
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-CSRF-Token, X-Request-ID'
    )
    response.headers.set('Access-Control-Max-Age', '86400')
  }

  return response
}

/** Create rate limit exceeded response */
function rateLimitResponse(resetAt: number, csp: string): NextResponse {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000)
  const response = NextResponse.json({ error: 'Too many requests', retryAfter }, { status: 429 })
  response.headers.set('Retry-After', String(retryAfter))
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const method = request.method
  const origin = request.headers.get('origin')

  // Generate a per-request nonce for CSP using the Web Crypto API (Edge Runtime safe)
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  const nonce = btoa(String.fromCharCode(...array))
  const csp = buildCSP(nonce)

  // Handle CORS preflight requests
  if (method === 'OPTIONS' && pathname.startsWith('/api/')) {
    const response = new NextResponse(null, { status: 204 })
    return addSecurityHeaders(response, csp, origin)
  }

  // Rate limiting for API routes (except health check)
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/health')) {
    const clientIp = getClientIp(request)
    const isSensitive = sensitiveRoutes.some((route) => pathname.startsWith(route))
    const rateLimit = checkRateLimit(clientIp, isSensitive)

    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.resetAt, csp)
    }
  }

  // Redirect old routes to new locations
  if (pathname === '/chat' || pathname === '/conversations') {
    return NextResponse.redirect(new URL('/', request.url))
  }
  if (pathname === '/dashboard') {
    return NextResponse.redirect(new URL('/status', request.url))
  }

  // Force HTTPS in production (when behind a proxy)
  if (process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true') {
    const proto = request.headers.get('x-forwarded-proto')
    if (proto && !proto.includes('https')) {
      const httpsUrl = new URL(request.url)
      httpsUrl.protocol = 'https:'
      return NextResponse.redirect(httpsUrl)
    }
  }

  // Allow public routes
  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return addSecurityHeaders(nextWithNonce(request, nonce), csp, origin)
  }

  // Check for session cookie
  const session = request.cookies.get('claos_session')

  if (!session?.value) {
    if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        csp,
        origin
      )
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Basic session token validation
  if (session.value.length !== 64 || !/^[a-f0-9]+$/.test(session.value)) {
    if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(
        NextResponse.json({ error: 'Invalid session' }, { status: 401 }),
        csp,
        origin
      )
    }
    const response = NextResponse.redirect(new URL('/login', request.url))
    response.cookies.delete('claos_session')
    return response
  }

  // CSRF validation for mutating requests
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const needsCsrf = csrfProtectedRoutes.some((route) => pathname.startsWith(route))

    if (needsCsrf) {
      const csrfToken = request.headers.get('x-csrf-token')

      if (!csrfToken) {
        return addSecurityHeaders(
          NextResponse.json({ error: 'CSRF token required' }, { status: 403 }),
          csp,
          origin
        )
      }

      if (!/^\w+\.\w+$/.test(csrfToken)) {
        return addSecurityHeaders(
          NextResponse.json({ error: 'Invalid CSRF token format' }, { status: 403 }),
          csp,
          origin
        )
      }
    }
  }

  return addSecurityHeaders(nextWithNonce(request, nonce), csp, origin)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)'],
}
