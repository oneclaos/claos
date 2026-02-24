'use client'

import { useTabContext } from '@/context/tab-context'
import type { TabView } from '@/lib/tab-types'
import { MessageSquare, TerminalSquare, FolderOpen, Activity } from 'lucide-react'
import { type LucideIcon } from 'lucide-react'

interface Section {
  view: TabView
  label: string
  icon: LucideIcon
  description: string
}

const sections: Section[] = [
  {
    view: 'chat',
    label: 'Chat',
    icon: MessageSquare,
    description: 'Message your AI agents',
  },
  {
    view: 'terminal',
    label: 'Terminal',
    icon: TerminalSquare,
    description: 'Open a shell session',
  },
  {
    view: 'files',
    label: 'Files',
    icon: FolderOpen,
    description: 'Browse and manage files',
  },
  {
    view: 'status',
    label: 'Status',
    icon: Activity,
    description: 'Monitor gateways',
  },
]

export function WelcomeScreen() {
  const { navigateActiveTab } = useTabContext()

  return (
    <div className="flex-1 h-full flex items-center justify-center p-8">
      <div className="text-center max-w-lg w-full">
        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl bg-[oklch(0.70_0.20_46_/_0.08)] flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl">⊕</span>
        </div>

        {/* Title */}
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2">
          Choisissez une section
        </h2>
        <p className="text-sm text-[var(--color-text-muted)] mb-8">
          Sélectionnez une section pour commencer dans cet onglet
        </p>

        {/* Section grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sections.map((section) => (
            <button
              key={section.view}
              onClick={() => navigateActiveTab(section.view)}
              data-view={section.view}
              className="flex flex-col items-center gap-3 p-5 rounded-xl border border-[var(--color-border)] bg-white hover:bg-[var(--color-bg-hover)] hover:border-[var(--color-primary)] transition-all duration-150 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
            >
              <div className="w-10 h-10 rounded-lg bg-[oklch(0.70_0.20_46_/_0.08)] flex items-center justify-center group-hover:bg-[oklch(0.70_0.20_46_/_0.15)] transition-colors">
                <section.icon className="h-5 w-5 text-[var(--color-primary)]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {section.label}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  {section.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
