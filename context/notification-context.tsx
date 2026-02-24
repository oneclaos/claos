'use client'

import { createContext, useContext, useCallback, useEffect, useState } from 'react'
import { useTabNotifications } from '@/hooks/useTabNotifications'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationContextValue {
  showNotification: (title: string, body: string, tabId: string) => void
  requestPermission: () => Promise<NotificationPermission>
  notificationPermission: NotificationPermission | 'unknown'
}

// ─── Context ──────────────────────────────────────────────────────────────────

const NotificationContext = createContext<NotificationContextValue>({
  showNotification: () => {},
  requestPermission: async () => 'default',
  notificationPermission: 'unknown',
})

// ─── Global ref (for use outside React components, e.g. hook callbacks) ──────

/**
 * Call this from non-component code (like async stream callbacks in useMessageSender).
 * It's wired up by NotificationProvider to call the real showNotification.
 */
export const notificationRef = {
  current: (_title: string, _body: string, _tabId: string) => {},
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { showNotification, requestPermission } = useTabNotifications()

  const [permission, setPermission] = useState<NotificationPermission | 'unknown'>('unknown')

  // Read the current browser permission on mount (client-side only)
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission)
    }
  }, [])

  // Keep the global ref in sync with the real showNotification
  useEffect(() => {
    notificationRef.current = showNotification
  }, [showNotification])

  const request = useCallback(async () => {
    const p = await requestPermission()
    setPermission(p)
    return p
  }, [requestPermission])

  return (
    <NotificationContext.Provider
      value={{
        showNotification,
        requestPermission: request,
        notificationPermission: permission,
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNotifications() {
  return useContext(NotificationContext)
}
