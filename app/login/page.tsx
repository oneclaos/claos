'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Shield, ArrowLeft } from 'lucide-react'
import Image from 'next/image'
import { setCsrfToken } from '@/lib/csrf-client'

type LoginStep = 'password' | 'totp'

export default function LoginPage() {
  const [step, setStep] = useState<LoginStep>('password')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [tempToken, setTempToken] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/auth')
      .then(res => res.json())
      .then(data => {
        if (data.firstRun) {
          router.push('/first-run')
        } else if (data.authenticated) {
          router.push('/')
        }
      })
      .catch(() => {})
  }, [router])

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', password })
      })

      const data = await res.json()

      if (res.ok) {
        if (data.csrfToken) {
          setCsrfToken(data.csrfToken)
        }
        
        if (data.totpRequired) {
          setTempToken(data.tempToken)
          setStep('totp')
        } else if (data.setupRequired) {
          router.push('/setup')
        } else {
          router.push('/')
          router.refresh()
        }
      } else {
        setError(data.error || 'Login failed')
        if (data.retryAfter) {
          setError(`Too many attempts. Try again in ${data.retryAfter}s`)
        }
      }
    } catch {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  async function handleTotpSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'verify-totp', 
          code: totpCode,
          tempToken 
        })
      })

      const data = await res.json()

      if (res.ok) {
        if (data.csrfToken) {
          setCsrfToken(data.csrfToken)
        }
        router.push('/')
        router.refresh()
      } else {
        setError(data.error || 'Invalid code')
      }
    } catch {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  function goBack() {
    setStep('password')
    setTotpCode('')
    setError('')
    setTempToken(null)
  }

  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        
        {/* Card */}
        <div className="card mb-6">
          
          {/* Password Step */}
          {step === 'password' && (
            <>
              {/* Header */}
              <div className="text-center section-spacing">
                <div className="flex items-center justify-center mx-auto mb-6">
                  <Image src="/logo.svg" alt="Logo" width={160} height={150} className="object-contain" priority />
                </div>
                <h1 className="text-title" style={{ fontSize: '5rem', lineHeight: '1.2' }}>Claos</h1>
                <p className="text-subtitle">Enter your password to continue</p>
              </div>

              {/* Input */}
              <form id="login-form" onSubmit={handlePasswordSubmit}>
                <div className="section-spacing pt-0">
                  <label className="label">Password</label>
                  <div className="relative w-full">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full pr-12 pl-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all"
                      autoFocus
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                      <Lock className="w-5 h-5 text-[var(--color-text-muted)]" />
                    </div>
                  </div>

                  {error && (
                    <div className="mt-3 text-[var(--error)] text-sm bg-[var(--error-light)] rounded-xl px-4 py-3">
                      {error}
                    </div>
                  )}
                </div>
              </form>
            </>
          )}

          {/* TOTP Step */}
          {step === 'totp' && (
            <>
              <button
                type="button"
                onClick={goBack}
                className="flex items-center gap-2 text-[var(--foreground-muted)] hover:text-[var(--foreground)] transition-colors mb-6 section-spacing"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>Back</span>
              </button>

              {/* Header */}
              <div className="text-center section-spacing mb-6">
                <div className="w-16 h-16 gradient-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Shield className="w-8 h-8 text-white" />
                </div>
                <h1 className="text-title">Two-Factor Auth</h1>
                <p className="text-subtitle">Enter the code from your authenticator app</p>
              </div>

              {/* TOTP input */}
              <form id="totp-form" onSubmit={handleTotpSubmit}>
                <div className="section-spacing pt-0">
                  <input
                    type="text"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full text-center text-2xl font-mono tracking-[0.4em] px-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all"
                    style={{ height: '60px' }}
                    maxLength={6}
                    autoFocus
                  />

                  {error && (
                    <div className="mt-3 text-[var(--error)] text-sm bg-[var(--error-light)] rounded-xl px-4 py-3">
                      {error}
                    </div>
                  )}
                </div>
              </form>
            </>
          )}
        </div>

        {/* Bouton Sign In — en dehors de la card */}
        {step === 'password' && (
          <button
            type="submit"
            form="login-form"
            disabled={loading || !password}
            className="btn btn-primary w-full"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        )}

        {step === 'totp' && (
          <button
            type="submit"
            form="totp-form"
            disabled={loading || totpCode.length < 6}
            className="btn btn-primary w-full"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Verifying...
              </span>
            ) : (
              'Verify Code'
            )}
          </button>
        )}

      </div>
    </div>
  )
}
