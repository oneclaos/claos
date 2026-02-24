import { log } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession } from '@/lib/auth'
import { 
  validateRequest, 
  fileReadRequestSchema, 
  isPathAllowed,
  ALLOWED_PREVIEW_EXTENSIONS,
  MAX_FILE_PREVIEW_SIZE 
} from '@/lib/validation'
import { stat, readFile, realpath } from 'fs/promises'
import { resolve, extname, basename } from 'path'
import type { FileContent } from '@/lib/types'

// Sensitive file patterns — blocked from reading (mirrors write route)
const BLOCKED_READ_PATTERNS = [
  '.env',
  '.env.',
  '.ssh',
  '.gnupg',
  'id_rsa',
  'id_ed25519',
  '.git/config',
  '.git/credentials',
  '.npmrc',
  '.pypirc',
  'credentials',
  'secrets',
  'private_key',
  '.claos'
]

// MIME types for preview
const mimeTypes: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/toml',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.jsx': 'text/jsx',
  '.tsx': 'text/tsx',
  '.css': 'text/css',
  '.html': 'text/html',
  '.py': 'text/x-python',
  '.sh': 'application/x-sh',
  '.bash': 'application/x-sh',
  '.zsh': 'application/x-sh',
  '.fish': 'application/x-fish',
  '.env': 'text/plain',
  '.gitignore': 'text/plain',
  '.dockerignore': 'text/plain',
  '.conf': 'text/plain',
  '.cfg': 'text/plain',
  '.ini': 'text/plain',
  '.log': 'text/plain',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv'
}

// GET /api/files/read - Read file content
export async function GET(request: Request) {
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const path = searchParams.get('path')
    const maxSizeParam = searchParams.get('maxSize')
    
    if (!path) {
      return NextResponse.json({ error: 'Path required' }, { status: 400 })
    }

    // Validate path
    const validation = validateRequest(fileReadRequestSchema, { 
      path,
      maxSize: maxSizeParam ? parseInt(maxSizeParam, 10) : undefined
    })
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Resolve path and follow symlinks (prevents symlink traversal attacks)
    const resolvedPath = resolve(validation.data.path)
    
    // Follow symlinks and get the real path before checking allowlist
    const realResolvedPath = await realpath(resolvedPath).catch(() => null)
    if (!realResolvedPath) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    if (!isPathAllowed(realResolvedPath)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Block sensitive files (same policy as write route)
    const fileName = basename(realResolvedPath).toLowerCase()
    const pathLower = realResolvedPath.toLowerCase()
    if (BLOCKED_READ_PATTERNS.some(p => pathLower.includes(p) || fileName === p)) {
      return NextResponse.json({ error: 'Access denied - sensitive file' }, { status: 403 })
    }

    // Check if path exists and is a file
    const pathStat = await stat(realResolvedPath).catch(() => null)
    if (!pathStat) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    if (pathStat.isDirectory()) {
      return NextResponse.json({ error: 'Path is a directory' }, { status: 400 })
    }

    // Check extension is allowed for preview
    const ext = extname(resolvedPath).toLowerCase()
    if (!ALLOWED_PREVIEW_EXTENSIONS.includes(ext as typeof ALLOWED_PREVIEW_EXTENSIONS[number])) {
      return NextResponse.json({ 
        error: 'File type not supported for preview',
        extension: ext,
        allowedExtensions: ALLOWED_PREVIEW_EXTENSIONS
      }, { status: 400 })
    }

    // Check file size
    if (pathStat.size > MAX_FILE_PREVIEW_SIZE) {
      return NextResponse.json({ 
        error: 'File too large for preview',
        size: pathStat.size,
        maxSize: MAX_FILE_PREVIEW_SIZE
      }, { status: 400 })
    }

    // Read file content
    const maxSize = validation.data.maxSize
    let content: string
    
    if (pathStat.size > maxSize) {
      // Read only up to maxSize
      const buffer = await readFile(realResolvedPath)
      content = buffer.slice(0, maxSize).toString('utf-8')
      content += '\n\n... [truncated]'
    } else {
      content = await readFile(realResolvedPath, 'utf-8')
    }

    const response: FileContent = {
      path: realResolvedPath,
      content,
      size: pathStat.size,
      mimeType: mimeTypes[ext] || 'text/plain',
      encoding: 'utf-8'
    }

    return NextResponse.json(response)
  } catch (err) {
    log.error('Failed to read file:', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
  }
}
