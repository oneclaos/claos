'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { gwDisplayName, gwPortLabel } from '@/lib/session-utils'
import type { Gateway } from '@/lib/types'

export function NewGroupPanel({
  gateways,
  selectedGateways,
  onToggle,
  onCreate,
  onCancel,
}: {
  gateways: Gateway[]
  selectedGateways: Gateway[]
  onToggle: (gw: Gateway) => void
  onCreate: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <Card className="w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-2">New Group Session</h2>
        <p className="text-sm text-gray-500 mb-4">Select 2+ agents:</p>
        {gateways.length === 0 ? (
          <p className="text-red-500 text-sm">No agents found.</p>
        ) : (
          <div className="space-y-2 mb-4">
            {gateways.map((gw) => {
              const isSelected = !!selectedGateways.find((g) => g.id === gw.id)
              return (
                <button
                  key={gw.id}
                  onClick={() => onToggle(gw)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 rounded-lg border transition-colors',
                    isSelected ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50'
                  )}
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
                  {isSelected && <span className="text-blue-500 text-sm">✓</span>}
                </button>
              )
            })}
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={onCreate}
            className="flex-1"
            disabled={selectedGateways.length < 2}
          >
            Create Group
          </Button>
        </div>
      </Card>
    </div>
  )
}
