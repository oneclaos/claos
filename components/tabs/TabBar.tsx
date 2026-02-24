'use client'

import React, { useRef } from 'react'
import { useTabContext } from '@/context/tab-context'
import { TabItem } from './TabItem'
import { TabOverflowMenu } from './TabOverflowMenu'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import Image from 'next/image'

const OVERFLOW_THRESHOLD = 10

export function TabBar() {
  const { tabs, openTab, closeTab, activateTab } = useTabContext()
  const scrollRef = useRef<HTMLDivElement>(null)

  const visibleTabs = tabs.slice(0, OVERFLOW_THRESHOLD)
  const overflowTabs = tabs.slice(OVERFLOW_THRESHOLD)
  const hasOverflow = overflowTabs.length > 0

  return (
    <div
      role="tablist"
      aria-label="Open tabs"
      className={[
        'hidden md:flex items-center',
        'h-[36px] w-full flex-shrink-0',
        'bg-[var(--background-secondary)] border-b border-[var(--border)]',
        'overflow-hidden',
      ].join(' ')}
    >
      {/* Logo */}
      <div className="flex-shrink-0 h-[36px] w-[40px] flex items-center justify-center border-r border-[var(--border)] px-1">
        <Image
          src="/logo.svg"
          alt="Logo"
          width={22}
          height={22}
          className="object-contain"
          priority
        />
      </div>

      {/* Scrollable tab list */}
      <div
        ref={scrollRef}
        className="flex items-center flex-1 min-w-0 overflow-x-auto scrollbar-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {visibleTabs.map(tab => (
          <TabItem
            key={tab.id}
            tab={tab}
            onActivate={activateTab}
            onClose={closeTab}
          />
        ))}
      </div>

      {/* Overflow menu (> 10 tabs) */}
      {hasOverflow && (
        <TabOverflowMenu tabs={overflowTabs} onActivate={activateTab} />
      )}

      {/* Notification bell */}
      <NotificationBell />

      {/* Add tab button */}
      <button
        onClick={() => openTab()}
        className={[
          'flex-shrink-0 h-[36px] w-[36px] flex items-center justify-center',
          'text-[var(--foreground-muted)] hover:text-[var(--foreground)]',
          'hover:bg-[var(--background-hover)] transition-colors duration-100',
          'border-l border-[var(--border)]',
          'text-lg',
        ].join(' ')}
        aria-label="Open new tab"
        title="New tab (Alt+T)"
      >
        +
      </button>
    </div>
  )
}
