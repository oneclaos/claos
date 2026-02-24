import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { validateRequest, isPathAllowed } from '@/lib/validation'
import { auditLog } from '@/lib/audit'
import { writeFile, mkdir, stat, realpath } from 'fs/promises'
import { resolve, dirname, basename } from 'path'
import { z } from 'zod'

// Schema for write request
const fileWriteRequestSchema = z.object({
  path: z.string()
    .max(500, 'Path too long')
    .refine(path => !path.includes('..'), 'Path traversal not allowed')
    .refine(path => !path.includes('\0'), 'Null bytes not allowed'),
  content: z.string().max(10_000_000, 'File too large (max 10MB)')
})

// Blocked file patterns (security)
const BLOCKED_PATTERNS = [
  '.env',
  '.ssh',
  '.gnupg',
  'id_rsa',
  'id_ed25519',
  '.git/config',
  '.git/credentials',
  'node_modules',
  '.npmrc',
  '.pypirc'
]

function getClientInfo(request: NextRequest) {
  return {
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || request.headers.get('x-real-ip') 
      || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown'
  }
}

// PUT /api/files/write - Write file content
export async function PUT(request: NextRequest) {
  const { ip, userAgent } = getClientInfo(request)
  
  // Auth check
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token, ip, userAgent)) {
    auditLog('security', 'unauthorized_file_write', { ip }, 'warn')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // CSRF check
  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    auditLog('security', 'csrf_violation', { ip, action: 'file_write' }, 'warn')
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const body = await request.json()
    
    // Validate request
    const validation = validateRequest(fileWriteRequestSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { path, content } = validation.data

    // Resolve path — follow symlinks on parent dir (file may not exist yet)
    const resolvedPath = resolve(path)
    const parentRealPath = await realpath(dirname(resolvedPath)).catch(() => null)
    if (!parentRealPath || !isPathAllowed(parentRealPath + '/')) {
      auditLog('security', 'path_traversal_attempt', { ip, path: resolvedPath }, 'warn')
      return NextResponse.json({ error: 'Access denied - path outside allowed directories' }, { status: 403 })
    }
    // Canonical target path (parent is real + filename)
    const canonicalPath = parentRealPath + '/' + basename(resolvedPath)

    // Block sensitive files
    const fileName = basename(canonicalPath).toLowerCase()
    const pathLower = canonicalPath.toLowerCase()
    
    if (BLOCKED_PATTERNS.some(p => pathLower.includes(p) || fileName === p)) {
      auditLog('security', 'sensitive_file_write_blocked', { ip, path: canonicalPath }, 'warn')
      return NextResponse.json({ error: 'Cannot write to sensitive files' }, { status: 403 })
    }

    // Check if file exists (for audit purposes)
    const existingStat = await stat(canonicalPath).catch(() => null)
    const isNewFile = !existingStat

    // Ensure parent directory exists
    await mkdir(parentRealPath, { recursive: true })

    // Write file
    await writeFile(canonicalPath, content, 'utf-8')
    
    const size = Buffer.byteLength(content, 'utf-8')
    
    auditLog('file', isNewFile ? 'created' : 'modified', { 
      ip, 
      path: canonicalPath, 
      size,
      isNewFile 
    })

    return NextResponse.json({ 
      success: true, 
      path: canonicalPath,
      size,
      isNewFile
    })
  } catch (err) {
    auditLog('file', 'write_error', { 
      ip, 
      error: err instanceof Error ? err.message : 'unknown' 
    }, 'error')
    return NextResponse.json({ error: 'Failed to write file' }, { status: 500 })
  }
}
