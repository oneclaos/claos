/**
 * @jest-environment jsdom
 */

import React from 'react'
import { renderHook, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { TabProvider, useTabContext } from '@/context/tab-context'
import { TAB_STORAGE_KEY, TAB_STORAGE_VERSION, createTab } from '@/lib/tab-types'

// ============================================
// Helpers
// ============================================

function wrapper({ children }: { children: React.ReactNode }) {
  return <TabProvider>{children}</TabProvider>
}

function renderTabContext() {
  return renderHook(() => useTabContext(), { wrapper })
}

// ============================================
// Setup
// ============================================

beforeEach(() => {
  localStorage.clear()
  // crypto.randomUUID is available in jsdom 16+, but let's polyfill if needed
  if (typeof crypto.randomUUID !== 'function') {
    let counter = 0
    jest.spyOn(crypto, 'randomUUID' as keyof Crypto).mockImplementation(
      () => `test-uuid-${++counter}` as `${string}-${string}-${string}-${string}-${string}`
    )
  }
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ============================================
// Tests
// ============================================

describe('TabContext', () => {
  describe('Initial state', () => {
    it('starts with one chat tab if no localStorage', async () => {
      const { result } = renderTabContext()

      // Wait for useEffect to run (localStorage init)
      await act(async () => {
        await new Promise(r => setTimeout(r, 50))
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].view).toBe('chat')
      expect(result.current.tabs[0].isActive).toBe(true)
      expect(result.current.activeTab).not.toBeNull()
    })

    it('restores tabs from valid localStorage', async () => {
      const savedTab = createTab({ view: 'chat', label: 'James', isActive: true })
      const storage = {
        version: TAB_STORAGE_VERSION,
        tabs: [savedTab],
        activeTabId: savedTab.id,
      }
      localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(storage))

      const { result } = renderTabContext()
      await act(async () => {
        await new Promise(r => setTimeout(r, 50))
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].view).toBe('chat')
      expect(result.current.tabs[0].label).toBe('James')
    })

    it('falls back to default if localStorage is corrupt', async () => {
      localStorage.setItem(TAB_STORAGE_KEY, 'not-valid-json{{{{')

      const { result } = renderTabContext()
      await act(async () => {
        await new Promise(r => setTimeout(r, 50))
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].view).toBe('chat')
    })

    it('falls back to default if localStorage schema is invalid', async () => {
      localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify({ version: 999, tabs: 'wrong' }))

      const { result } = renderTabContext()
      await act(async () => {
        await new Promise(r => setTimeout(r, 50))
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].view).toBe('chat')
    })
  })

  describe('openTab', () => {
    it('opens a new chat tab by default', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.openTab() })

      expect(result.current.tabs).toHaveLength(2)
      expect(result.current.tabs[1].view).toBe('chat')
    })

    it('opens a tab with specified view and label', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.openTab('chat', { label: 'James', sessionKey: 'sess-1' }) })

      const newTab = result.current.tabs[result.current.tabs.length - 1]
      expect(newTab.view).toBe('chat')
      expect(newTab.label).toBe('James')
      expect(newTab.sessionKey).toBe('sess-1')
    })

    it('new tab becomes active', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      let newTab: ReturnType<typeof result.current.openTab>
      act(() => { newTab = result.current.openTab('terminal') })

      expect(result.current.activeTab?.id).toBe(newTab!.id)
      expect(result.current.activeTab?.isActive).toBe(true)
    })

    it('previous tab becomes inactive when new tab opens', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      const firstId = result.current.tabs[0].id
      act(() => { result.current.openTab() })

      const first = result.current.tabs.find(t => t.id === firstId)
      expect(first?.isActive).toBe(false)
    })
  })

  describe('closeTab', () => {
    it('removes the tab', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.openTab() })
      expect(result.current.tabs).toHaveLength(2)

      const secondId = result.current.tabs[1].id
      act(() => { result.current.closeTab(secondId) })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs.find(t => t.id === secondId)).toBeUndefined()
    })

    it('activates neighbour when active tab is closed', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.openTab() })
      const [firstTab, secondTab] = result.current.tabs
      expect(result.current.activeTab?.id).toBe(secondTab.id)

      act(() => { result.current.closeTab(secondTab.id) })

      expect(result.current.activeTab?.id).toBe(firstTab.id)
    })

    it('leaves no tabs when last tab closed', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      const tabId = result.current.tabs[0].id
      act(() => { result.current.closeTab(tabId) })

      expect(result.current.tabs).toHaveLength(0)
      expect(result.current.activeTab).toBeNull()
    })

    it('does nothing when id not found', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.closeTab('non-existent-id') })
      expect(result.current.tabs).toHaveLength(1)
    })
  })

  describe('activateTab', () => {
    it('sets the tab as active', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.openTab() })
      const firstId = result.current.tabs[0].id

      act(() => { result.current.activateTab(firstId) })

      expect(result.current.activeTab?.id).toBe(firstId)
      expect(result.current.tabs[0].isActive).toBe(true)
      expect(result.current.tabs[1].isActive).toBe(false)
    })

    it('clears unread when activating', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.openTab() })
      const firstId = result.current.tabs[0].id

      // Mark first tab unread while second is active
      act(() => { result.current.markTabUnread(firstId, 3) })
      expect(result.current.tabs[0].hasUnread).toBe(true)

      // Activate first tab → should clear unread
      act(() => { result.current.activateTab(firstId) })
      expect(result.current.tabs[0].hasUnread).toBe(false)
      expect(result.current.tabs[0].unreadCount).toBe(0)
    })
  })

  describe('navigateActiveTab', () => {
    it('changes the view and label of the active tab', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.navigateActiveTab('files') })

      expect(result.current.activeTab?.view).toBe('files')
      expect(result.current.activeTab?.label).toBe('Files')
    })

    it('accepts custom label and sessionKey', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.navigateActiveTab('chat', { label: 'Max', sessionKey: 'sess-max' }) })

      expect(result.current.activeTab?.view).toBe('chat')
      expect(result.current.activeTab?.label).toBe('Max')
      expect(result.current.activeTab?.sessionKey).toBe('sess-max')
    })

    it('does not affect other tabs', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      const firstId = result.current.tabs[0].id
      act(() => { result.current.openTab('terminal') })

      // Activate first tab
      act(() => { result.current.activateTab(firstId) })

      // Navigate first tab → only first tab changes
      act(() => { result.current.navigateActiveTab('status') })

      expect(result.current.tabs[0].view).toBe('status')
      expect(result.current.tabs[1].view).toBe('terminal') // unchanged
    })
  })

  describe('reopenLastClosedTab', () => {
    it('restores the last closed tab', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.openTab('files', { label: 'My Files' }) })
      const filesTabId = result.current.tabs[1].id

      act(() => { result.current.closeTab(filesTabId) })
      expect(result.current.tabs).toHaveLength(1)

      act(() => { result.current.reopenLastClosedTab() })
      expect(result.current.tabs).toHaveLength(2)

      const restored = result.current.tabs[1]
      expect(restored.view).toBe('files')
      expect(restored.label).toBe('My Files')
      expect(restored.isActive).toBe(true)
    })

    it('does nothing if no closed tabs', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.reopenLastClosedTab() })
      expect(result.current.tabs).toHaveLength(1)
    })

    it('reopens in LIFO order', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.openTab('chat', { label: 'First' }) })
      act(() => { result.current.openTab('terminal', { label: 'Second' }) })
      // tabs: [empty, chat(First), terminal(Second)]

      act(() => { result.current.closeTab(result.current.tabs[1].id) }) // close chat
      act(() => { result.current.closeTab(result.current.tabs[result.current.tabs.length - 1].id) }) // close terminal

      act(() => { result.current.reopenLastClosedTab() })
      const lastRestored = result.current.tabs[result.current.tabs.length - 1]
      expect(lastRestored.view).toBe('terminal')
    })
  })

  describe('Tab cycling (goToNextTab / goToPrevTab)', () => {
    it('cycles to next tab', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.openTab() })
      act(() => { result.current.openTab() })
      // 3 tabs, last is active

      const [tab1] = result.current.tabs
      // Go prev to get to first
      act(() => { result.current.goToPrevTab() })
      act(() => { result.current.goToPrevTab() })
      expect(result.current.activeTab?.id).toBe(tab1.id)

      act(() => { result.current.goToNextTab() })
      expect(result.current.activeTab?.id).toBe(result.current.tabs[1].id)
    })

    it('wraps around to first from last', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.openTab() })
      // 2 tabs, second is active
      const firstId = result.current.tabs[0].id

      act(() => { result.current.goToNextTab() })
      expect(result.current.activeTab?.id).toBe(firstId)
    })

    it('wraps around to last from first', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.openTab() })
      const lastId = result.current.tabs[1].id

      // activate first
      act(() => { result.current.activateTab(result.current.tabs[0].id) })

      act(() => { result.current.goToPrevTab() })
      expect(result.current.activeTab?.id).toBe(lastId)
    })

    it('does nothing with a single tab', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      const id = result.current.tabs[0].id
      act(() => { result.current.goToNextTab() })
      expect(result.current.activeTab?.id).toBe(id)
    })
  })

  describe('Unread state', () => {
    it('markTabUnread sets hasUnread and increments count', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.openTab() })
      const firstId = result.current.tabs[0].id
      // second tab is active

      act(() => { result.current.markTabUnread(firstId) })
      expect(result.current.tabs[0].hasUnread).toBe(true)
      expect(result.current.tabs[0].unreadCount).toBe(1)

      act(() => { result.current.markTabUnread(firstId, 2) })
      expect(result.current.tabs[0].unreadCount).toBe(3)
    })

    it('does not mark active tab as unread', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      const activeId = result.current.activeTab!.id
      act(() => { result.current.markTabUnread(activeId) })

      expect(result.current.activeTab?.hasUnread).toBe(false)
      expect(result.current.activeTab?.unreadCount).toBe(0)
    })

    it('clearTabUnread resets the badge', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.openTab() })
      const firstId = result.current.tabs[0].id

      act(() => { result.current.markTabUnread(firstId, 5) })
      act(() => { result.current.clearTabUnread(firstId) })

      expect(result.current.tabs[0].hasUnread).toBe(false)
      expect(result.current.tabs[0].unreadCount).toBe(0)
    })
  })

  describe('Persistence', () => {
    it('persists tabs to localStorage', async () => {
      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      act(() => { result.current.openTab('chat', { label: 'James' }) })

      // Wait for debounced persist
      await act(async () => { await new Promise(r => setTimeout(r, 300)) })

      const raw = localStorage.getItem(TAB_STORAGE_KEY)
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw!)
      expect(parsed.version).toBe(TAB_STORAGE_VERSION)
      expect(parsed.tabs).toHaveLength(2)
      expect(parsed.tabs[1].label).toBe('James')
    })

    it('restores activeTabId correctly', async () => {
      const tab1 = createTab({ isActive: false, view: 'terminal', label: 'Terminal' })
      const tab2 = createTab({ isActive: true, view: 'files', label: 'Files' })
      const storage = {
        version: 1,
        tabs: [tab1, tab2],
        activeTabId: tab2.id,
      }
      localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(storage))

      const { result } = renderTabContext()
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })

      expect(result.current.activeTab?.id).toBe(tab2.id)
      expect(result.current.activeTab?.isActive).toBe(true)
      expect(result.current.tabs[0].isActive).toBe(false)
    })
  })
})
