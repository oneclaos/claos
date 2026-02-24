'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  type Tab,
  type TabView,
  type TabStorage,
  TAB_STORAGE_KEY,
  TAB_STORAGE_VERSION,
  TAB_DEFAULT_LABELS,
  TabStorageSchema,
  createTab,
} from '@/lib/tab-types'

// ============================================
// Context Shape
// ============================================

interface TabContextValue {
  tabs: Tab[]
  activeTab: Tab | null
  openTab: (view?: TabView, opts?: { label?: string; sessionKey?: string; gatewayId?: string }) => Tab
  closeTab: (id: string) => void
  activateTab: (id: string) => void
  navigateActiveTab: (view: TabView, opts?: { label?: string; sessionKey?: string; gatewayId?: string }) => void
  reopenLastClosedTab: () => void
  goToNextTab: () => void
  goToPrevTab: () => void
  markTabUnread: (id: string, count?: number) => void
  clearTabUnread: (id: string) => void
}

const TabContext = createContext<TabContextValue | null>(null)

// ============================================
// Persistence helpers
// ============================================

function loadFromStorage(): TabStorage | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(TAB_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const result = TabStorageSchema.safeParse(parsed)
    if (!result.success) return null
    return result.data
  } catch {
    return null
  }
}

function saveToStorage(tabs: Tab[], activeTabId: string | null): void {
  if (typeof window === 'undefined') return
  try {
    const data: TabStorage = {
      version: TAB_STORAGE_VERSION,
      tabs,
      activeTabId,
    }
    localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Ignore storage errors (private mode, quota exceeded, etc.)
  }
}

function buildDefaultState(): { tabs: Tab[]; activeTabId: string } {
  const tab = createTab({ view: 'chat', label: 'Chat', isActive: true })
  return { tabs: [tab], activeTabId: tab.id }
}

// ============================================
// Provider
// ============================================

export function TabProvider({ children }: { children: React.ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const closedTabsRef = useRef<Tab[]>([]) // stack of recently closed tabs
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // -- Initialise from localStorage (client-side only) --
  useEffect(() => {
    const stored = loadFromStorage()
    if (stored && stored.tabs.length > 0) {
      // Re-mark which tab is active
      const restoredTabs = stored.tabs.map(t => ({
        ...t,
        isActive: t.id === stored.activeTabId,
      }))
      setTabs(restoredTabs)
      setActiveTabId(stored.activeTabId)
    } else {
      const { tabs: defaultTabs, activeTabId: defaultActiveId } = buildDefaultState()
      setTabs(defaultTabs)
      setActiveTabId(defaultActiveId)
    }
  }, [])

  // -- Persist on every change (debounced) --
  useEffect(() => {
    if (tabs.length === 0) return
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      saveToStorage(tabs, activeTabId)
    }, 200)
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    }
  }, [tabs, activeTabId])

  // ---- Helpers ----

  const activeTab = tabs.find(t => t.id === activeTabId) ?? null

  const setTabsWithActive = useCallback((updater: (prev: Tab[]) => Tab[], newActiveId?: string | null) => {
    setTabs(prev => {
      const next = updater(prev)
      // Sync isActive flag
      const resolvedActiveId = newActiveId !== undefined ? newActiveId : activeTabId
      return next.map(t => ({ ...t, isActive: t.id === resolvedActiveId }))
    })
    if (newActiveId !== undefined) {
      setActiveTabId(newActiveId)
    }
  }, [activeTabId])

  // ---- Public API ----

  const openTab = useCallback((
    view: TabView = 'chat',
    opts: { label?: string; sessionKey?: string; gatewayId?: string } = {}
  ): Tab => {
    const label = opts.label ?? TAB_DEFAULT_LABELS[view]
    const newTab = createTab({ view, label, sessionKey: opts.sessionKey, gatewayId: opts.gatewayId })
    setTabs(prev => {
      const next = prev.map(t => ({ ...t, isActive: false }))
      return [...next, { ...newTab, isActive: true }]
    })
    setActiveTabId(newTab.id)
    return newTab
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id)
      if (idx === -1) return prev

      // Memorise for reopening (bounded to last 10 to avoid memory leak)
      const closing = prev[idx]
      closedTabsRef.current.push(closing)
      if (closedTabsRef.current.length > 10) {
        closedTabsRef.current = closedTabsRef.current.slice(-10)
      }

      const remaining = prev.filter(t => t.id !== id)

      if (remaining.length === 0) {
        // No tabs left — keep empty state; caller can decide
        setActiveTabId(null)
        return []
      }

      // If we closed the active tab, activate neighbour
      let newActiveId = activeTabId
      if (activeTabId === id) {
        const newIdx = Math.min(idx, remaining.length - 1)
        newActiveId = remaining[newIdx].id
        setActiveTabId(newActiveId)
      }

      return remaining.map(t => ({ ...t, isActive: t.id === newActiveId }))
    })
  }, [activeTabId])

  const activateTab = useCallback((id: string) => {
    setTabs(prev => {
      const tab = prev.find(t => t.id === id)
      if (!tab) return prev
      return prev.map(t => ({
        ...t,
        isActive: t.id === id,
        // clear unread when activating
        hasUnread: t.id === id ? false : t.hasUnread,
        unreadCount: t.id === id ? 0 : t.unreadCount,
      }))
    })
    setActiveTabId(id)
  }, [])

  const navigateActiveTab = useCallback((
    view: TabView,
    opts: { label?: string; sessionKey?: string; gatewayId?: string } = {}
  ) => {
    if (!activeTabId) return
    const label = opts.label ?? TAB_DEFAULT_LABELS[view]
    setTabs(prev => prev.map(t =>
      t.id === activeTabId
        ? { ...t, view, label, sessionKey: opts.sessionKey, gatewayId: opts.gatewayId }
        : t
    ))
  }, [activeTabId])

  const reopenLastClosedTab = useCallback(() => {
    const last = closedTabsRef.current.pop()
    if (!last) return
    const restored: Tab = { ...last, id: crypto.randomUUID(), isActive: true, openedAt: Date.now() }
    setTabs(prev => {
      const next = prev.map(t => ({ ...t, isActive: false }))
      return [...next, restored]
    })
    setActiveTabId(restored.id)
  }, [])

  const goToNextTab = useCallback(() => {
    setTabs(prev => {
      if (prev.length <= 1) return prev
      const idx = prev.findIndex(t => t.isActive)
      const nextIdx = (idx + 1) % prev.length
      const nextId = prev[nextIdx].id
      setActiveTabId(nextId)
      return prev.map(t => ({ ...t, isActive: t.id === nextId }))
    })
  }, [])

  const goToPrevTab = useCallback(() => {
    setTabs(prev => {
      if (prev.length <= 1) return prev
      const idx = prev.findIndex(t => t.isActive)
      const prevIdx = (idx - 1 + prev.length) % prev.length
      const prevId = prev[prevIdx].id
      setActiveTabId(prevId)
      return prev.map(t => ({ ...t, isActive: t.id === prevId }))
    })
  }, [])

  const markTabUnread = useCallback((id: string, count = 1) => {
    if (id === activeTabId) return // Don't mark active tab as unread
    setTabs(prev => prev.map(t =>
      t.id === id
        ? { ...t, hasUnread: true, unreadCount: t.unreadCount + count }
        : t
    ))
  }, [activeTabId])

  const clearTabUnread = useCallback((id: string) => {
    setTabs(prev => prev.map(t =>
      t.id === id
        ? { ...t, hasUnread: false, unreadCount: 0 }
        : t
    ))
  }, [])

  // suppress the void from setTabsWithActive in the deps
  void setTabsWithActive

  const value: TabContextValue = {
    tabs,
    activeTab,
    openTab,
    closeTab,
    activateTab,
    navigateActiveTab,
    reopenLastClosedTab,
    goToNextTab,
    goToPrevTab,
    markTabUnread,
    clearTabUnread,
  }

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>
}

// ============================================
// Hook
// ============================================

export function useTabContext(): TabContextValue {
  const ctx = useContext(TabContext)
  if (!ctx) throw new Error('useTabContext must be used within a TabProvider')
  return ctx
}
