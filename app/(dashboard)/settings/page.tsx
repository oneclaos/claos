'use client'

import { useState, useEffect } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fetchWithCsrf } from '@/lib/csrf-client'
import { Key, Shield, AlertTriangle, Check, RefreshCw, Zap, Mic } from 'lucide-react'
import { useAgentUIControl } from '@/context/agent-ui-control-context'
import { cn } from '@/lib/utils'

export default function SettingsPage() {
  // Password change
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // TOTP status
  const [totpEnabled, setTotpEnabled] = useState(false)
  const [totpLoading, setTotpLoading] = useState(true)
  const [recoveryCodesRemaining, setRecoveryCodesRemaining] = useState(0)

  // UI Control + speech lang (from context — reactive + persisted)
  const { enabled: uiControlEnabled, setEnabled: setUIControlEnabled, speechLang, setSpeechLang } = useAgentUIControl()

  const SPEECH_LANGS = [
    { code: 'en-US', label: '🇬🇧 English' },
    { code: 'fr-FR', label: '🇫🇷 French' },
    { code: 'es-ES', label: '🇪🇸 Spanish' },
    { code: 'de-DE', label: '🇩🇪 German' },
    { code: 'ja-JP', label: '🇯🇵 Japanese' },
    { code: 'ru-RU', label: '🇷🇺 Russian' },
    { code: 'zh-CN', label: '🇨🇳 Chinese (Simplified)' },
  ]

  // Load TOTP status
  useEffect(() => {
    fetch('/api/auth/totp')
      .then(res => res.json())
      .then(data => {
        setTotpEnabled(data.enabled || false)
        setRecoveryCodesRemaining(data.recoveryCodesRemaining || 0)
      })
      .catch(() => {})
      .finally(() => setTotpLoading(false))
  }, [])

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    setPasswordMessage(null)

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Passwords do not match' })
      return
    }

    if (newPassword.length < 12) {
      setPasswordMessage({ type: 'error', text: 'Password must be at least 12 characters' })
      return
    }

    setPasswordLoading(true)
    try {
      const res = await fetchWithCsrf('/api/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      })

      const data = await res.json()

      if (data.success) {
        setPasswordMessage({ type: 'success', text: 'Password changed successfully!' })
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        setPasswordMessage({ type: 'error', text: data.error || 'Failed to change password' })
      }
    } catch {
      setPasswordMessage({ type: 'error', text: 'Connection error' })
    } finally {
      setPasswordLoading(false)
    }
  }

  return (
    <div className="h-full p-6 max-w-5xl overflow-hidden flex flex-col">
        <PageHeader
          title="Settings"
          description="Manage your account security"
        />

        <div className="grid grid-cols-2 gap-4 mt-6 flex-1 min-h-0">
          {/* Agent — UI Control */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Agent
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start justify-between gap-4 rounded-lg border border-[var(--border)] p-4">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">UI Control</span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    Allows the agent to navigate the app and type commands in real time.
                  </span>
                </div>
                {/* Toggle switch */}
                <button
                  role="switch"
                  aria-checked={uiControlEnabled}
                  onClick={() => setUIControlEnabled(!uiControlEnabled)}
                  className={cn(
                    'relative flex-shrink-0 h-6 w-11 rounded-full transition-colors duration-200',
                    'focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 focus:ring-offset-[var(--background)]',
                    uiControlEnabled
                      ? 'bg-[var(--primary)]'
                      : 'bg-[var(--background-secondary)] border border-[var(--border)]',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm',
                      'transition-transform duration-200',
                      uiControlEnabled ? 'translate-x-5' : 'translate-x-0',
                    )}
                  />
                </button>
              </div>
              {uiControlEnabled && (
                <p className="mt-2 text-xs text-[var(--foreground-muted)] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                  Active — the ⚡ button appears on all pages except Chat
                </p>
              )}
            </CardContent>
          </Card>

          {/* Speech Recognition Language */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="h-5 w-5" />
                Speech Recognition
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start justify-between gap-4 rounded-lg border border-[var(--border)] p-4">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Dictation language</span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    Language used when dictating messages with the microphone.
                  </span>
                </div>
                <select
                  value={speechLang}
                  onChange={(e) => setSpeechLang(e.target.value)}
                  className="text-sm rounded-lg px-3 py-1.5 border border-[var(--border)] bg-[var(--background-secondary)] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] flex-shrink-0"
                >
                  {SPEECH_LANGS.map(l => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Password Change */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Change Password
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Current Password</label>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">New Password</label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password (min 12 chars)"
                    minLength={12}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Confirm New Password</label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    required
                  />
                </div>

                {passwordMessage && (
                  <div className={`p-3 rounded-lg text-sm ${
                    passwordMessage.type === 'success' 
                      ? 'bg-green-50 text-green-700 border border-green-200' 
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {passwordMessage.text}
                  </div>
                )}

                <Button type="submit" disabled={passwordLoading}>
                  {passwordLoading ? 'Changing...' : 'Change Password'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Two-Factor Authentication */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Two-Factor Authentication
              </CardTitle>
            </CardHeader>
            <CardContent>
              {totpLoading ? (
                <div className="flex items-center gap-2 text-gray-500">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Loading...
                </div>
              ) : totpEnabled ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-green-600">
                    <Check className="h-5 w-5" />
                    <span className="font-medium">2FA is enabled</span>
                  </div>
                  
                  <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm text-amber-700">
                          <strong>{recoveryCodesRemaining}</strong> recovery codes remaining
                        </p>
                        {recoveryCodesRemaining < 3 && (
                          <p className="text-xs text-amber-600 mt-1">
                            Consider regenerating your recovery codes
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                  <p className="text-sm text-red-700">
                    2FA is not enabled. You will be prompted to set it up on next login.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
    </div>
  )
}
