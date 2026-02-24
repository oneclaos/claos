import { log } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession } from '@/lib/auth'
import {
  validateRequest,
  fileBrowseRequestSchema,
  ALLOWED_BASE_PATHS,
  getDefaultHomePath,
} from '@/lib/validation'
import { stat, readdir } from 'fs/promises'
import { join, resolve, dirname } from 'path'
import type { FileEntry, DirectoryListing } from '@/lib/types'

// GET /api/files - Browse directory
export async function GET(request: Request) {
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const path = searchParams.get('path') || getDefaultHomePath()

    // Validate path
    const validation = validateRequest(fileBrowseRequestSchema, { path })
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Resolve and verify path is within allowed directories
    const resolvedPath = resolve(validation.data.path)
    const isAllowed = ALLOWED_BASE_PATHS.some(
      (base) => resolvedPath.startsWith(base) || resolvedPath === base
    )

    if (!isAllowed) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Check if path exists
    let pathStat
    try {
      pathStat = await stat(resolvedPath)
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException
      if (error.code === 'ENOENT') {
        return NextResponse.json({ error: 'Path not found' }, { status: 404 })
      }
      if (error.code === 'EACCES') {
        return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
      }
      throw err
    }

    // If it's a file, redirect to read endpoint
    if (!pathStat.isDirectory()) {
      return NextResponse.json(
        {
          error: 'Not a directory',
          isFile: true,
          path: resolvedPath,
        },
        { status: 400 }
      )
    }

    // Read directory with permission handling
    let entries
    try {
      entries = await readdir(resolvedPath, { withFileTypes: true })
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException
      if (error.code === 'EACCES') {
        return NextResponse.json(
          { error: 'Permission denied - cannot read directory' },
          { status: 403 }
        )
      }
      throw err
    }

    const fileEntries: FileEntry[] = await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith('.')) // Hide hidden files
        .slice(0, 200) // Limit entries
        .map(async (entry) => {
          const fullPath = join(resolvedPath, entry.name)
          const entryStat = await stat(fullPath).catch(() => null)

          return {
            name: entry.name,
            path: fullPath,
            type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
            size: entryStat?.size || 0,
            modified: entryStat?.mtime.toISOString() || new Date().toISOString(),
          } as FileEntry
        })
    )

    // Sort: directories first, then alphabetically
    fileEntries.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1
      return a.name.localeCompare(b.name)
    })

    // Calculate parent path
    const parent = dirname(resolvedPath)
    const hasParent = ALLOWED_BASE_PATHS.some((base) => parent.startsWith(base) || parent === base)

    const listing: DirectoryListing = {
      path: resolvedPath,
      entries: fileEntries,
      parent: hasParent ? parent : null,
    }

    return NextResponse.json(listing)
  } catch (err) {
    log.error('Failed to browse directory:', {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Failed to browse directory' }, { status: 500 })
  }
}
