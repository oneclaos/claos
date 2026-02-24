'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { GatewayManager } from '@/components/gateways/gateway-manager'
import type { Gateway } from '@/lib/types'
import { 
  Activity,
  RefreshCw,
  Wifi,
  MessageSquare
} from 'lucide-react'

interface StatusStats {
  gateways: Gateway[]
  totalSessions: number
}

export function StatusView() {
  const [stats, setStats] = useState<StatusStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchStats = useCallback(async () => {
    // Fetch gateways first (fast) — show immediately
    try {
      const gatewaysRes = await fetch('/api/gateways', { signal: AbortSignal.timeout(8000) })
      const gatewaysData = await gatewaysRes.json()
      setStats(prev => ({
        gateways: gatewaysData.gateways || [],
        totalSessions: prev?.totalSessions ?? 0,
      }))
    } catch (err) {
      console.error('Failed to fetch gateways:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }

    // Fetch sessions independently (slower — don't block gateways display)
    try {
      const sessionsRes = await fetch('/api/sessions', { signal: AbortSignal.timeout(20000) })
      const sessionsData = await sessionsRes.json()
      setStats(prev => prev ? { ...prev, totalSessions: sessionsData.total || 0 } : null)
    } catch (err) {
      console.warn('Failed to fetch sessions count:', err)
    }
  }, [])

  useEffect(() => {
    fetchStats()
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [fetchStats])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchStats()
  }

  const onlineCount = stats?.gateways.filter(g => g.online).length ?? 0
  const totalCount = stats?.gateways.length ?? 0

  return (
    <div className="h-full overflow-y-auto"><div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">Status</h1>
          <p className="text-sm text-[var(--foreground-muted)]">
            Monitor your agents and system health
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full border border-[var(--color-border)]/50 flex items-center justify-center">
                <Wifi className="w-6 h-6 text-[var(--color-success)]" />
              </div>
              <div>
                <p className="text-sm text-[var(--foreground-muted)]">Agents Online</p>
                <p className="text-2xl font-semibold text-[var(--foreground)]">
                  {loading ? '—' : `${onlineCount}/${totalCount}`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full border border-[var(--color-border)]/50 flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-[var(--color-info)]" />
              </div>
              <div>
                <p className="text-sm text-[var(--foreground-muted)]">Active Sessions</p>
                <p className="text-2xl font-semibold text-[var(--foreground)]">
                  {loading ? '—' : stats?.totalSessions ?? 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full border border-[var(--color-border)]/50 flex items-center justify-center">
                <Activity className="w-6 h-6 text-[var(--color-primary)]" />
              </div>
              <div>
                <p className="text-sm text-[var(--foreground-muted)]">System Status</p>
                <p className="text-2xl font-semibold text-[var(--color-success)]">
                  {loading ? '—' : 'Healthy'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Gateway List + Manager */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">
            Agents &amp; Gateways
          </h2>
          
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--primary)]" />
            </div>
          ) : (
            <GatewayManager
              gateways={stats?.gateways ?? []}
              onRefresh={handleRefresh}
            />
          )}
        </CardContent>
      </Card>
    </div></div>
  )
}
