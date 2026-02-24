'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, File, Folder, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================
// Create File/Folder Dialog
// ============================================

interface CreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPath: string
  onConfirm: (name: string, type: 'file' | 'directory') => Promise<void>
}

export function CreateFileDialog({ 
  open, 
  onOpenChange, 
  currentPath,
  onConfirm 
}: CreateDialogProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'file' | 'directory'>('file')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }

    // Validate name
    if (name.includes('/') || name.includes('\\')) {
      setError('Name cannot contain slashes')
      return
    }

    if (name.startsWith('.') && name.length === 1) {
      setError('Invalid name')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      await onConfirm(name.trim(), type)
      setName('')
      setType('file')
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    } finally {
      setIsCreating(false)
    }
  }

  const handleClose = () => {
    if (!isCreating) {
      setName('')
      setType('file')
      setError(null)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New</DialogTitle>
          <DialogDescription>
            Create a new file or folder in: {currentPath}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Type selection */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType('file')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors',
                type === 'file'
                  ? 'border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)]'
                  : 'border-[var(--border)] hover:border-[var(--primary)]/50'
              )}
            >
              <File className="w-5 h-5" />
              <span className="font-medium">File</span>
            </button>
            <button
              type="button"
              onClick={() => setType('directory')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors',
                type === 'directory'
                  ? 'border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)]'
                  : 'border-[var(--border)] hover:border-[var(--primary)]/50'
              )}
            >
              <Folder className="w-5 h-5" />
              <span className="font-medium">Folder</span>
            </button>
          </div>

          {/* Name input */}
          <div>
            <label className="text-sm font-medium text-[var(--foreground)]">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'file' ? 'example.txt' : 'new-folder'}
              className={cn('mt-1', error && 'border-red-500')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
              }}
            />
            {error && (
              <p className="text-sm text-red-500 mt-1">{error}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || isCreating}>
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              `Create ${type === 'file' ? 'File' : 'Folder'}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================
// Delete Confirmation Dialog
// ============================================

interface DeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemName: string
  itemType: 'file' | 'directory'
  onConfirm: () => Promise<void>
}

export function DeleteFileDialog({
  open,
  onOpenChange,
  itemName,
  itemType,
  onConfirm
}: DeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    setIsDeleting(true)
    setError(null)

    try {
      await onConfirm()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={isDeleting ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="w-5 h-5" />
            Delete {itemType === 'file' ? 'File' : 'Folder'}?
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{itemName}</strong>?
            {itemType === 'directory' && ' All contents will be deleted.'}
            <br /><br />
            <span className="text-[var(--foreground-muted)]">
              This action moves the item to trash and can be undone.
            </span>
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950 rounded-lg text-sm text-red-600">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}

        <DialogFooter>
          <Button 
            variant="ghost" 
            onClick={() => onOpenChange(false)} 
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button 
            variant="destructive" 
            onClick={handleDelete} 
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
