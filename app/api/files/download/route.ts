import { log } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession } from '@/lib/auth'
import { validateRequest, fileReadRequestSchema, ALLOWED_BASE_PATHS } from '@/lib/validation'
import { stat, readFile } from 'fs/promises'
import { resolve, basename } from 'path'

// Max download size: 50MB
const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024

// GET /api/files/download - Download file
export async function GET(request: Request) {
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const path = searchParams.get('path')
    
    if (!path) {
      return NextResponse.json({ error: 'Path required' }, { status: 400 })
    }

    // Validate path - use same schema but we'll check size separately
    const validation = validateRequest(fileReadRequestSchema, { path })
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Resolve and verify path is within allowed directories
    const resolvedPath = resolve(validation.data.path)
    const isAllowed = ALLOWED_BASE_PATHS.some(base => 
      resolvedPath.startsWith(base)
    )
    
    if (!isAllowed) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Check if path exists and is a file
    const pathStat = await stat(resolvedPath).catch(() => null)
    if (!pathStat) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    if (pathStat.isDirectory()) {
      return NextResponse.json({ error: 'Cannot download directory' }, { status: 400 })
    }

    // Check file size
    if (pathStat.size > MAX_DOWNLOAD_SIZE) {
      return NextResponse.json({ 
        error: 'File too large for download',
        size: pathStat.size,
        maxSize: MAX_DOWNLOAD_SIZE
      }, { status: 400 })
    }

    // Read file
    const buffer = await readFile(resolvedPath)
    const filename = basename(resolvedPath)

    // Return as download
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length)
      }
    })
  } catch (err) {
    log.error('Failed to download file:', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Failed to download file' }, { status: 500 })
  }
}
