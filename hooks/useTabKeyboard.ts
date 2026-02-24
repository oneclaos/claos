'use client'

import { useEffect } from 'react'
import { useTabContext } from '@/context/tab-context'

/**
 * Registers keyboard shortcuts for tab navigation.
 * Uses e.code (not e.key) for Mac compatibility.
 *
 * Shortcuts:
 *   Alt+T         → openTab()
 *   Alt+W         → closeTab(activeTabId)
 *   Alt+←         → goToPrevTab()
 *   Alt+→         → goToNextTab()
 *   Alt+Shift+T   → reopenLastClosedTab()
 *   Alt+1-9       → activateTab(tabs[n-1])
 */
export function useTabKeyboard(): void {
  if (typeof window === 'undefined') return // SSR guard at call-site

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { tabs, activeTab, openTab, closeTab, activateTab, goToPrevTab, goToNextTab, reopenLastClosedTab } =
    useTabContext()

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return
      // Skip keyboard shortcuts on mobile viewports (< 768px = md breakpoint)
      // The TabBar is hidden on mobile, so shortcuts are not relevant there.
      if (window.innerWidth < 768) return

      // Alt+T → new tab
      if (e.code === 'KeyT' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        openTab()
        return
      }

      // Alt+Shift+T → reopen last closed
      if (e.code === 'KeyT' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        reopenLastClosedTab()
        return
      }

      // Alt+W → close active tab
      if (e.code === 'KeyW' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        if (activeTab) closeTab(activeTab.id)
        return
      }

      // Alt+← → previous tab (cycle: first → last)
      if (e.code === 'ArrowLeft' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        goToPrevTab()
        return
      }

      // Alt+→ → next tab (cycle: last → first)
      if (e.code === 'ArrowRight' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        goToNextTab()
        return
      }

      // Alt+1-9 → activate tab by index (no-op if index out of range)
      const digitMatch = e.code.match(/^Digit([1-9])$/)
      if (digitMatch && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        const n = parseInt(digitMatch[1], 10)
        const target = tabs[n - 1]
        if (target) activateTab(target.id)
        return
      }
    }

    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [tabs, activeTab, openTab, closeTab, activateTab, goToPrevTab, goToNextTab, reopenLastClosedTab])
}
