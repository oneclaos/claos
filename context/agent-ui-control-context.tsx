'use client'

/**
 * AgentUIControlContext
 *
 * Manages the UI Control feature state:
 * - enabled/disabled (persisted to localStorage)
 * - running status
 * - available agents list
 * - selected agent
 * - abort controller for stop
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react'
import { UI_CONTROL_ENABLED_KEY, LS_KEYS } from '@/lib/constants'

// ─── Types ─────────────────────────────────────────────────────────────────

export type UIControlStatus = 'idle' | 'running' | 'done' | 'stopped' | 'error'

export interface AgentInfo {
  id: string
  name: string
  gatewayId: string
  avatar?: string
  online: boolean
}

interface AgentUIControlContextValue {
  enabled: boolean
  setEnabled: (v: boolean) => void
  status: UIControlStatus
  setStatus: (s: UIControlStatus) => void
  agents: AgentInfo[]
  selectedAgentId: string | null
  setSelectedAgentId: (id: string) => void
  abortRef: React.MutableRefObject<AbortController | null>
  stop: () => void
  speechLang: string
  setSpeechLang: (lang: string) => void
  /** Current directory path shown in FilesView — updated by FilesView on every navigation */
  filesCurrentPath: string | null
  setFilesCurrentPath: (path: string | null) => void
  /** Pending path that FilesView should navigate to on mount (avoids CustomEvent race condition) */
  pendingNavPath: string | null
  setPendingNavPath: (path: string | null) => void
}

// ─── Storage keys ────────────────────────────────────────────────────────────

const STORAGE_KEY = UI_CONTROL_ENABLED_KEY
const SPEECH_LANG_KEY = LS_KEYS.SPEECH_LANG

// ─── Context ────────────────────────────────────────────────────────────────

const AgentUIControlContext = createContext<AgentUIControlContextValue | null>(null)

// ─── Provider ───────────────────────────────────────────────────────────────

export function AgentUIControlProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false)
  const [status, setStatus] = useState<UIControlStatus>('idle')
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [speechLang, setSpeechLangState] = useState('en-US')
  const [filesCurrentPath, setFilesCurrentPath] = useState<string | null>(null)
  const [pendingNavPath, setPendingNavPath] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Load persisted state from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'true') setEnabledState(true)
      const lang = localStorage.getItem(SPEECH_LANG_KEY)
      if (lang) setSpeechLangState(lang)
    } catch {
      // localStorage unavailable (SSR / private mode)
    }
  }, [])

  // Fetch agents when enabled
  useEffect(() => {
    if (!enabled) return
    fetch('/api/agents')
      .then(r => r.json())
      .then(data => {
        const list: AgentInfo[] = (data.agents ?? []).map((a: AgentInfo) => ({
          id: a.id,
          name: a.name,
          gatewayId: a.gatewayId ?? a.id,
          avatar: a.avatar,
          online: a.online ?? true,
        }))
        setAgents(list)
        // Auto-select if only one agent
        if (list.length === 1) {
          setSelectedAgentId(list[0].id)
        }
      })
      .catch(() => {})
  }, [enabled])

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v)
    try {
      localStorage.setItem(STORAGE_KEY, String(v))
    } catch {}
    if (!v) setStatus('idle')
  }, [])

  const setSpeechLang = useCallback((lang: string) => {
    setSpeechLangState(lang)
    try { localStorage.setItem(SPEECH_LANG_KEY, lang) } catch {}
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setStatus('stopped')
    setTimeout(() => setStatus('idle'), 2000)
  }, [])

  return (
    <AgentUIControlContext.Provider
      value={{
        enabled,
        setEnabled,
        status,
        setStatus,
        agents,
        selectedAgentId,
        setSelectedAgentId,
        abortRef,
        stop,
        speechLang,
        setSpeechLang,
        filesCurrentPath,
        setFilesCurrentPath,
        pendingNavPath,
        setPendingNavPath,
      }}
    >
      {children}
    </AgentUIControlContext.Provider>
  )
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAgentUIControl(): AgentUIControlContextValue {
  const ctx = useContext(AgentUIControlContext)
  if (!ctx) throw new Error('useAgentUIControl must be used within AgentUIControlProvider')
  return ctx
}
