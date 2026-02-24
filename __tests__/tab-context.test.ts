/**
 * @jest-environment jsdom
 */

/**
 * Tests for TabContext logic — v3 (full-app-per-tab architecture)
 *
 * We test the pure state-management functions in isolation by
 * extracting and exercising the state transitions directly rather than
 * rendering the React provider.
 *
 * Key changes from v2:
 * - Tab has `section: TabSection | null` instead of `kind: TabKind`
 * - `openEmptyTab()` creates a blank tab (section: null)
 * - `navigateTab(section, config?)` navigates the ACTIVE tab
 * - No more singleton tab logic — multiple tabs can show the same section
 */

import {
  PersistedTabStateSchemaZod,
  PersistedTabStateSchemaV1Zod,
  PersistedTabStateSchemaV2Zod,
  LS_TABS_KEY,
  type Tab,
  type TabSection,
  type NavigateChatConfig,
  SECTION_LABELS,
} from '@/lib/tab-types'

// ── Helpers — mirrors the logic in tab-context.tsx ────────────────────────────

type TabState = {
  tabs: Tab[]
  activeTabId: string | null
  closedTabsHistory: Tab[]
}

let idCounter = 0
function makeId() {
  return `test-id-${++idCounter}`
}

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: makeId(),
    view: 'chat',
    section: 'chat',
    sessionKey: `session-${makeId()}`,
    gatewayId: 'gw-1',
    label: 'Test Session',
    isPinned: false,
    isActive: false,
    hasUnread: false,
    unreadCount: 0,
    openedAt: Date.now(),
    ...overrides,
  }
}

/** Pure version of openEmptyTab — opens a blank tab */
function openEmptyTab(state: TabState): TabState {
  const newTab: Tab = {
    id: makeId(),
    view: 'empty',
    label: 'New Tab',
    isPinned: false,
    isActive: true,
    hasUnread: false,
    unreadCount: 0,
    openedAt: Date.now(),
    section: null,
  }
  return {
    ...state,
    activeTabId: newTab.id,
    tabs: [...state.tabs.map((t) => ({ ...t, isActive: false })), newTab],
  }
}

/**
 * Pure version of navigateTab — navigate the active tab to a section.
 * If no active tab, creates a new one.
 */
function navigateTab(
  state: TabState,
  section: TabSection,
  chatConfig?: NavigateChatConfig
): TabState {
  const activeIdx = state.tabs.findIndex((t) => t.isActive)

  if (activeIdx === -1) {
    // No active tab → create a new one
    const newTab: Tab = {
      id: makeId(),
      view: section as Tab['view'],
      label:
        section === 'chat' ? (chatConfig?.label ?? SECTION_LABELS.chat) : SECTION_LABELS[section],
      isPinned: false,
      isActive: true,
      hasUnread: false,
      unreadCount: 0,
      openedAt: Date.now(),
      section,
      sessionKey: section === 'chat' ? chatConfig?.sessionKey : undefined,
      gatewayId: section === 'chat' ? chatConfig?.gatewayId : undefined,
    }
    return {
      ...state,
      activeTabId: newTab.id,
      tabs: [...state.tabs, newTab],
    }
  }

  const updated = [...state.tabs]
  const current = updated[activeIdx]
  const label =
    section === 'chat'
      ? (chatConfig?.label ?? current.label ?? SECTION_LABELS.chat)
      : SECTION_LABELS[section]

  updated[activeIdx] = {
    ...current,
    section,
    label,
    sessionKey:
      section === 'chat' ? (chatConfig?.sessionKey ?? current.sessionKey) : current.sessionKey,
    gatewayId:
      section === 'chat' ? (chatConfig?.gatewayId ?? current.gatewayId) : current.gatewayId,
    hasUnread: section === 'chat' && chatConfig ? false : current.hasUnread,
    unreadCount: section === 'chat' && chatConfig ? 0 : current.unreadCount,
  }
  return { ...state, tabs: updated }
}

/** Pure version of closeTab */
function closeTab(state: TabState, tabId: string): TabState {
  const idx = state.tabs.findIndex((t) => t.id === tabId)
  if (idx === -1) return state

  const closing = state.tabs[idx]
  if (closing.isPinned) return state

  const newHistory = [{ ...closing, isActive: false }, ...state.closedTabsHistory].slice(0, 10)
  const remaining = state.tabs.filter((t) => t.id !== tabId)

  if (remaining.length === 0) {
    return { ...state, tabs: remaining, activeTabId: null, closedTabsHistory: newHistory }
  }

  if (closing.isActive) {
    const neighborIdx = Math.min(idx, remaining.length - 1)
    return {
      ...state,
      closedTabsHistory: newHistory,
      activeTabId: remaining[neighborIdx].id,
      tabs: remaining.map((t, i) => ({
        ...t,
        isActive: i === neighborIdx,
        hasUnread: i === neighborIdx ? false : t.hasUnread,
        unreadCount: i === neighborIdx ? 0 : t.unreadCount,
      })),
    }
  }

  return { ...state, tabs: remaining, closedTabsHistory: newHistory }
}

/** Pure version of activateTab */
function activateTab(state: TabState, tabId: string): TabState {
  return {
    ...state,
    activeTabId: tabId,
    tabs: state.tabs.map((t) =>
      t.id === tabId
        ? { ...t, isActive: true, hasUnread: false, unreadCount: 0 }
        : { ...t, isActive: false }
    ),
  }
}

/** Pure version of markTabUnread */
function markTabUnread(state: TabState, sessionKey: string, pageVisible = true): TabState {
  return {
    ...state,
    tabs: state.tabs.map((t) => {
      if (t.section !== 'chat' || t.sessionKey !== sessionKey) return t
      if (t.isActive && pageVisible) return t
      return { ...t, hasUnread: true, unreadCount: t.unreadCount + 1 }
    }),
  }
}

/** Pure version of reopenLastClosed */
function reopenLastClosed(state: TabState): TabState {
  if (state.closedTabsHistory.length === 0) return state

  const [toReopen, ...remaining] = state.closedTabsHistory

  const reopened: Tab = {
    ...toReopen,
    id: makeId(),
    isActive: true,
    hasUnread: false,
    unreadCount: 0,
    openedAt: Date.now(),
  }

  return {
    ...state,
    closedTabsHistory: remaining,
    activeTabId: reopened.id,
    tabs: [...state.tabs.map((t) => ({ ...t, isActive: false })), reopened],
  }
}

function emptyState(): TabState {
  return { tabs: [], activeTabId: null, closedTabsHistory: [] }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TabContext — openEmptyTab', () => {
  it('creates a new empty tab with section: null', () => {
    const state = openEmptyTab(emptyState())
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].section).toBeNull()
    expect(state.tabs[0].label).toBe('New Tab')
    expect(state.tabs[0].isActive).toBe(true)
    expect(state.activeTabId).toBe(state.tabs[0].id)
  })

  it('always creates a new tab (no singleton — multiple empty tabs allowed)', () => {
    let state = openEmptyTab(emptyState())
    state = openEmptyTab(state)
    expect(state.tabs).toHaveLength(2)
    // The new one is active
    expect(state.tabs[1].isActive).toBe(true)
    expect(state.tabs[0].isActive).toBe(false)
  })

  it('deactivates all previous tabs when opening a new one', () => {
    let state = openEmptyTab(emptyState())
    const firstId = state.tabs[0].id
    state = openEmptyTab(state)
    expect(state.tabs.find((t) => t.id === firstId)?.isActive).toBe(false)
  })
})

describe('TabContext — navigateTab', () => {
  it('navigates the active tab to a new section', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'files')
    expect(state.tabs[0].section).toBe('files')
    expect(state.tabs[0].label).toBe('Files')
  })

  it('navigates to terminal and updates the label', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'terminal')
    expect(state.tabs[0].section).toBe('terminal')
    expect(state.tabs[0].label).toBe('Terminal')
  })

  it('navigates to chat with session config', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'chat', {
      sessionKey: 'sk-james',
      gatewayId: 'gw-1',
      label: 'James',
    })
    expect(state.tabs[0].section).toBe('chat')
    expect(state.tabs[0].sessionKey).toBe('sk-james')
    expect(state.tabs[0].label).toBe('James')
  })

  it('creates a new tab and navigates it if no tab is active', () => {
    const state = navigateTab(emptyState(), 'files')
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].section).toBe('files')
    expect(state.tabs[0].isActive).toBe(true)
  })

  it('only navigates the ACTIVE tab, not others', () => {
    let state = openEmptyTab(emptyState())
    state = openEmptyTab(state) // second tab is now active
    state = navigateTab(state, 'terminal')
    expect(state.tabs[0].section).toBeNull() // first tab unchanged
    expect(state.tabs[1].section).toBe('terminal') // second tab navigated
  })

  it('clears unread count when navigating to chat with config', () => {
    let state = openEmptyTab(emptyState())
    state = {
      ...state,
      tabs: state.tabs.map((t) => ({ ...t, hasUnread: true, unreadCount: 5 })),
    }
    state = navigateTab(state, 'chat', { sessionKey: 'sk-1', gatewayId: 'gw-1', label: 'Agent' })
    expect(state.tabs[0].hasUnread).toBe(false)
    expect(state.tabs[0].unreadCount).toBe(0)
  })
})

describe('TabContext — closeTab', () => {
  it('removes the tab from the list', () => {
    let state = openEmptyTab(emptyState())
    const tabId = state.tabs[0].id
    state = closeTab(state, tabId)
    expect(state.tabs).toHaveLength(0)
    expect(state.activeTabId).toBeNull()
  })

  it('activates the right neighbor when closing the active tab', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'chat', { sessionKey: 'sk-a', gatewayId: 'gw-1', label: 'A' })
    state = openEmptyTab(state)
    state = navigateTab(state, 'terminal')
    state = openEmptyTab(state)
    state = navigateTab(state, 'files')
    // Active = files tab (last opened). Close it → terminal should activate
    const activeId = state.activeTabId!
    state = closeTab(state, activeId)
    expect(state.tabs).toHaveLength(2)
    expect(state.tabs.find((t) => t.isActive)?.section).toBe('terminal')
  })

  it('activates left neighbor when closing the last tab', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'chat', { sessionKey: 'sk-a', gatewayId: 'gw-1', label: 'A' })
    state = openEmptyTab(state)
    state = navigateTab(state, 'terminal')
    // Active is terminal; close it → chat tab activates
    const activeId = state.activeTabId!
    state = closeTab(state, activeId)
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].section).toBe('chat')
    expect(state.tabs[0].isActive).toBe(true)
  })

  it('does not close pinned tabs', () => {
    let state = openEmptyTab(emptyState())
    state = { ...state, tabs: state.tabs.map((t) => ({ ...t, isPinned: true })) }
    const tabId = state.tabs[0].id
    state = closeTab(state, tabId)
    expect(state.tabs).toHaveLength(1)
  })

  it('pushes closed tab to closedTabsHistory', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'files')
    const tabId = state.tabs[0].id
    state = closeTab(state, tabId)
    expect(state.closedTabsHistory).toHaveLength(1)
    expect(state.closedTabsHistory[0].section).toBe('files')
  })

  it('caps closedTabsHistory at 10 entries', () => {
    let state = emptyState()
    // Open and close 15 tabs
    for (let i = 0; i < 15; i++) {
      state = openEmptyTab(state)
      state = closeTab(state, state.activeTabId!)
    }
    expect(state.closedTabsHistory).toHaveLength(10)
  })
})

describe('TabContext — activateTab', () => {
  it('marks the given tab as active and clears unread', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'chat', { sessionKey: 'sk-a', gatewayId: 'gw-1', label: 'A' })
    state = openEmptyTab(state)
    state = navigateTab(state, 'terminal')
    // Set unread on first tab
    const firstId = state.tabs[0].id
    state = {
      ...state,
      tabs: state.tabs.map((t) =>
        t.id === firstId ? { ...t, hasUnread: true, unreadCount: 3 } : t
      ),
    }
    state = activateTab(state, firstId)
    const first = state.tabs.find((t) => t.id === firstId)!
    expect(first.isActive).toBe(true)
    expect(first.hasUnread).toBe(false)
    expect(first.unreadCount).toBe(0)
  })

  it('deactivates all other tabs', () => {
    let state = openEmptyTab(emptyState())
    state = openEmptyTab(state)
    state = openEmptyTab(state)
    const firstId = state.tabs[0].id
    state = activateTab(state, firstId)
    const inactiveTabs = state.tabs.filter((t) => t.id !== firstId)
    inactiveTabs.forEach((t) => expect(t.isActive).toBe(false))
  })
})

describe('TabContext — reopenLastClosed', () => {
  it('restores the last closed tab', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'files')
    state = closeTab(state, state.activeTabId!)
    expect(state.tabs).toHaveLength(0)

    state = reopenLastClosed(state)
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].section).toBe('files')
    expect(state.tabs[0].isActive).toBe(true)
  })

  it('restores a closed chat tab with its session key', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'chat', { sessionKey: 'sk-x', gatewayId: 'gw-1', label: 'X' })
    state = closeTab(state, state.activeTabId!)
    state = reopenLastClosed(state)
    expect(state.tabs[0].section).toBe('chat')
    expect(state.tabs[0].sessionKey).toBe('sk-x')
    expect(state.tabs[0].isActive).toBe(true)
  })

  it('does nothing if history is empty', () => {
    const state = emptyState()
    const next = reopenLastClosed(state)
    expect(next.tabs).toHaveLength(0)
    expect(next.closedTabsHistory).toHaveLength(0)
  })

  it('removes the entry from history after reopening', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'terminal')
    state = closeTab(state, state.activeTabId!)
    state = reopenLastClosed(state)
    expect(state.closedTabsHistory).toHaveLength(0)
  })

  it('reopens multiple tabs in LIFO order (last closed = first reopened)', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'files') // tab1=files active
    state = openEmptyTab(state)
    state = navigateTab(state, 'status') // tab2=status active

    // Close status first (it's active)
    state = closeTab(state, state.activeTabId!) // history: [status]
    // tab1=files is now active; close it
    state = closeTab(state, state.activeTabId!) // history: [files, status]

    // LIFO: files was closed last → reopened first
    state = reopenLastClosed(state)
    expect(state.tabs[0].section).toBe('files')
    // Then status
    state = reopenLastClosed(state)
    expect(state.tabs.some((t) => t.section === 'status')).toBe(true)
  })
})

describe('TabContext — markTabUnread', () => {
  it('increments unread count on inactive chat tab', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'chat', { sessionKey: 'sk-a', gatewayId: 'gw-1', label: 'A' })
    state = openEmptyTab(state)
    state = navigateTab(state, 'terminal')
    // Mark sk-a as unread (it's inactive now)
    state = markTabUnread(state, 'sk-a', true)
    const aTab = state.tabs.find((t) => t.sessionKey === 'sk-a')!
    expect(aTab.hasUnread).toBe(true)
    expect(aTab.unreadCount).toBe(1)
  })

  it('does NOT mark unread if tab is active AND page is visible', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'chat', { sessionKey: 'sk-a', gatewayId: 'gw-1', label: 'A' })
    // sk-a is active
    state = markTabUnread(state, 'sk-a', /* pageVisible= */ true)
    const aTab = state.tabs.find((t) => t.sessionKey === 'sk-a')!
    expect(aTab.hasUnread).toBe(false)
    expect(aTab.unreadCount).toBe(0)
  })

  it('marks unread if tab is active but page is hidden', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'chat', { sessionKey: 'sk-a', gatewayId: 'gw-1', label: 'A' })
    state = markTabUnread(state, 'sk-a', /* pageVisible= */ false)
    const aTab = state.tabs.find((t) => t.sessionKey === 'sk-a')!
    expect(aTab.hasUnread).toBe(true)
    expect(aTab.unreadCount).toBe(1)
  })

  it('accumulates multiple unread counts', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'chat', { sessionKey: 'sk-a', gatewayId: 'gw-1', label: 'A' })
    state = openEmptyTab(state)
    state = navigateTab(state, 'terminal')
    // Mark sk-a unread 3 times
    state = markTabUnread(state, 'sk-a', true)
    state = markTabUnread(state, 'sk-a', true)
    state = markTabUnread(state, 'sk-a', true)
    const aTab = state.tabs.find((t) => t.sessionKey === 'sk-a')!
    expect(aTab.unreadCount).toBe(3)
  })

  it('does not mark non-chat tabs as unread via sessionKey', () => {
    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'terminal')
    state = markTabUnread(state, 'some-session-key', true)
    const t = state.tabs[0]
    expect(t.hasUnread).toBe(false)
    expect(t.unreadCount).toBe(0)
  })
})

describe('TabContext — localStorage persistence (v3)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('schema validates a well-formed v3 persisted state with section', () => {
    const valid = {
      version: 3,
      tabs: [
        {
          id: 'id-1',
          section: 'chat',
          sessionKey: 'session-1',
          gatewayId: 'gw-1',
          label: 'Agent',
          isPinned: false,
          isActive: true,
          hasUnread: false,
          unreadCount: 0,
          openedAt: 1700000000000,
        },
      ],
      activeTabId: 'id-1',
    }
    const result = PersistedTabStateSchemaZod.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('schema validates a terminal tab', () => {
    const valid = {
      version: 3,
      tabs: [
        {
          id: 'id-2',
          section: 'terminal',
          label: 'Terminal',
          isPinned: false,
          isActive: true,
          hasUnread: false,
          unreadCount: 0,
          openedAt: 1700000000000,
        },
      ],
      activeTabId: 'id-2',
    }
    const result = PersistedTabStateSchemaZod.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('schema validates an empty tab (section: null)', () => {
    const valid = {
      version: 3,
      tabs: [
        {
          id: 'id-3',
          section: null,
          label: 'New Tab',
          isPinned: false,
          isActive: true,
          hasUnread: false,
          unreadCount: 0,
          openedAt: 1700000000000,
        },
      ],
      activeTabId: 'id-3',
    }
    const result = PersistedTabStateSchemaZod.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('schema rejects corrupted data', () => {
    const corrupted = { version: 3, tabs: 'not-an-array' }
    const result = PersistedTabStateSchemaZod.safeParse(corrupted)
    expect(result.success).toBe(false)
  })

  it('schema rejects unknown version', () => {
    const wrong = { version: 99, tabs: [], activeTabId: null }
    const result = PersistedTabStateSchemaZod.safeParse(wrong)
    expect(result.success).toBe(false)
  })

  it('schema rejects v1 (old version)', () => {
    const v1 = { version: 1, tabs: [], activeTabId: null }
    const result = PersistedTabStateSchemaZod.safeParse(v1)
    expect(result.success).toBe(false)
  })

  it('schema rejects v2 (uses kind instead of section)', () => {
    const v2 = {
      version: 2,
      tabs: [
        {
          id: 'id-1',
          kind: 'chat',
          label: 'Agent',
          isPinned: false,
          isActive: true,
          hasUnread: false,
          unreadCount: 0,
          openedAt: 1700000000000,
        },
      ],
      activeTabId: 'id-1',
    }
    const result = PersistedTabStateSchemaZod.safeParse(v2)
    expect(result.success).toBe(false)
  })

  it('round-trips through JSON correctly', () => {
    const state: import('@/lib/tab-types').PersistedTabState = {
      version: 3,
      tabs: [
        {
          id: 'tab-1',
          section: 'chat',
          sessionKey: 'sk-1',
          gatewayId: 'gw-1',
          label: 'My Agent',
          isPinned: false,
          isActive: true,
          hasUnread: false,
          unreadCount: 0,
          openedAt: Date.now(),
        },
      ],
      activeTabId: 'tab-1',
    }

    localStorage.setItem(LS_TABS_KEY, JSON.stringify(state))
    const raw = localStorage.getItem(LS_TABS_KEY)!
    const parsed = PersistedTabStateSchemaZod.safeParse(JSON.parse(raw))
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.tabs[0].label).toBe('My Agent')
      expect(parsed.data.tabs[0].section).toBe('chat')
      expect(parsed.data.activeTabId).toBe('tab-1')
    }
  })
})

describe('TabContext — document.title', () => {
  it('computes expected title string with unread count', () => {
    const computeTitle = (tabs: Tab[]): string => {
      const total = tabs.reduce((s, t) => s + t.unreadCount, 0)
      return total > 0 ? `(${total}) Claos` : 'Claos'
    }

    let state = openEmptyTab(emptyState())
    state = navigateTab(state, 'chat', { sessionKey: 'sk-a', gatewayId: 'gw-1', label: 'A' })
    state = openEmptyTab(state)
    state = navigateTab(state, 'terminal')
    // Mark chat tab with 3 unread
    const chatTab = state.tabs[0]
    state = {
      ...state,
      tabs: state.tabs.map((t) => (t.id === chatTab.id ? { ...t, unreadCount: 3 } : t)),
    }
    expect(computeTitle(state.tabs)).toBe('(3) Claos')

    // Activate chat tab → clears unread
    state = activateTab(state, chatTab.id)
    expect(computeTitle(state.tabs)).toBe('Claos')
  })
})

describe('TabContext — v1 migration schema', () => {
  it('v1 schema is valid for a v1 payload', () => {
    const v1 = {
      version: 1,
      tabs: [
        {
          id: 'old-id',
          sessionKey: 'sk-old',
          gatewayId: 'gw-1',
          label: 'Old Agent',
          isPinned: false,
          isActive: true,
          hasUnread: false,
          unreadCount: 0,
          openedAt: Date.now(),
        },
      ],
      activeTabId: 'old-id',
    }
    const result = PersistedTabStateSchemaV1Zod.safeParse(v1)
    expect(result.success).toBe(true)
  })

  it('migrated v1 tab has section: chat', () => {
    const v1Tab = {
      id: 'old-id',
      sessionKey: 'sk-old',
      gatewayId: 'gw-1',
      label: 'Old Agent',
      isPinned: false,
      isActive: true,
      hasUnread: false,
      unreadCount: 0,
      openedAt: Date.now(),
    }
    const migratedTab = {
      ...v1Tab,
      section: 'chat' as const,
    }
    expect(migratedTab.section).toBe('chat')
    const result = PersistedTabStateSchemaZod.safeParse({
      version: 3,
      tabs: [migratedTab],
      activeTabId: 'old-id',
    })
    expect(result.success).toBe(true)
  })
})

describe('TabContext — v2 migration schema', () => {
  it('v2 schema is valid for a v2 payload (uses kind)', () => {
    const v2 = {
      version: 2,
      tabs: [
        {
          id: 'v2-id',
          kind: 'terminal',
          label: 'Terminal',
          isPinned: false,
          isActive: true,
          hasUnread: false,
          unreadCount: 0,
          openedAt: Date.now(),
        },
      ],
      activeTabId: 'v2-id',
    }
    const result = PersistedTabStateSchemaV2Zod.safeParse(v2)
    expect(result.success).toBe(true)
  })

  it('migrated v2 tab has section instead of kind', () => {
    const migratedTab = {
      id: 'v2-id',
      section: 'terminal' as const,
      label: 'Terminal',
      isPinned: false,
      isActive: true,
      hasUnread: false,
      unreadCount: 0,
      openedAt: Date.now(),
    }
    const result = PersistedTabStateSchemaZod.safeParse({
      version: 3,
      tabs: [migratedTab],
      activeTabId: 'v2-id',
    })
    expect(result.success).toBe(true)
  })
})
