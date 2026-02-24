'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@/components/ui/spinner'
import { ToastProvider } from '@/components/ui/toast'
import { TerminalProvider } from '@/context/terminal-context'
import { ChatProvider } from '@/context/chat-context'
import { TabProvider } from '@/context/tab-context'
import { TabBar } from '@/components/tabs/TabBar'
import { MobileNav } from '@/components/layout/mobile-nav'
import { ErrorBoundary } from '@/components/error-boundary'
import { useTabKeyboard } from '@/hooks/useTabKeyboard'
import { NotificationProvider } from '@/context/notification-context'
import { AgentUIControlProvider } from '@/context/agent-ui-control-context'
import { FloatingAgentButton } from '@/components/agent-ui-control/FloatingAgentButton'
import { AgentActivePill } from '@/components/agent-ui-control/AgentActivePill'

function DashboardInner({ children }: { children: React.ReactNode }) {
  useTabKeyboard()
  return (
    <div className="h-screen w-screen bg-[var(--background)] flex flex-col overflow-hidden">
      <TabBar />
      <div className="flex-1 min-h-0 overflow-hidden pb-14 md:pb-0">
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </div>
      <MobileNav />
      {/* Agent UI Control — rendered outside main flow so they persist across tabs */}
      <AgentActivePill />
      <FloatingAgentButton />
    </div>
  )
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/auth')
      .then(res => res.json())
      .then(data => {
        setAuthenticated(data.authenticated)
        if (!data.authenticated) {
          router.push('/login')
        }
      })
      .catch(() => router.push('/login'))
  }, [router])

  if (authenticated === null) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <p className="text-[var(--foreground-muted)] text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  if (!authenticated) {
    return null
  }

  return (
    <ToastProvider>
      <ChatProvider>
        <TerminalProvider>
          <TabProvider>
            <NotificationProvider>
              <AgentUIControlProvider>
                <DashboardInner>
                  {children}
                </DashboardInner>
              </AgentUIControlProvider>
            </NotificationProvider>
          </TabProvider>
        </TerminalProvider>
      </ChatProvider>
    </ToastProvider>
  )
}
