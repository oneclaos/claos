'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { gwDisplayName, gwPortLabel } from '@/lib/session-utils'
import type { Gateway } from '@/lib/types'

export function NewChatPanel({
  gateways,
  onSelectGateway,
  onCancel,
}: {
  gateways: Gateway[]
  onSelectGateway: (gw: Gateway) => void | Promise<void>
  onCancel: () => void
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const handleClick = async (gw: Gateway) => {
    setLoadingId(gw.id)
    await onSelectGateway(gw)
    setLoadingId(null)
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <Card className="w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-2">New Chat</h2>
        <p className="text-sm text-gray-500 mb-4">
          Select an agent (1 session per agent):
        </p>
        {gateways.length === 0 ? (
          <p className="text-red-500 text-sm">
            No agents found. Check gateway configuration.
          </p>
        ) : (
          <div className="space-y-2 mb-4">
            {gateways.map((gw) => (
              <button
                key={gw.id}
                onClick={() => handleClick(gw)}
                disabled={loadingId === gw.id}
                className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <div
                  className={cn(
                    'w-2 h-2 rounded-full flex-shrink-0',
                    gw.online ? 'bg-green-500' : 'bg-gray-300'
                  )}
                />
                <div className="flex-1 text-left">
                  <p className="font-medium text-sm">{gwDisplayName(gw)}</p>
                  {gwPortLabel(gw) && (
                    <p className="text-xs text-gray-400 font-mono">{gwPortLabel(gw)}</p>
                  )}
                </div>
                {loadingId === gw.id && (
                  <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
        <Button variant="outline" onClick={onCancel} className="w-full">
          Cancel
        </Button>
      </Card>
    </div>
  )
}
