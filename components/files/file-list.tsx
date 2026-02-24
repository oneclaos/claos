'use client'

import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/spinner'
import { formatFileSize, formatRelativeTime, cn } from '@/lib/utils'
import type { FileEntry, DirectoryListing } from '@/lib/types'
import {
  Folder,
  File,
  FileText,
  FileCode,
  ChevronUp,
  Trash2,
  CheckSquare,
  Square,
} from 'lucide-react'

// Icon mapping by extension
const getFileIcon = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase()
  const codeExts = ['js', 'ts', 'jsx', 'tsx', 'py', 'sh', 'json', 'yaml', 'yml', 'css', 'html']
  const textExts = ['txt', 'md', 'log', 'env', 'gitignore', 'conf', 'ini', 'cfg']

  if (codeExts.includes(ext || '')) return FileCode
  if (textExts.includes(ext || '')) return FileText
  return File
}

interface FileListProps {
  listing: DirectoryListing | null
  loading: boolean
  error: string | null
  selectedFile: FileEntry | null
  isSelectMode: boolean
  selectedPaths: Set<string>
  onNavigate: (path: string) => void
  onEntryClick: (entry: FileEntry) => void
  onEntrySelect: (entry: FileEntry, index: number, e: React.MouseEvent) => void
  onDelete: (entry: FileEntry) => void
  onMove: (source: string, destination: string) => void
  onRetry: () => void
}

export function FileList({
  listing,
  loading,
  error,
  selectedFile,
  isSelectMode,
  selectedPaths,
  onNavigate,
  onEntryClick,
  onEntrySelect,
  onDelete,
  onMove,
  onRetry,
}: FileListProps) {
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // ── Drag & Drop handlers ────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, sourcePath: string) => {
    e.dataTransfer.setData('text/plain', sourcePath)
    e.dataTransfer.effectAllowed = 'move'
    setIsDragging(true)
  }, [])

  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
    setDragOverPath(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, folderPath: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverPath(folderPath)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverPath(null)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetFolderPath: string) => {
      e.preventDefault()
      setDragOverPath(null)
      setIsDragging(false)

      const sourcePath = e.dataTransfer.getData('text/plain')
      if (!sourcePath || sourcePath === targetFolderPath) return

      // Prevent dropping into own subdirectory
      if (targetFolderPath.startsWith(sourcePath + '/')) {
        alert('Cannot move a folder into itself')
        return
      }

      const basename = sourcePath.split('/').pop()
      if (!basename) return
      const destination = `${targetFolderPath}/${basename}`

      onMove(sourcePath, destination)
    },
    [onMove]
  )

  return (
    <Card className="w-96 flex flex-col overflow-hidden">
      <CardContent className="flex-1 overflow-y-auto p-0">
        {loading && <LoadingState message="Loading directory..." />}
        {error && <ErrorState message={error} onRetry={onRetry} />}

        {!loading && !error && listing && (
          <>
            {/* Parent directory */}
            {listing.parent && (
              <button
                onClick={() => onNavigate(listing.parent!)}
                className="w-full p-4 text-left border-b border-[var(--border)] hover:bg-[var(--background)] transition-colors duration-200 flex items-center gap-3"
              >
                <ChevronUp className="h-5 w-5 text-[var(--foreground-muted)]" />
                <span className="text-[var(--foreground-muted)]">..</span>
              </button>
            )}

            {/* Empty state */}
            {listing.entries.length === 0 && (
              <EmptyState
                icon="📂"
                title="Empty directory"
                description="No files in this directory"
              />
            )}

            {/* File entries */}
            {listing.entries.map((entry, index) => {
              const Icon = entry.type === 'directory' ? Folder : getFileIcon(entry.name)
              const isFileSelected = selectedFile?.path === entry.path
              const isChecked = selectedPaths.has(entry.path)
              const isDropTarget = dragOverPath === entry.path && entry.type === 'directory'

              return (
                <div
                  key={entry.path}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, entry.path)}
                  onDragEnd={handleDragEnd}
                  onDragOver={entry.type === 'directory' ? (e) => handleDragOver(e, entry.path) : undefined}
                  onDragLeave={entry.type === 'directory' ? handleDragLeave : undefined}
                  onDrop={entry.type === 'directory' ? (e) => handleDrop(e, entry.path) : undefined}
                  className={cn(
                    'group w-full p-4 text-left border-b border-[var(--border)] flex items-center gap-3 transition-all duration-150',
                    isFileSelected && !isSelectMode && 'bg-[oklch(0.92_0.06_55)]',
                    isChecked && 'bg-blue-50',
                    isDropTarget && 'bg-blue-100 border-2 border-blue-400 border-dashed',
                    isDragging && entry.type === 'directory' && 'hover:bg-blue-50',
                    'hover:bg-[var(--background)]'
                  )}
                >
                  {/* Checkbox in select mode */}
                  {isSelectMode && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onEntrySelect(entry, index, e)
                      }}
                      className="flex-shrink-0"
                    >
                      {isChecked ? (
                        <CheckSquare className="h-5 w-5 text-blue-600" />
                      ) : (
                        <Square className="h-5 w-5 text-gray-300 hover:text-gray-500" />
                      )}
                    </button>
                  )}

                  <button
                    onClick={(e) =>
                      isSelectMode ? onEntrySelect(entry, index, e) : onEntryClick(entry)
                    }
                    className="flex-1 flex items-center gap-3 min-w-0"
                  >
                    <Icon
                      className={cn(
                        'h-5 w-5 flex-shrink-0',
                        entry.type === 'directory'
                          ? 'text-[var(--primary)]'
                          : 'text-[var(--foreground-muted)]'
                      )}
                    />
                    <div className="flex-1 min-w-0 text-left">
                      <div className="truncate font-medium text-[var(--foreground)]">
                        {entry.name}
                      </div>
                      <div className="flex gap-2 text-xs text-[var(--foreground-muted)]">
                        {entry.size !== undefined && <span>{formatFileSize(entry.size)}</span>}
                        {entry.modified && <span>{formatRelativeTime(entry.modified)}</span>}
                      </div>
                    </div>
                  </button>

                  {/* Delete button (not in select mode) */}
                  {!isSelectMode && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(`Delete "${entry.name}"? This will move it to trash.`)) {
                          onDelete(entry)
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  )}
                </div>
              )
            })}
          </>
        )}
      </CardContent>
    </Card>
  )
}
