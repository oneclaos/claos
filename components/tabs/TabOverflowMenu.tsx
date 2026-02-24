'use client'

import React, { useRef, useState, useEffect } from 'react'
import { type Tab, TAB_ICONS } from '@/lib/tab-types'

interface TabOverflowMenuProps {
  tabs: Tab[]
  onActivate: (id: string) => void
}

export function TabOverflowMenu({ tabs, onActivate }: TabOverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className={[
          'h-[36px] px-2 flex items-center gap-1',
          'text-[var(--foreground-muted)] hover:text-[var(--foreground)]',
          'hover:bg-[var(--background-hover)] transition-colors duration-100',
          'text-sm font-medium',
        ].join(' ')}
        aria-label="More tabs"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        ≡
        {tabs.some(t => t.hasUnread) && (
          <span className="w-2 h-2 rounded-full bg-orange-500" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className={[
            'absolute top-full right-0 z-50 mt-1',
            'bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg',
            'min-w-[200px] max-h-[400px] overflow-y-auto py-1',
          ].join(' ')}
        >
          {tabs.map(tab => (
            <button
              key={tab.id}
              role="option"
              aria-selected={tab.isActive}
              onClick={() => {
                onActivate(tab.id)
                setOpen(false)
              }}
              className={[
                'w-full flex items-center gap-2 px-3 py-2 text-left text-sm',
                'transition-colors duration-100',
                tab.isActive
                  ? 'bg-[var(--background-hover)] text-[var(--foreground)] font-medium'
                  : 'text-[var(--foreground-muted)] hover:bg-[var(--background-hover)] hover:text-[var(--foreground)]',
              ].join(' ')}
            >
              <span aria-hidden="true">{TAB_ICONS[tab.view]}</span>
              <span className="flex-1 truncate">{tab.label}</span>
              {tab.hasUnread && (
                <span className="flex-shrink-0 min-w-[16px] h-[16px] rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                  {tab.unreadCount > 99 ? '99+' : tab.unreadCount || ''}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
