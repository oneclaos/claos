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
import { cn } from '@/lib/utils'
import { fetchWithCsrf, getCsrfToken } from '@/lib/csrf-client'
import { Plus, Trash2, Loader2, Server, ExternalLink } from 'lucide-react'
import type { Gateway } from '@/lib/types'

interface GatewayManagerProps {
  gateways: Gateway[]
  onRefresh: () => void
}

function validateGatewayUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return 'URL is required'
  if (!/^(ws|wss|http|https):\/\/.+/.test(trimmed)) {
    return 'URL must start with ws://, wss://, http://, or https://'
  }
  return null
}

export function GatewayManager({ gateways, onRefresh }: GatewayManagerProps) {
  const [showAdd, setShowAdd] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await getCsrfToken()
      const res = await fetchWithCsrf(`/api/gateways?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete gateway')
      }
      onRefresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete gateway')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      {/* Gateway rows with delete button for custom gateways */}
      <div className="space-y-3">
        {gateways.map((gateway) => (
          <div
            key={gateway.id}
            className="flex items-center justify-between p-4 rounded-lg border border-[var(--border)] bg-[var(--background)]"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full border border-[var(--color-border)]/50 flex items-center justify-center">
                <Server className={cn(
                  'w-5 h-5',
                  gateway.online ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'
                )} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-[var(--foreground)]">{gateway.name}</p>
                  {(gateway as Gateway & { custom?: boolean }).custom && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--primary-light)] text-[var(--primary)]">
                      custom
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--foreground-muted)] font-mono">{gateway.url ?? gateway.id}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Online indicator */}
              {gateway.online ? (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse" />
                  <span className="text-sm text-[var(--color-success)] font-medium">Online</span>
                </div>
              ) : (
                <span className="text-sm text-[var(--color-text-muted)] font-medium">Offline</span>
              )}

              {/* Delete button — only for custom gateways */}
              {(gateway as Gateway & { custom?: boolean }).custom && (
                <button
                  onClick={() => handleDelete(gateway.id)}
                  disabled={deletingId === gateway.id}
                  className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                  title="Remove gateway"
                >
                  {deletingId === gateway.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add Gateway button */}
      <div className="mt-4">
        <Button variant="outline" onClick={() => setShowAdd(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Gateway
        </Button>
      </div>

      {/* Add Gateway Modal */}
      <AddGatewayModal
        open={showAdd}
        onOpenChange={setShowAdd}
        onSuccess={() => {
          setShowAdd(false)
          onRefresh()
        }}
      />
    </>
  )
}

// ─── Add Gateway Modal ────────────────────────────────────────────────────────

interface AddGatewayModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

function AddGatewayModal({ open, onOpenChange, onSuccess }: AddGatewayModalProps) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [gatewayToken, setGatewayToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function resetForm() {
    setName('')
    setUrl('')
    setGatewayToken('')
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('Name is required')
      return
    }

    const urlError = validateGatewayUrl(url)
    if (urlError) {
      setError(urlError)
      return
    }

    setLoading(true)
    try {
      await getCsrfToken()
      const res = await fetchWithCsrf('/api/gateways', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: url.trim(), gatewayToken: gatewayToken.trim() || undefined })
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to add gateway')
        return
      }

      resetForm()
      onSuccess()
    } catch {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) resetForm(); onOpenChange(open) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Gateway</DialogTitle>
          <DialogDescription>
            Connect a remote Clawdbot gateway (VPS agent, remote machine, etc.)
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--foreground)]">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My VPS Agent"
              autoFocus
            />
          </div>

          {/* URL */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--foreground)]">URL</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="ws://my-vps.com:18789"
            />
            <p className="text-xs text-[var(--foreground-muted)] flex items-center gap-1">
              <ExternalLink className="w-3 h-3" />
              Accepted: ws://, wss://, http://, https://
            </p>
          </div>

          {/* Token (optional) */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--foreground)]">
              Token <span className="text-[var(--foreground-muted)] font-normal">(optional)</span>
            </label>
            <Input
              type="password"
              value={gatewayToken}
              onChange={(e) => setGatewayToken(e.target.value)}
              placeholder="Gateway auth token"
              autoComplete="off"
            />
          </div>

          {error && (
            <p className="text-sm text-[var(--error)] bg-[var(--error-light)] px-3 py-2 rounded-lg">
              {error}
            </p>
          )}
        </form>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !name.trim() || !url.trim()}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adding…
              </>
            ) : (
              'Add Gateway'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
