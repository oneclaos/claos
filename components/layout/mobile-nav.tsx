'use client'

import { useTabContext } from '@/context/tab-context'
import type { TabView } from '@/lib/tab-types'
import { MessageSquare, TerminalSquare, FolderOpen, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

// ─── Data ──────────────────────────────────────────────────────────────────────

interface MobileNavItem {
  view: TabView
  label: string
  icon: LucideIcon
}

const mobileNavItems: MobileNavItem[] = [
  { view: 'chat', label: 'Chat', icon: MessageSquare },
  { view: 'terminal', label: 'Terminal', icon: TerminalSquare },
  { view: 'files', label: 'Files', icon: FolderOpen },
  { view: 'status', label: 'Status', icon: Activity },
]

// ─── MobileNav ────────────────────────────────────────────────────────────────

export function MobileNav() {
  const { navigateActiveTab, openTab, activeTab, tabs } = useTabContext()
  const activeTabId = tabs.find(t => t.isActive)?.id ?? null
  const activeView = activeTab?.view ?? null

  const handleNav = (view: TabView) => {
    if (activeTabId) {
      navigateActiveTab(view)
    } else {
      openTab(view)
    }
  }

  return (
    <nav
      className="flex md:hidden fixed bottom-0 left-0 right-0 h-14 bg-white border-t border-[var(--color-border)] z-40"
      role="navigation"
      aria-label="Mobile navigation"
    >
      {mobileNavItems.map((item) => {
        const isActive = activeView === item.view
        return (
          <button
            key={item.view}
            onClick={() => handleNav(item.view)}
            aria-current={isActive ? 'page' : undefined}
            aria-label={item.label}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-1 transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset',
              isActive
                ? 'text-[var(--color-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            )}
          >
            <item.icon className="h-5 w-5 flex-shrink-0" />
            <span className="text-[10px] font-medium leading-none">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
