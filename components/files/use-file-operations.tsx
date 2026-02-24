'use client'

import { useState, useCallback } from 'react'
import { useToast } from '@/components/ui/toast'
import { fetchWithCsrf } from '@/lib/csrf-client'
import type { FileEntry, DirectoryListing, FileContent } from '@/lib/types'

export function useFileOperations() {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch directory listing
  const fetchDirectory = useCallback(async (path: string): Promise<DirectoryListing | null> => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`)
      const data = await res.json()
      
      if (data.error) {
        throw new Error(data.error)
      }
      
      return data
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load directory'
      setError(errorMsg)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // Read file content
  const readFile = useCallback(async (path: string): Promise<FileContent | null> => {
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`)
      const data = await res.json()
      
      if (data.error) {
        throw new Error(data.error)
      }
      
      return data
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load file')
      return null
    }
  }, [toast])

  // Write file content
  const writeFile = useCallback(async (path: string, content: string): Promise<boolean> => {
    try {
      const res = await fetchWithCsrf('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content })
      })
      const data = await res.json()

      if (!res.ok || data.error) {
        throw new Error(data.error || `Server error: ${res.status}`)
      }

      toast.success('File saved')
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save file')
      return false
    }
  }, [toast])

  // Create file or folder
  const createEntry = useCallback(async (path: string, isDirectory: boolean): Promise<boolean> => {
    try {
      const res = await fetchWithCsrf('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, isDirectory })
      })
      const data = await res.json()

      if (data.error) {
        throw new Error(data.error)
      }

      toast.success(`${isDirectory ? 'Folder' : 'File'} created`)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create')
      return false
    }
  }, [toast])

  // Delete file or folder (with trash support)
  const deleteEntry = useCallback(async (
    path: string,
    trash: boolean = true
  ): Promise<{ success: boolean; trashPath?: string }> => {
    try {
      const res = await fetchWithCsrf(`/api/files/delete?path=${encodeURIComponent(path)}&trash=${trash}`, {
        method: 'DELETE'
      })
      
      const data = await res.json()

      if (!res.ok || data.error) {
        throw new Error(data.error || `Server error: ${res.status}`)
      }

      return { success: true, trashPath: data.trashPath }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
      return { success: false }
    }
  }, [toast])

  // Restore file from trash
  const restoreEntry = useCallback(async (originalPath: string, trashPath: string): Promise<boolean> => {
    try {
      const res = await fetchWithCsrf('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: originalPath,
          restore: true,
          trashPath
        })
      })
      const data = await res.json()
      
      if (data.error) {
        throw new Error(data.error)
      }

      toast.success('File restored')
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to restore')
      return false
    }
  }, [toast])

  // Move/rename file or folder
  const moveEntry = useCallback(async (source: string, destination: string): Promise<boolean> => {
    try {
      const res = await fetchWithCsrf('/api/files/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, destination, action: 'move' })
      })
      const data = await res.json()

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Move failed')
      }

      const basename = source.split('/').pop()
      const targetFolder = destination.split('/').slice(0, -1).pop()
      toast.success(`Moved "${basename}" to ${targetFolder}`)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to move file')
      return false
    }
  }, [toast])

  // Download file (opens in new tab)
  const downloadFile = useCallback((path: string) => {
    window.open(`/api/files/download?path=${encodeURIComponent(path)}`, '_blank')
  }, [])

  // Bulk delete multiple entries
  const bulkDelete = useCallback(async (paths: string[]): Promise<{ successCount: number; failCount: number }> => {
    let successCount = 0
    let failCount = 0

    for (const path of paths) {
      const result = await deleteEntry(path, true)
      if (result.success) {
        successCount++
      } else {
        failCount++
      }
    }

    if (failCount > 0) {
      toast.error(`Failed to delete ${failCount} item(s)`)
    } else {
      toast.success(`Deleted ${successCount} item(s)`)
    }

    return { successCount, failCount }
  }, [deleteEntry, toast])

  return {
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
  }
}
