'use client'

import { useTabContext } from '@/context/tab-context'
import { WelcomeScreen } from '@/components/tabs/WelcomeScreen'
import { ChatSection } from '@/components/chat/ChatSection'
import { Sidebar } from '@/components/layout/sidebar'
import { Spinner } from '@/components/ui/spinner'
import type { Tab } from '@/lib/tab-types'
import TerminalSection from './terminal/page'
import FilesSection from './files/page'
import StatusSection from './status/page'
import SettingsSection from './settings/page'

// ─── TabInstance — one per tab, hidden when inactive ─────────────────────────
function TabInstance({ tab, isActive }: { tab: Tab; isActive: boolean }) {
  return (
    <div
      className="h-full"
      style={{ display: isActive ? 'flex' : 'none' }}
    >
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-hidden">
        {tab.view === 'chat' && <ChatSection />}
        {tab.view === 'terminal' && <TerminalSection />}
        {tab.view === 'files' && <FilesSection />}
        {tab.view === 'status' && <StatusSection />}
        {tab.view === 'settings' && <SettingsSection />}
        {tab.view === 'empty' && <WelcomeScreen />}
      </main>
    </div>
  )
}

// ─── Dashboard Hub ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { tabs, activeTab, openTab } = useTabContext()

  // Still initialising from localStorage — tabs array is empty during hydration
  if (tabs.length === 0) {
    return (
      <div className="flex-1 h-full flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  // All tabs closed — offer a way to open one (accessible even without TabBar on mobile)
  if (!activeTab) {
    return (
      <div className="flex-1 h-full flex items-center justify-center p-8">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-[oklch(0.70_0.20_46_/_0.08)] flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">⊕</span>
          </div>
          <p className="text-sm text-[var(--color-text-muted)] mb-4">No open tabs</p>
          <button
            onClick={() => openTab()}
            className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Open a tab
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full">
      {tabs.map(tab => (
        <TabInstance key={tab.id} tab={tab} isActive={tab.id === activeTab.id} />
      ))}
    </div>
  )
}
