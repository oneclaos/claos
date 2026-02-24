'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/spinner'
import { formatFileSize } from '@/lib/utils'
import type { FileEntry, FileContent } from '@/lib/types'
import { Download, X, Save, Edit3 } from 'lucide-react'

interface FileEditorProps {
  file: FileEntry | null
  content: FileContent | null
  loading: boolean
  error: string | null
  onSave: (newContent: string) => Promise<void>
  onClose: () => void
  onDownload: (file: FileEntry) => void
}

export function FileEditor({
  file,
  content,
  loading,
  error,
  onSave,
  onClose,
  onDownload,
}: FileEditorProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)

  // Sync content when file changes
  useEffect(() => {
    if (content) {
      setEditedContent(content.content)
      setIsEditing(false)
      setHasUnsavedChanges(false)
    }
  }, [content])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (isEditing && hasUnsavedChanges) {
          handleSave()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEditing, hasUnsavedChanges, editedContent])

  const handleSave = async () => {
    setIsSaving(true)
    await onSave(editedContent)
    setIsSaving(false)
    setHasUnsavedChanges(false)
    setIsEditing(false)
  }

  const handleContentChange = (newContent: string) => {
    setEditedContent(newContent)
    setHasUnsavedChanges(true)
  }

  const handleClose = () => {
    if (hasUnsavedChanges) {
      if (!confirm('You have unsaved changes. Discard them?')) return
    }
    onClose()
  }

  if (!file) return null

  return (
    <Card className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-[var(--border)] flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[var(--foreground)] truncate">
            {file.name}
          </h3>
          <div className="flex gap-4 mt-1 text-xs text-[var(--foreground-muted)]">
            {file.size && <span>Size: {formatFileSize(file.size)}</span>}
            {file.permissions && <span>Permissions: {file.permissions}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          {!isEditing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(true)}
              >
                <Edit3 className="h-4 w-4" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDownload(file)}
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="default"
                size="sm"
                onClick={handleSave}
                disabled={!hasUnsavedChanges || isSaving}
              >
                <Save className="h-4 w-4" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (hasUnsavedChanges && !confirm('Discard unsaved changes?')) return
                  setIsEditing(false)
                  setEditedContent(content?.content || '')
                  setHasUnsavedChanges(false)
                }}
              >
                Cancel
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <CardContent className="flex-1 overflow-hidden p-0">
        {loading && <LoadingState message="Loading file..." />}
        
        {error && (
          <div className="p-8 text-center">
            <p className="text-red-500">{error}</p>
          </div>
        )}

        {!loading && !error && content && (
          <>
            {isEditing ? (
              <textarea
                ref={editorRef}
                value={editedContent}
                onChange={(e) => handleContentChange(e.target.value)}
                className="w-full h-full p-4 font-mono text-sm resize-none focus:outline-none bg-[var(--background)] text-[var(--foreground)]"
                spellCheck={false}
              />
            ) : (
              <div className="w-full h-full overflow-auto">
                <pre className="p-4 font-mono text-sm text-[var(--foreground)] whitespace-pre-wrap break-words">
                  {content.content}
                </pre>
              </div>
            )}
          </>
        )}
      </CardContent>

      {/* Unsaved changes indicator */}
      {hasUnsavedChanges && (
        <div className="flex-shrink-0 px-4 py-2 bg-amber-50 border-t border-amber-200 text-sm text-amber-700">
          You have unsaved changes. Press Cmd/Ctrl+S to save.
        </div>
      )}
    </Card>
  )
}
