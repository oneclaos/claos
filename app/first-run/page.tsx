'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Cloud, Check, Loader2, Wifi, WifiOff, ChevronRight } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface DiscoveredAgent {
  id: string
  name: string
  port: number
  url: string
  paired: boolean
  type: 'clawdbot' | 'openclaw'
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function FirstRunPage() {
  const [step, setStep] = useState<1 | 2>(1)
  const router = useRouter()

  // Guard: if a password is already set, redirect to login
  useEffect(() => {
    fetch('/api/auth')
      .then(res => res.json())
      .then((data: { firstRun?: boolean }) => {
        if (!data.firstRun) {
          router.push('/login')
        }
      })
      .catch(() => {})
  }, [router])

  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {step === 1
          ? <StepPassword onSuccess={() => setStep(2)} />
          : <StepAgentPairing />
        }
      </div>
    </div>
  )
}

// ─── Step 1: Password ────────────────────────────────────────────────────────

function StepPassword({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    setError('')

    if (password.length < 12) {
      setError('Password must be at least 12 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/first-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      const data = await res.json() as { success?: boolean; error?: string }

      if (res.ok && data.success) {
        setDone(true)
        setTimeout(() => onSuccess(), 800)
      } else {
        setError(data.error ?? 'Failed to set password')
      }
    } catch {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Step indicator */}
      <StepIndicator current={1} total={2} />

      <div className="card mb-6">
        {/* Header */}
        <div className="text-center section-spacing mb-8">
          <div className="w-16 h-16 gradient-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
            {done ? <Check className="w-8 h-8 text-white" /> : <Cloud className="w-8 h-8 text-white" />}
          </div>
          <h1 className="text-title">
            {done ? 'Password Set!' : 'Welcome to Claos'}
          </h1>
          <p className="text-subtitle">
            {done
              ? 'Discovering your agents…'
              : 'Create a password to protect your dashboard'}
          </p>
        </div>

        {!done && (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="section-spacing">
              <label className="label">Password</label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Choose a strong password"
                  className="input input-with-icon"
                  autoFocus
                  minLength={12}
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  <Lock className="w-5 h-5 text-[var(--foreground-muted)]" />
                </div>
              </div>
            </div>

            <div className="section-spacing">
              <label className="label">Confirm Password</label>
              <div className="relative">
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
                  className="input input-with-icon"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  <Lock className="w-5 h-5 text-[var(--foreground-muted)]" />
                </div>
              </div>
            </div>

            {error && (
              <div className="section-spacing text-[var(--error)] text-sm bg-[var(--error-light)] rounded-xl">
                {error}
              </div>
            )}
          </form>
        )}

        {done && (
          <div className="flex justify-center py-4">
            <Loader2 className="animate-spin w-6 h-6 text-[var(--primary)]" />
          </div>
        )}
      </div>

      {!done && (
        <button
          onClick={() => handleSubmit()}
          disabled={loading || !password || !confirm}
          className="btn btn-primary w-full"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="animate-spin h-5 w-5" />
              Setting password…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              Set Password
              <ChevronRight className="w-5 h-5" />
            </span>
          )}
        </button>
      )}
    </>
  )
}

// ─── Step 2: Agent Pairing ───────────────────────────────────────────────────

function StepAgentPairing() {
  const router = useRouter()
  const [scanning, setScanning] = useState(true)
  const [agents, setAgents] = useState<DiscoveredAgent[]>([])
  const [scanError, setScanError] = useState('')

  // Per-agent manual token state
  const [tokenInputs, setTokenInputs] = useState<Record<string, string>>({})
  const [connecting, setConnecting] = useState<Record<string, boolean>>({})
  const [connectErrors, setConnectErrors] = useState<Record<string, string>>({})
  const [manualPaired, setManualPaired] = useState<Set<string>>(new Set())

  const runScan = useCallback(async () => {
    setScanning(true)
    setScanError('')
    try {
      const res = await fetch('/api/setup/pair')
      const data = await res.json() as { agents?: DiscoveredAgent[]; error?: string }
      if (res.ok && data.agents) {
        setAgents(data.agents)
      } else {
        setScanError(data.error ?? 'Scan failed')
      }
    } catch {
      setScanError('Connection error during scan')
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => { void runScan() }, [runScan])

  async function handleConnect(agent: DiscoveredAgent) {
    const token = tokenInputs[agent.id]?.trim()
    if (!token) {
      setConnectErrors(prev => ({ ...prev, [agent.id]: 'Please enter a token' }))
      return
    }

    setConnecting(prev => ({ ...prev, [agent.id]: true }))
    setConnectErrors(prev => ({ ...prev, [agent.id]: '' }))

    try {
      const res = await fetch('/api/setup/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id, token })
      })
      const data = await res.json() as { success?: boolean; error?: string }

      if (res.ok && data.success) {
        setManualPaired(prev => new Set([...prev, agent.id]))
      } else {
        setConnectErrors(prev => ({ ...prev, [agent.id]: data.error ?? 'Failed to connect' }))
      }
    } catch {
      setConnectErrors(prev => ({ ...prev, [agent.id]: 'Connection error' }))
    } finally {
      setConnecting(prev => ({ ...prev, [agent.id]: false }))
    }
  }

  const connectedCount = agents.filter(a => a.paired || manualPaired.has(a.id)).length

  return (
    <>
      {/* Step indicator */}
      <StepIndicator current={2} total={2} />

      <div className="card mb-6">
        {/* Header */}
        <div className="text-center section-spacing mb-8">
          <div className="w-16 h-16 gradient-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
            {scanning
              ? <Loader2 className="w-8 h-8 text-white animate-spin" />
              : <Wifi className="w-8 h-8 text-white" />
            }
          </div>
          <h1 className="text-title">Connect Your Agents</h1>
          <p className="text-subtitle">
            {scanning
              ? 'Scanning for running agents…'
              : agents.length === 0
                ? 'No agents found on this machine'
                : `Found ${agents.length} agent${agents.length > 1 ? 's' : ''} · ${connectedCount} connected`
            }
          </p>
        </div>

        {/* Scanning spinner */}
        {scanning && (
          <div className="flex justify-center py-8">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="animate-spin w-8 h-8 text-[var(--primary)]" />
              <p className="text-sm text-[var(--foreground-muted)]">
                Scanning ports 18700–18799…
              </p>
            </div>
          </div>
        )}

        {/* Scan error */}
        {!scanning && scanError && (
          <div className="section-spacing text-[var(--error)] text-sm bg-[var(--error-light)] rounded-xl mb-4">
            {scanError}
            <button
              onClick={() => void runScan()}
              className="ml-2 underline text-[var(--primary)]"
            >
              Retry
            </button>
          </div>
        )}

        {/* No agents found */}
        {!scanning && !scanError && agents.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-8 text-[var(--foreground-muted)]">
            <WifiOff className="w-10 h-10" />
            <p className="text-sm">No Clawdbot agents detected on this machine.</p>
            <p className="text-xs">Make sure your agents are running, then retry.</p>
            <button onClick={() => void runScan()} className="btn btn-primary mt-2">
              Scan Again
            </button>
          </div>
        )}

        {/* Agent list */}
        {!scanning && agents.length > 0 && (
          <div className="space-y-4">
            {agents.map(agent => {
              const isPaired = agent.paired || manualPaired.has(agent.id)
              const isConnecting = connecting[agent.id] ?? false
              const connectError = connectErrors[agent.id]
              const tokenVal = tokenInputs[agent.id] ?? ''

              return (
                <div key={agent.id} className="rounded-xl border border-[var(--border)] p-4 space-y-3">
                  {/* Agent header row */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 gradient-primary rounded-xl flex items-center justify-center flex-shrink-0">
                        <Wifi className="w-4 h-4 text-white" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{agent.name}</p>
                        <p className="text-xs text-[var(--foreground-muted)] truncate">
                          {agent.url} · {agent.type}
                        </p>
                      </div>
                    </div>

                    {/* Status badge */}
                    {isPaired ? (
                      <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--success-light,#d1fae5)] text-[var(--success,#059669)] flex-shrink-0">
                        <Check className="w-3 h-3" />
                        Auto-connected
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--warning-light,#fef3c7)] text-[var(--warning,#d97706)] flex-shrink-0">
                        ⚠️ Token needed
                      </span>
                    )}
                  </div>

                  {/* Manual token input (only for unpaired agents that haven't been connected yet) */}
                  {!isPaired && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={tokenVal}
                          onChange={e => setTokenInputs(prev => ({ ...prev, [agent.id]: e.target.value }))}
                          placeholder="Paste agent token…"
                          className="input flex-1 text-sm"
                          onKeyDown={e => { if (e.key === 'Enter') void handleConnect(agent) }}
                          disabled={isConnecting}
                        />
                        <button
                          onClick={() => void handleConnect(agent)}
                          disabled={isConnecting || !tokenVal.trim()}
                          className="btn btn-primary px-4 text-sm flex-shrink-0"
                        >
                          {isConnecting ? (
                            <Loader2 className="animate-spin w-4 h-4" />
                          ) : (
                            'Connect'
                          )}
                        </button>
                      </div>
                      {connectError && (
                        <p className="text-xs text-[var(--error)]">{connectError}</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Continue button */}
      <button
        onClick={() => router.push('/')}
        disabled={connectedCount === 0}
        className="btn btn-primary w-full"
      >
        {connectedCount === 0
          ? 'Connect at least one agent to continue'
          : (
            <span className="flex items-center justify-center gap-2">
              Continue to Dashboard
              <ChevronRight className="w-5 h-5" />
            </span>
          )
        }
      </button>

      {/* Skip link */}
      {connectedCount === 0 && !scanning && (
        <p className="text-center text-xs text-[var(--foreground-muted)] mt-3">
          <button
            onClick={() => router.push('/')}
            className="underline hover:text-[var(--foreground)]"
          >
            Skip for now
          </button>
          {' '}(you can add agents later)
        </p>
      )}
    </>
  )
}

// ─── Step Indicator ──────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1
        const isActive = step === current
        const isDone = step < current
        return (
          <div key={step} className="flex items-center gap-2">
            <div
              className={[
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all',
                isDone
                  ? 'gradient-primary text-white'
                  : isActive
                    ? 'gradient-primary text-white ring-2 ring-[var(--primary)] ring-offset-2'
                    : 'bg-[var(--surface)] text-[var(--foreground-muted)] border border-[var(--border)]'
              ].join(' ')}
            >
              {isDone ? <Check className="w-4 h-4" /> : step}
            </div>
            {step < total && (
              <div className={[
                'w-8 h-0.5 rounded',
                isDone ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'
              ].join(' ')} />
            )}
          </div>
        )
      })}
    </div>
  )
}
