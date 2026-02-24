'use client'

/**
 * TerminalView — Shell sessions on the VPS.
 *
 * Used both in:
 * - app/(dashboard)/terminal/page.tsx  (direct URL access)
 * - app/(dashboard)/page.tsx           (tab kind === 'terminal')
 */

import dynamic from 'next/dynamic'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { useTerminals } from '@/context/terminal-context'
import { Plus, X, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const Terminal = dynamic(
  () => import('@/components/terminal/terminal').then(mod => ({ default: mod.Terminal })),
  { ssr: false, loading: () => <LoadingState message="Loading..." /> }
)

export function TerminalView() {
  const toast = useToast()
  const { windows, creating, createTerminal, closeTerminal, markDead, toggleMinimize } = useTerminals()

  const handleCreate = async () => {
    try {
      await createTerminal()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create shell')
    }
  }

  return (
    <div className="p-6 h-full flex flex-col overflow-y-auto">
      <PageHeader
        title="Shell"
        description="Open shell sessions on your machine"
        actions={
          <Button
            onClick={handleCreate}
            disabled={creating}
          >
            <Plus className="h-4 w-4 mr-2" />
            {creating ? 'Opening...' : 'New Shell'}
          </Button>
        }
      />

      {windows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <span className="text-4xl">💻</span>
            </div>
            <h3 className="text-xl font-semibold mb-2">No shells open</h3>
            <p className="text-gray-500 mb-6">Click &quot;New Shell&quot; to open a session</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid gap-4 auto-rows-min" style={{
          gridTemplateColumns: `repeat(${Math.min(windows.length, 3)}, 1fr)`
        }}>
          {windows.map(win => (
            <div
              key={win.id}
              className={cn(
                'bg-[#1a1b26] rounded-xl overflow-hidden flex flex-col shadow-lg border',
                win.dead ? 'border-red-500' : 'border-gray-700',
                win.minimized ? 'h-12' : 'h-[300px]'
              )}
            >
              <div className={cn(
                'flex items-center justify-between px-3 py-2 border-b',
                win.dead ? 'bg-red-900/50 border-red-700' : 'bg-[#24283b] border-gray-700'
              )}>
                <div className="flex items-center gap-2">
                  <span className="text-sm">{win.dead ? '⚠️' : '💻'}</span>
                  <span className="text-sm text-gray-300 font-medium">
                    {win.name} {win.dead && '(expired)'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleMinimize(win.id)}
                    className="p-1 hover:bg-gray-600 rounded text-gray-400 hover:text-white"
                  >
                    {win.minimized ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => closeTerminal(win.id, win.sessionId)}
                    className="p-1 hover:bg-red-600 rounded text-gray-400 hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {!win.minimized && (
                <div className="flex-1 min-h-0">
                  <Terminal
                    sessionId={win.sessionId}
                    onClose={() => closeTerminal(win.id, win.sessionId)}
                    onSessionDead={() => markDead(win.id)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
