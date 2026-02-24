'use client'

import { Bell, BellOff, BellRing } from 'lucide-react'
import { useNotifications } from '@/context/notification-context'

/**
 * NotificationBell — sits in the TabBar.
 *
 * States:
 *  - unknown / default  → 🔔 clickable, asks for permission on click
 *  - granted            → 🔔 green, non-clickable, tooltip "Notifications activées"
 *  - denied             → 🔕 red, non-clickable, tooltip "Notifications bloquées…"
 */
export function NotificationBell() {
  const { notificationPermission, requestPermission } = useNotifications()

  if (notificationPermission === 'granted') {
    return (
      <span
        title="Notifications activées"
        className={[
          'flex-shrink-0 h-[36px] w-[32px] flex items-center justify-center',
          'text-green-500',
          'border-l border-[var(--border)]',
        ].join(' ')}
        aria-label="Notifications activées"
      >
        <BellRing size={14} />
      </span>
    )
  }

  if (notificationPermission === 'denied') {
    return (
      <span
        title="Notifications bloquées — modifier dans les paramètres du navigateur"
        className={[
          'flex-shrink-0 h-[36px] w-[32px] flex items-center justify-center',
          'text-red-500',
          'border-l border-[var(--border)]',
        ].join(' ')}
        aria-label="Notifications bloquées"
      >
        <BellOff size={14} />
      </span>
    )
  }

  // 'default' or 'unknown' — show clickable bell
  return (
    <button
      onClick={() => requestPermission()}
      title="Activer les notifications"
      className={[
        'flex-shrink-0 h-[36px] w-[32px] flex items-center justify-center',
        'text-[var(--foreground-muted)] hover:text-[var(--foreground)]',
        'hover:bg-[var(--background-hover)] transition-colors duration-100',
        'border-l border-[var(--border)]',
      ].join(' ')}
      aria-label="Activer les notifications"
    >
      <Bell size={14} />
    </button>
  )
}
