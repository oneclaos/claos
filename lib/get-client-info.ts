import type { NextRequest } from 'next/server'

/**
 * Extracts client IP and User-Agent from a Next.js request.
 * Supports X-Forwarded-For (reverse proxy) and X-Real-IP headers.
 */
export function getClientInfo(request: NextRequest): { ip: string; userAgent: string } {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  const userAgent = request.headers.get('user-agent') || 'unknown'
  return { ip, userAgent }
}
