'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useAgentUIControl } from '@/context/agent-ui-control-context'
import { UI_RELAY, onUIRelay } from '@/lib/ui-relay-events'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { FileEntry, DirectoryListing, FileContent } from '@/lib/types'
import { useFileOperations } from '@/components/files/use-file-operations'
import { FileEditor } from '@/components/files/file-editor'
import { FileList } from '@/components/files/file-list'
import { CreateFileModal } from '@/components/files/create-file-modal'
import {
  Home,
  ChevronRight,
  RefreshCw,
  FilePlus,
  FolderPlus,
  Trash2,
  CheckSquare,
  Square,
} from 'lucide-react'

export function FilesView() {
  const toast = useToast()
  const { setFilesCurrentPath, pendingNavPath, setPendingNavPath } = useAgentUIControl()

  // File operations hook
  const {
    loading,
    error,
    fetchDirectory,
    readFile,
    writeFile,
    createEntry,
    deleteEntry,
    restoreEntry,
    moveEntry,
    downloadFile,
    bulkDelete,
  } = useFileOperations()

  // State
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [currentPath, setCurrentPath] = useState('/home')
  const [homePath, setHomePath] = useState('/home')
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null)
  const [fileContent, setFileContent] = useState<FileContent | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createType, setCreateType] = useState<'file' | 'folder'>('file')

  // Multi-select state
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // ── Stable refs for UI relay handlers ─────────────────────────────────────
  const listingRef = useRef(listing)
  const selectedFileRef = useRef(selectedFile)
  const fetchDirectoryRef = useRef<(path: string) => Promise<void>>(async () => {})
  const openFileRef = useRef<(file: FileEntry) => Promise<void>>(async () => {})
  const saveFileRef = useRef<(content: string) => Promise<void>>(async () => {})
  const setFileContentRef = useRef(setFileContent)

  // Update refs in effect (not during render)
  useEffect(() => {
    listingRef.current = listing
    selectedFileRef.current = selectedFile
  }, [listing, selectedFile])

  // ── Report currentPath to AgentUIControlContext ───────────────────────────
  useEffect(() => {
    setFilesCurrentPath(currentPath)
  }, [currentPath, setFilesCurrentPath])

  // Breadcrumb paths
  const breadcrumbs = currentPath
    .split('/')
    .filter(Boolean)
    .reduce<Array<{ name: string; path: string }>>((acc, part, i, arr) => {
      const path = '/' + arr.slice(0, i + 1).join('/')
      acc.push({ name: part, path })
      return acc
    }, [])

  // ── Navigate to directory ──────────────────────────────────────────────────
  const navigateTo = useCallback(
    async (path: string) => {
      const data = await fetchDirectory(path)
      if (data) {
        setListing(data)
        setCurrentPath(data.path)
        setSelectedFile(null)
        setFileContent(null)
        setSelectedPaths(new Set())
        setLastClickedIndex(null)
      }
    },
    [fetchDirectory]
  )

  // Initial load — fetch home path then navigate (runs once on mount)
  useEffect(() => {
    async function init() {
      // Fetch the default home path from server
      let defaultPath = '/home'
      try {
        const res = await fetch('/api/files/home')
        if (res.ok) {
          const data = await res.json()
          if (data.path) {
            defaultPath = data.path
            setHomePath(data.path)
          }
        }
      } catch {
        // Keep default /home
      }

      if (pendingNavPath) {
        navigateTo(pendingNavPath)
        setPendingNavPath(null)
      } else {
        navigateTo(defaultPath)
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Open file for preview/edit ─────────────────────────────────────────────
  const openFile = useCallback(
    async (file: FileEntry) => {
      if (file.type === 'directory') {
        navigateTo(file.path)
        return
      }

      setSelectedFile(file)
      setPreviewLoading(true)
      setPreviewError(null)

      const data = await readFile(file.path)
      setPreviewLoading(false)

      if (data) {
        setFileContent(data)
      } else {
        setPreviewError('Failed to load file')
      }
    },
    [navigateTo, readFile]
  )

  // ── Save file ──────────────────────────────────────────────────────────────
  const saveFile = useCallback(
    async (newContent: string) => {
      if (!selectedFile) return
      const success = await writeFile(selectedFile.path, newContent)
      if (success && fileContent) {
        setFileContent({ ...fileContent, content: newContent })
      }
    },
    [selectedFile, fileContent, writeFile]
  )

  // ── Delete single file ─────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (file: FileEntry) => {
      setIsDeleting(true)
      const result = await deleteEntry(file.path, true)
      setIsDeleting(false)

      if (result.success) {
        if (selectedFile?.path === file.path) {
          setSelectedFile(null)
          setFileContent(null)
        }

        navigateTo(currentPath)

        // Undo support
        if (result.trashPath) {
          toast.undo(
            `Deleted "${file.name}"`,
            async () => {
              const success = await restoreEntry(file.path, result.trashPath!)
              if (success) {
                navigateTo(currentPath)
              }
            },
            8000
          )
        }
      }
    },
    [currentPath, deleteEntry, navigateTo, restoreEntry, selectedFile, toast]
  )

  // ── Create file/folder ─────────────────────────────────────────────────────
  const handleCreate = useCallback(
    async (name: string, isDirectory: boolean) => {
      const newPath = `${currentPath}/${name}`
      const success = await createEntry(newPath, isDirectory)
      if (success) {
        setShowCreateModal(false)
        navigateTo(currentPath)
      }
    },
    [currentPath, createEntry, navigateTo]
  )

  // ── Multi-select handlers ──────────────────────────────────────────────────
  const toggleSelectMode = useCallback(() => {
    setIsSelectMode((prev) => !prev)
    setSelectedPaths(new Set())
    setLastClickedIndex(null)
  }, [])

  const handleEntrySelect = useCallback(
    (entry: FileEntry, index: number, e: React.MouseEvent) => {
      if (e.shiftKey && lastClickedIndex !== null && listing) {
        // Range select
        const entries = listing.entries
        const from = Math.min(lastClickedIndex, index)
        const to = Math.max(lastClickedIndex, index)
        setSelectedPaths((prev) => {
          const next = new Set(prev)
          for (let i = from; i <= to; i++) {
            next.add(entries[i].path)
          }
          return next
        })
      } else {
        // Toggle single
        setSelectedPaths((prev) => {
          const next = new Set(prev)
          if (next.has(entry.path)) {
            next.delete(entry.path)
          } else {
            next.add(entry.path)
          }
          return next
        })
        setLastClickedIndex(index)
      }
    },
    [lastClickedIndex, listing]
  )

  const handleBulkDelete = useCallback(async () => {
    if (selectedPaths.size === 0) return
    if (!confirm(`Delete ${selectedPaths.size} item(s)? This will move them to trash.`)) return

    setIsDeleting(true)
    await bulkDelete(Array.from(selectedPaths))
    setIsDeleting(false)
    setSelectedPaths(new Set())
    setIsSelectMode(false)
    navigateTo(currentPath)
  }, [selectedPaths, currentPath, bulkDelete, navigateTo])

  // ── Move file/folder ───────────────────────────────────────────────────────
  const handleMove = useCallback(
    async (source: string, destination: string) => {
      const success = await moveEntry(source, destination)
      if (success) {
        navigateTo(currentPath)
      }
    },
    [currentPath, moveEntry, navigateTo]
  )

  // ── Update function refs ───────────────────────────────────────────────────
  useEffect(() => {
    fetchDirectoryRef.current = navigateTo
    openFileRef.current = openFile
    saveFileRef.current = saveFile
  }, [navigateTo, openFile, saveFile])

  // ── UI Relay event listeners ───────────────────────────────────────────────
  useEffect(() => {
    const offNav = onUIRelay(UI_RELAY.FILES_NAVIGATE_PATH, ({ path }) => {
      fetchDirectoryRef.current(path)
    })

    const offSelect = onUIRelay(UI_RELAY.FILES_SELECT_FILE, ({ filename }) => {
      const entry = listingRef.current?.entries.find((f) => f.name === filename)
      if (entry) openFileRef.current(entry)
    })

    const offEdit = onUIRelay(UI_RELAY.FILES_CLICK_EDIT, () => {
      // Editor component handles editing state internally
    })

    const offContent = onUIRelay(UI_RELAY.FILES_SET_CONTENT, ({ content }) => {
      if (fileContent) {
        setFileContentRef.current({ ...fileContent, content })
      }
    })

    const offSave = onUIRelay(UI_RELAY.FILES_SAVE, () => {
      if (fileContent) {
        saveFileRef.current(fileContent.content)
      }
    })

    return () => {
      offNav()
      offSelect()
      offEdit()
      offContent()
      offSave()
    }
  }, [fileContent])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to exit select mode
      if (e.key === 'Escape' && isSelectMode) {
        setIsSelectMode(false)
        setSelectedPaths(new Set())
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSelectMode])

  return (
    <>
      <div className="p-8 h-full w-full flex flex-col overflow-hidden">
        <PageHeader
          title="File Manager"
          description="Browse and edit VPS files"
          actions={
            <div className="flex gap-2">
              <Button
                variant={isSelectMode ? 'default' : 'outline'}
                size="sm"
                onClick={toggleSelectMode}
              >
                {isSelectMode ? (
                  <>
                    <CheckSquare className="h-4 w-4" /> Done
                  </>
                ) : (
                  <>
                    <Square className="h-4 w-4" /> Select
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCreateType('file')
                  setShowCreateModal(true)
                }}
              >
                <FilePlus className="h-4 w-4" />
                New File
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCreateType('folder')
                  setShowCreateModal(true)
                }}
              >
                <FolderPlus className="h-4 w-4" />
                New Folder
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateTo(currentPath)}
                disabled={loading}
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </Button>
            </div>
          }
        />

        {/* Breadcrumb navigation */}
        <div className="mb-4 flex items-center gap-1 text-sm bg-white rounded-xl border border-[var(--border)] p-2 shadow-sm">
          <button
            onClick={() => navigateTo(homePath)}
            className="p-2 hover:bg-[var(--background-secondary)] rounded-lg text-[var(--foreground-muted)] hover:text-[var(--foreground-secondary)] transition-colors duration-200"
          >
            <Home className="h-4 w-4" />
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.path} className="flex items-center">
              <ChevronRight className="h-4 w-4 text-[oklch(0.75_0_0)]" />
              <button
                onClick={() => navigateTo(crumb.path)}
                className={cn(
                  'px-3 py-1.5 rounded-lg transition-colors duration-200',
                  i === breadcrumbs.length - 1
                    ? 'text-[var(--foreground)] font-medium bg-[var(--background-secondary)]'
                    : 'text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--background-secondary)]'
                )}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        {/* Multi-select action bar */}
        {selectedPaths.size > 0 && (
          <div className="mb-4 flex items-center gap-3 px-4 py-2 bg-blue-50 border border-blue-200 rounded-xl">
            <span className="text-sm font-medium text-blue-700">{selectedPaths.size} selected</span>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => setSelectedPaths(new Set())}>
              Clear
            </Button>
            <Button
              size="sm"
              onClick={handleBulkDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 text-white border-0"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete ({selectedPaths.size})
            </Button>
          </div>
        )}

        <div className="flex-1 flex gap-6 min-h-0">
          {/* File list */}
          <FileList
            listing={listing}
            loading={loading}
            error={error}
            selectedFile={selectedFile}
            isSelectMode={isSelectMode}
            selectedPaths={selectedPaths}
            onNavigate={navigateTo}
            onEntryClick={openFile}
            onEntrySelect={handleEntrySelect}
            onDelete={handleDelete}
            onMove={handleMove}
            onRetry={() => navigateTo(currentPath)}
          />

          {/* File editor/preview */}
          <FileEditor
            file={selectedFile}
            content={fileContent}
            loading={previewLoading}
            error={previewError}
            onSave={saveFile}
            onClose={() => {
              setSelectedFile(null)
              setFileContent(null)
            }}
            onDownload={(file) => downloadFile(file.path)}
          />
        </div>
      </div>

      {/* Create modal */}
      <CreateFileModal
        isOpen={showCreateModal}
        type={createType}
        currentPath={currentPath}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreate}
      />
    </>
  )
}
