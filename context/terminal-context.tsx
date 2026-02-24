'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { fetchWithCsrf } from '@/lib/csrf-client'

export interface TerminalWindow {
  id: string
  sessionId: string
  name: string
  minimized: boolean
  dead: boolean
}

interface TerminalContextValue {
  windows: TerminalWindow[]
  creating: boolean
  createTerminal: () => Promise<void>
  closeTerminal: (windowId: string, sessionId: string) => Promise<void>
  markDead: (windowId: string) => void
  toggleMinimize: (windowId: string) => void
}

const TerminalContext = createContext<TerminalContextValue | null>(null)

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<TerminalWindow[]>([])
  const [creating, setCreating] = useState(false)

  const createTerminal = useCallback(async () => {
    setCreating(true)
    try {
      const res = await fetchWithCsrf('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      setWindows(prev => [...prev, {
        id: `term-${Date.now()}`,
        sessionId: data.sessionId,
        name: `Shell ${prev.length + 1}`,
        minimized: false,
        dead: false
      }])
    } finally {
      setCreating(false)
    }
  }, [])

  const closeTerminal = useCallback(async (windowId: string, sessionId: string) => {
    try {
      await fetchWithCsrf(`/api/terminal/${sessionId}`, { method: 'DELETE' })
    } catch {}
    setWindows(prev => prev.filter(w => w.id !== windowId))
  }, [])

  const markDead = useCallback((windowId: string) => {
    setWindows(prev => prev.map(w =>
      w.id === windowId ? { ...w, dead: true } : w
    ))
  }, [])

  const toggleMinimize = useCallback((windowId: string) => {
    setWindows(prev => prev.map(w =>
      w.id === windowId ? { ...w, minimized: !w.minimized } : w
    ))
  }, [])

  return (
    <TerminalContext.Provider value={{ windows, creating, createTerminal, closeTerminal, markDead, toggleMinimize }}>
      {children}
    </TerminalContext.Provider>
  )
}

export function useTerminals() {
  const ctx = useContext(TerminalContext)
  if (!ctx) throw new Error('useTerminals must be used within TerminalProvider')
  return ctx
}
