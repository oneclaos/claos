'use client'

import { useCallback, useEffect } from 'react'
import { useTabContext } from '@/context/tab-context'

// ─── Helpers (SSR-safe) ───────────────────────────────────────────────────────

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function hasNotificationAPI(): boolean {
  return isBrowser() && 'Notification' in window
}

// ─── Favicon Badge ────────────────────────────────────────────────────────────

function setFaviconBadge(count: number) {
  if (!isBrowser()) return
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const img = new window.Image()
  img.onload = () => {
    ctx.clearRect(0, 0, 32, 32)
    ctx.drawImage(img, 0, 0, 32, 32)
    if (count > 0) {
      // Red badge dot
      ctx.beginPath()
      ctx.arc(24, 8, 8, 0, 2 * Math.PI)
      ctx.fillStyle = '#ef4444'
      ctx.fill()
      if (count <= 99) {
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 10px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(count > 9 ? '9+' : String(count), 24, 8)
      }
    }

    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = canvas.toDataURL('image/png')
  }
  img.src = '/icon-32.png'
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseTabNotificationsReturn {
  /** Request browser Notification permission (once — stored in localStorage). */
  requestPermission: () => Promise<NotificationPermission>
  /** Show a browser notification. Clicking it focuses the window and activates the tab. */
  showNotification: (title: string, body: string, tabId: string) => void
  /** Mark a tab as having unread messages. No-op if tabId is the active tab. */
  markUnread: (tabId: string, count?: number) => void
}

export function useTabNotifications(): UseTabNotificationsReturn {
  const { activateTab, markTabUnread } = useTabContext()

  // ── Page title + favicon badge: update based on total unread count ──────
  const { tabs } = useTabContext()
  useEffect(() => {
    if (!isBrowser()) return
    const totalUnread = tabs.reduce((sum, t) => sum + t.unreadCount, 0)
    document.title = totalUnread > 0 ? `(${totalUnread}) Claos` : 'Claos'
    setFaviconBadge(totalUnread)
  }, [tabs])

  // ── visibilitychange: reset title + favicon badge when tab becomes visible ──
  useEffect(() => {
    if (!isBrowser()) return
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        document.title = 'Claos'
        setFaviconBadge(0)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  // ── requestPermission ────────────────────────────────────────────────────
  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!hasNotificationAPI()) return 'denied'
    // Only call requestPermission when it can still change (not already granted/denied).
    // This should always be triggered by a user gesture (bell button click).
    if (Notification.permission !== 'default') {
      return Notification.permission
    }
    const permission = await Notification.requestPermission()
    return permission
  }, [])

  // ── showNotification ────────────────────────────────────────────────────
  const showNotification = useCallback(
    (title: string, body: string, tabId: string) => {
      if (!hasNotificationAPI()) return
      if (Notification.permission !== 'granted') return
      if (isBrowser() && document.hasFocus()) return // window is active, skip

      // Tag = tabId to avoid spam (replaces previous notif for same tab)
      const notif = new Notification(title, {
        body,
        tag: tabId,
        icon: '/icon-192.png',
        requireInteraction: false,
      })

      notif.onclick = () => {
        window.focus()
        activateTab(tabId)
        notif.close()
      }

      // Auto-dismiss after 5s
      setTimeout(() => notif.close(), 5000)
    },
    [activateTab]
  )

  // ── markUnread ───────────────────────────────────────────────────────────
  const markUnread = useCallback(
    (tabId: string, count = 1) => {
      markTabUnread(tabId, count)
    },
    [markTabUnread]
  )

  return { requestPermission, showNotification, markUnread }
}
