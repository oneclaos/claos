import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { validateRequest, isPathAllowed } from '@/lib/validation'
import { auditLog } from '@/lib/audit'
import { rm, stat, mkdir, rename, realpath } from 'fs/promises'
import { resolve, basename, join } from 'path'
import { z } from 'zod'

// Trash directory (uses $HOME or /tmp as fallback)
const TRASH_DIR =
  process.env.TRASH_DIR ||
  (process.env.HOME ? `${process.env.HOME}/.local/share/claos-trash` : '/tmp/claos-trash')

// Schema for delete request
const fileDeleteRequestSchema = z.object({
  path: z
    .string()
    .max(500, 'Path too long')
    .refine((path) => !path.includes('..'), 'Path traversal not allowed')
    .refine((path) => !path.includes('\0'), 'Null bytes not allowed'),
})

// Protected paths that cannot be deleted
const PROTECTED_PATTERNS = [
  '.env',
  '.ssh',
  '.gnupg',
  'node_modules',
  '.git',
  'AGENTS.md',
  'SOUL.md',
  'USER.md',
  'IDENTITY.md',
]

function getClientInfo(request: NextRequest) {
  return {
    ip:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
  }
}

// DELETE /api/files/delete - Delete file or directory
export async function DELETE(request: NextRequest) {
  const { ip, userAgent } = getClientInfo(request)

  // Auth check
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token, ip, userAgent)) {
    auditLog('security', 'unauthorized_file_delete', { ip }, 'warn')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // CSRF check
  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    auditLog('security', 'csrf_violation', { ip, action: 'file_delete' }, 'warn')
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const path = searchParams.get('path')

    if (!path) {
      return NextResponse.json({ error: 'Path required' }, { status: 400 })
    }

    // Validate request
    const validation = validateRequest(fileDeleteRequestSchema, { path })
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Resolve path and follow symlinks to prevent symlink traversal attacks
    const resolvedPath = resolve(validation.data.path)
    const realResolvedPath = await realpath(resolvedPath).catch(() => null)
    if (!realResolvedPath) {
      return NextResponse.json({ error: 'Path not found' }, { status: 404 })
    }

    if (!isPathAllowed(realResolvedPath)) {
      auditLog(
        'security',
        'path_traversal_attempt',
        { ip, path: realResolvedPath, action: 'delete' },
        'warn'
      )
      return NextResponse.json(
        { error: 'Access denied - path outside allowed directories' },
        { status: 403 }
      )
    }

    // Block protected paths
    const fileName = basename(realResolvedPath)
    const pathLower = realResolvedPath.toLowerCase()

    if (
      PROTECTED_PATTERNS.some(
        (p) =>
          pathLower.endsWith(p.toLowerCase()) ||
          pathLower.includes(`/${p.toLowerCase()}/`) ||
          fileName.toLowerCase() === p.toLowerCase()
      )
    ) {
      auditLog('security', 'protected_file_delete_blocked', { ip, path: resolvedPath }, 'warn')
      return NextResponse.json({ error: 'Cannot delete protected paths' }, { status: 403 })
    }

    // Check if exists and get info for audit
    const pathStat = await stat(realResolvedPath).catch(() => null)
    if (!pathStat) {
      return NextResponse.json({ error: 'Path not found' }, { status: 404 })
    }

    const isDirectory = pathStat.isDirectory()
    const size = pathStat.size

    // Check if trash mode is requested
    const useTrash = searchParams.get('trash') === 'true'
    let trashPath: string | undefined

    if (useTrash) {
      // Move to trash instead of deleting
      await mkdir(TRASH_DIR, { recursive: true })
      const timestamp = Date.now()
      const trashName = `${timestamp}-${basename(realResolvedPath)}`
      trashPath = join(TRASH_DIR, trashName)

      await rename(realResolvedPath, trashPath)

      auditLog('file', 'trashed', {
        ip,
        path: realResolvedPath,
        trashPath,
        isDirectory,
        size,
      })
    } else {
      // Permanent delete
      await rm(realResolvedPath, { recursive: true })

      auditLog('file', 'deleted', {
        ip,
        path: realResolvedPath,
        isDirectory,
        size,
      })
    }

    return NextResponse.json({
      success: true,
      path: realResolvedPath,
      wasDirectory: isDirectory,
      trashed: useTrash,
      trashPath,
    })
  } catch (err) {
    auditLog(
      'file',
      'delete_error',
      {
        ip,
        error: err instanceof Error ? err.message : 'unknown',
      },
      'error'
    )
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
