import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { validateRequest, isPathAllowed } from '@/lib/validation'
import { auditLog } from '@/lib/audit'
import { rename, stat, mkdir, copyFile, cp, realpath } from 'fs/promises'
import { resolve, dirname } from 'path'
import { z } from 'zod'

const fileMoveRequestSchema = z.object({
  source: z
    .string()
    .max(500, 'Path too long')
    .refine((path) => !path.includes('..'), 'Path traversal not allowed'),
  destination: z
    .string()
    .max(500, 'Path too long')
    .refine((path) => !path.includes('..'), 'Path traversal not allowed'),
  action: z.enum(['move', 'copy', 'rename']),
})

function getClientInfo(request: NextRequest) {
  return {
    ip:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
  }
}

export async function POST(request: NextRequest) {
  const { ip, userAgent } = getClientInfo(request)

  const token = await getSessionFromCookies()
  if (!token || !validateSession(token, ip, userAgent)) {
    auditLog('security', 'unauthorized_file_move', { ip }, 'warn')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    auditLog('security', 'csrf_violation', { ip, action: 'file_move' }, 'warn')
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const validation = validateRequest(fileMoveRequestSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { source, destination, action } = validation.data
    const resolvedSource = resolve(source)
    const resolvedDest = resolve(destination)

    // Resolve source with realpath to prevent symlink traversal
    const sourceRealPath = await realpath(resolvedSource).catch(() => null)
    if (!sourceRealPath) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 })
    }

    // Resolve destination parent with realpath
    const destParentRealPath = await realpath(dirname(resolvedDest)).catch(() => null)

    // Validate paths are allowed (symlink-safe)
    const sourceAllowed = isPathAllowed(sourceRealPath)
    const destAllowed = destParentRealPath
      ? isPathAllowed(destParentRealPath)
      : isPathAllowed(resolvedDest)

    if (!sourceAllowed || !destAllowed) {
      auditLog(
        'security',
        'path_traversal_attempt',
        { ip, source: resolvedSource, dest: resolvedDest },
        'warn'
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const sourceStat = await stat(sourceRealPath).catch(() => null)
    if (!sourceStat) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 })
    }

    const destExists = await stat(resolvedDest).catch(() => null)
    if (destExists) {
      return NextResponse.json({ error: 'Destination already exists' }, { status: 409 })
    }

    await mkdir(dirname(resolvedDest), { recursive: true })

    if (action === 'copy') {
      if (sourceStat.isDirectory()) {
        await cp(sourceRealPath, resolvedDest, { recursive: true })
      } else {
        await copyFile(sourceRealPath, resolvedDest)
      }
    } else {
      await rename(sourceRealPath, resolvedDest)
    }

    auditLog('file', action, { ip, source: sourceRealPath, destination: resolvedDest })

    return NextResponse.json({
      success: true,
      source: sourceRealPath,
      destination: resolvedDest,
      action,
    })
  } catch (err) {
    auditLog(
      'file',
      'move_error',
      { ip, error: err instanceof Error ? err.message : 'unknown' },
      'error'
    )
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 })
  }
}
