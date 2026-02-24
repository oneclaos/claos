import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { validateRequest, isPathAllowed } from '@/lib/validation'
import { auditLog } from '@/lib/audit'
import { writeFile, mkdir, stat, rename, realpath } from 'fs/promises'
import { resolve, dirname, basename, extname } from 'path'
import { z } from 'zod'

// Trash directory
// Trash directory (uses $HOME or /tmp as fallback)
const TRASH_DIR =
  process.env.TRASH_DIR ||
  (process.env.HOME ? `${process.env.HOME}/.local/share/claos-trash` : '/tmp/claos-trash')

// Schema for create request
const fileCreateRequestSchema = z.object({
  path: z
    .string()
    .max(500, 'Path too long')
    .refine((path) => !path.includes('..'), 'Path traversal not allowed')
    .refine((path) => !path.includes('\0'), 'Null bytes not allowed'),
  isDirectory: z.boolean().default(false),
  restore: z.boolean().default(false),
  trashPath: z.string().optional(),
})

// Blocked file extensions for creation (security)
const BLOCKED_EXTENSIONS = [
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.vbs',
  '.js',
  '.mjs',
  '.cjs', // Executable scripts
  '.ts',
  '.py', // Script languages — blocked from creation via file manager
]

// Blocked file names
const BLOCKED_NAMES = [
  '.env',
  '.env.local',
  '.env.production',
  '.ssh',
  '.gnupg',
  '.npmrc',
  '.pypirc',
  'id_rsa',
  'id_ed25519',
  'authorized_keys',
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

// POST /api/files/create - Create file or directory
export async function POST(request: NextRequest) {
  const { ip, userAgent } = getClientInfo(request)

  // Auth check
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token, ip, userAgent)) {
    auditLog('security', 'unauthorized_file_create', { ip }, 'warn')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // CSRF check
  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    auditLog('security', 'csrf_violation', { ip, action: 'file_create' }, 'warn')
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const body = await request.json()

    // Validate request
    const validation = validateRequest(fileCreateRequestSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { path, isDirectory, restore, trashPath } = validation.data

    // Handle restore from trash
    if (restore && trashPath) {
      const resolvedTrashPath = resolve(trashPath)

      // Verify trash path is valid
      if (!resolvedTrashPath.startsWith(TRASH_DIR)) {
        auditLog('security', 'invalid_trash_restore', { ip, trashPath: resolvedTrashPath }, 'warn')
        return NextResponse.json({ error: 'Invalid trash path' }, { status: 403 })
      }

      // Check if trash item exists
      const trashExists = await stat(resolvedTrashPath).catch(() => null)
      if (!trashExists) {
        return NextResponse.json({ error: 'Item not found in trash' }, { status: 404 })
      }

      // Restore to original path - resolve parent dir with realpath for symlink protection
      const resolvedPath = resolve(path)
      const parentDir = dirname(resolvedPath)
      const parentRealPath = await realpath(parentDir).catch(() => null)

      if (!parentRealPath || !isPathAllowed(parentRealPath)) {
        return NextResponse.json({ error: 'Cannot restore to this location' }, { status: 403 })
      }

      // Ensure parent directory exists
      await mkdir(dirname(resolvedPath), { recursive: true })

      // Move from trash back to original location
      await rename(resolvedTrashPath, resolvedPath)

      auditLog('file', 'restored', {
        ip,
        path: resolvedPath,
        fromTrash: resolvedTrashPath,
      })

      return NextResponse.json({
        success: true,
        path: resolvedPath,
        restored: true,
      })
    }

    // Resolve and verify path is within allowed directories (symlink-safe)
    const resolvedPath = resolve(path)
    const parentDir = dirname(resolvedPath)
    const parentRealPath = await realpath(parentDir).catch(() => null)

    // If parent doesn't exist yet, we need to check the first existing ancestor
    if (!parentRealPath) {
      // Parent doesn't exist - check if the path itself would be allowed
      if (!isPathAllowed(resolvedPath)) {
        auditLog(
          'security',
          'path_traversal_attempt',
          { ip, path: resolvedPath, action: 'create' },
          'warn'
        )
        return NextResponse.json(
          { error: 'Access denied - path outside allowed directories' },
          { status: 403 }
        )
      }
    } else if (!isPathAllowed(parentRealPath)) {
      auditLog(
        'security',
        'path_traversal_attempt',
        { ip, path: resolvedPath, action: 'create' },
        'warn'
      )
      return NextResponse.json(
        { error: 'Access denied - path outside allowed directories' },
        { status: 403 }
      )
    }

    const fileName = basename(resolvedPath).toLowerCase()
    const ext = extname(resolvedPath).toLowerCase()

    // Block dangerous extensions for files
    if (!isDirectory && BLOCKED_EXTENSIONS.includes(ext)) {
      auditLog('security', 'blocked_extension_create', { ip, path: resolvedPath, ext }, 'warn')
      return NextResponse.json(
        { error: `Cannot create files with ${ext} extension` },
        { status: 403 }
      )
    }

    // Block sensitive file names
    if (BLOCKED_NAMES.some((name) => fileName === name.toLowerCase())) {
      auditLog('security', 'blocked_filename_create', { ip, path: resolvedPath }, 'warn')
      return NextResponse.json({ error: 'Cannot create sensitive files' }, { status: 403 })
    }

    // Check if already exists
    const exists = await stat(resolvedPath).catch(() => null)
    if (exists) {
      return NextResponse.json({ error: 'Path already exists' }, { status: 409 })
    }

    if (isDirectory) {
      await mkdir(resolvedPath, { recursive: true })
    } else {
      // Ensure parent directory exists
      await mkdir(dirname(resolvedPath), { recursive: true })
      await writeFile(resolvedPath, '', 'utf-8')
    }

    auditLog('file', 'created', {
      ip,
      path: resolvedPath,
      isDirectory,
    })

    return NextResponse.json({
      success: true,
      path: resolvedPath,
      type: isDirectory ? 'directory' : 'file',
    })
  } catch (err) {
    auditLog(
      'file',
      'create_error',
      {
        ip,
        error: err instanceof Error ? err.message : 'unknown',
      },
      'error'
    )
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  }
}
