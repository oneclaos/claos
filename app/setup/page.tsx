'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shield, Copy, Check, AlertTriangle } from 'lucide-react'
import { fetchWithCsrf, getCsrfToken } from '@/lib/csrf-client'

export default function SetupPage() {
  const [step, setStep] = useState<'loading' | 'generate' | 'verify' | 'done'>('loading')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [verifyCode, setVerifyCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [copiedSecret, setCopiedSecret] = useState(false)
  const [copiedCodes, setCopiedCodes] = useState(false)
  const router = useRouter()

  useEffect(() => {
    checkStatus()
  }, [])

  async function checkStatus() {
    try {
      await getCsrfToken()
      const res = await fetch('/api/auth/totp')
      const data = await res.json()

      if (data.error) {
        router.push('/login')
        return
      }

      if (!data.setupRequired) {
        router.push('/')
        return
      }

      setStep('generate')
    } catch {
      router.push('/login')
    }
  }

  async function generateSetup() {
    setLoading(true)
    setError('')
    try {
      const res = await fetchWithCsrf('/api/auth/totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setup' }),
      })

      const data = await res.json()

      if (data.error) {
        setError(data.error)
        return
      }

      setQrCode(data.qrCode)
      setSecret(data.secret)
      setRecoveryCodes(data.recoveryCodes)
      setStep('verify')
    } catch {
      setError('Failed to generate setup')
    } finally {
      setLoading(false)
    }
  }

  async function verifySetup() {
    if (verifyCode.length !== 6) {
      setError('Enter 6-digit code')
      return
    }

    setLoading(true)
    setError('')
    try {
      const res = await fetchWithCsrf('/api/auth/totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify-setup', code: verifyCode }),
      })

      const data = await res.json()

      if (data.error) {
        setError(data.error)
        return
      }

      setStep('done')
    } catch {
      setError('Verification failed')
    } finally {
      setLoading(false)
    }
  }

  function copyToClipboard(text: string, type: 'secret' | 'codes') {
    navigator.clipboard.writeText(text)
    if (type === 'secret') {
      setCopiedSecret(true)
      setTimeout(() => setCopiedSecret(false), 2000)
    } else {
      setCopiedCodes(true)
      setTimeout(() => setCopiedCodes(false), 2000)
    }
  }

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-[var(--primary)] border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Card */}
        <div className="card mb-6">
          {/* Header */}
          <div className="text-center section-spacing mb-8">
            <div className="w-16 h-16 gradient-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-title">
              {step === 'generate' && 'Setup Two-Factor Auth'}
              {step === 'verify' && 'Scan QR Code'}
              {step === 'done' && 'Setup Complete!'}
            </h1>
            <p className="text-subtitle">
              {step === 'generate' && 'Protect your account with an authenticator app'}
              {step === 'verify' && 'Use Google Authenticator, Authy, or similar'}
              {step === 'done' && 'Two-factor authentication is now enabled'}
            </p>
          </div>

          {/* Step: Generate */}
          {step === 'generate' && (
            <div className="space-y-6">
              <div className="info-box">
                <p className="info-box-title">You&apos;ll need:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>An authenticator app (Google Authenticator, Authy, 1Password, etc.)</li>
                  <li>Your phone to scan the QR code</li>
                </ul>
              </div>
            </div>
          )}

          {/* Step: Verify */}
          {step === 'verify' && (
            <div className="space-y-6">
              {/* QR Code */}
              <div className="flex justify-center section-spacing">
                <img src={qrCode} alt="TOTP QR Code" className="w-48 h-48 rounded-xl" />
              </div>

              {/* Manual Entry */}
              <div className="info-box">
                <p className="text-xs text-[var(--foreground-muted)] mb-2">
                  Can&apos;t scan? Enter manually:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono bg-white px-3 py-2 rounded-lg border border-[var(--border)] break-all">
                    {secret}
                  </code>
                  <button
                    onClick={() => copyToClipboard(secret, 'secret')}
                    className="p-2 hover:bg-[var(--background)] rounded-lg transition-colors"
                  >
                    {copiedSecret ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Recovery Codes */}
              <div className="section-spacing bg-[var(--error-light)] rounded-xl border border-[var(--error)]/20">
                <div className="flex items-start gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-[var(--error)] flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-[var(--foreground-secondary)]">
                      Save these recovery codes!
                    </p>
                    <p className="text-xs text-[var(--foreground-muted)]">
                      If you lose your phone, use these to regain access.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {recoveryCodes.map((code, i) => (
                    <code
                      key={i}
                      className="text-sm font-mono bg-white px-2 py-1 rounded border border-[var(--border)]"
                    >
                      {code}
                    </code>
                  ))}
                </div>
                <button
                  onClick={() => copyToClipboard(recoveryCodes.join('\n'), 'codes')}
                  className="w-full py-2 text-sm rounded-lg border border-[var(--border)] hover:bg-white transition-colors flex items-center justify-center gap-2"
                >
                  {copiedCodes ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  {copiedCodes ? 'Copied!' : 'Copy all codes'}
                </button>
              </div>

              {/* Verify Input */}
              <div className="section-spacing">
                <label className="label">Enter code from your app:</label>
                <input
                  type="text"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="input text-center text-2xl font-mono tracking-[0.4em]"
                  style={{ height: '60px' }}
                  maxLength={6}
                  autoFocus
                />
              </div>

              {error && (
                <div className="section-spacing text-[var(--error)] text-sm bg-[var(--error-light)] rounded-xl">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step: Done */}
          {step === 'done' && (
            <div className="space-y-6 text-center section-spacing">
              <div className="w-20 h-20 bg-[var(--success-light)] rounded-full flex items-center justify-center mx-auto">
                <Check className="w-10 h-10 text-[var(--success)]" />
              </div>
              <p className="text-[var(--foreground-muted)]">
                Your account is now protected with two-factor authentication.
              </p>
            </div>
          )}
        </div>

        {/* Action button outside card */}
        {step === 'generate' && (
          <button onClick={generateSetup} disabled={loading} className="btn btn-primary w-full">
            {loading ? 'Generating...' : 'Generate QR Code'}
          </button>
        )}

        {step === 'verify' && (
          <button
            onClick={verifySetup}
            disabled={loading || verifyCode.length !== 6}
            className="btn btn-primary w-full"
          >
            {loading ? 'Verifying...' : 'Verify & Enable'}
          </button>
        )}

        {step === 'done' && (
          <button onClick={() => router.push('/')} className="btn btn-primary w-full">
            Continue to Dashboard
          </button>
        )}
      </div>
    </div>
  )
}
