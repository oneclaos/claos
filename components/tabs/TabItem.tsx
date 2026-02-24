'use client'

import React from 'react'
import { type Tab, TAB_ICONS } from '@/lib/tab-types'

interface TabItemProps {
  tab: Tab
  onActivate: (id: string) => void
  onClose: (id: string) => void
}

export function TabItem({ tab, onActivate, onClose }: TabItemProps) {
  const icon = TAB_ICONS[tab.view]

  return (
    <div
      role="tab"
      aria-selected={tab.isActive}
      onClick={() => onActivate(tab.id)}
      className={[
        'group relative flex items-center gap-1.5 h-[36px] px-3 min-w-0 max-w-[160px]',
        'cursor-pointer select-none flex-shrink-0',
        'border-r border-[var(--border)]',
        'transition-colors duration-100',
        tab.isActive
          ? 'bg-[var(--background)] text-[var(--foreground)] border-t-2 border-t-[var(--primary)]'
          : 'bg-[var(--background-secondary)] text-[var(--foreground-muted)] hover:bg-[var(--background-hover)] hover:text-[var(--foreground)]',
      ].join(' ')}
    >
      {/* Icon */}
      <span className="text-sm flex-shrink-0" aria-hidden="true">
        {icon}
      </span>

      {/* Label */}
      <span className="text-xs truncate flex-1 min-w-0">
        {tab.label}
      </span>

      {/* Unread badge */}
      {tab.hasUnread && tab.unreadCount > 0 && (
        <span
          className="flex-shrink-0 min-w-[16px] h-[16px] rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center px-1"
          aria-label={`${tab.unreadCount} unread`}
        >
          {tab.unreadCount > 99 ? '99+' : tab.unreadCount}
        </span>
      )}
      {tab.hasUnread && tab.unreadCount === 0 && (
        <span
          className="flex-shrink-0 w-2 h-2 rounded-full bg-orange-500"
          aria-label="unread"
        />
      )}

      {/* Close button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose(tab.id)
        }}
        className={[
          'flex-shrink-0 w-4 h-4 rounded flex items-center justify-center',
          'text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--background-hover)]',
          'opacity-0 group-hover:opacity-100 transition-opacity duration-100',
          tab.isActive ? 'opacity-100' : '',
        ].join(' ')}
        aria-label={`Close ${tab.label}`}
        tabIndex={-1}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}
