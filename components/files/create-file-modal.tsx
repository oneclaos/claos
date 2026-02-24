'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FilePlus, FolderPlus } from 'lucide-react'

interface CreateFileModalProps {
  isOpen: boolean
  type: 'file' | 'folder'
  currentPath: string
  onClose: () => void
  onCreate: (name: string, isDirectory: boolean) => Promise<void>
}

export function CreateFileModal({
  isOpen,
  type,
  currentPath,
  onClose,
  onCreate,
}: CreateFileModalProps) {
  const [name, setName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  // Reset name when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('')
    }
  }, [isOpen])

  const handleCreate = async () => {
    if (!name.trim()) return

    setIsCreating(true)
    try {
      await onCreate(name.trim(), type === 'folder')
      onClose()
    } catch {
      // Error handling done in onCreate
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreate()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            {type === 'file' ? (
              <FilePlus className="h-6 w-6 text-[var(--primary)]" />
            ) : (
              <FolderPlus className="h-6 w-6 text-[var(--primary)]" />
            )}
            <DialogTitle>
              Create {type === 'file' ? 'File' : 'Folder'}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="mb-4">
          <label className="block text-sm font-medium text-[var(--foreground-muted)] mb-2">
            {type === 'file' ? 'File' : 'Folder'} name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={type === 'file' ? 'example.txt' : 'folder-name'}
            autoFocus
            className="w-full"
          />
          <p className="mt-2 text-xs text-[var(--foreground-muted)]">
            Will be created in: <span className="font-mono">{currentPath}</span>
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={isCreating}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || isCreating}
          >
            {isCreating ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
