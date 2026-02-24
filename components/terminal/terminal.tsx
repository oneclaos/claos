'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { fetchWithCsrf } from '@/lib/csrf-client'
import 'xterm/css/xterm.css'

interface TerminalProps {
  sessionId: string
  onClose?: () => void
  onSessionDead?: () => void
}

export function Terminal({ sessionId, onClose, onSessionDead }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionDead, setSessionDead] = useState(false)

  // Use refs for callbacks to avoid stale closures without triggering effect re-runs
  const onSessionDeadRef = useRef(onSessionDead)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onSessionDeadRef.current = onSessionDead }, [onSessionDead])
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  const sessionDeadRef = useRef(sessionDead)
  useEffect(() => { sessionDeadRef.current = sessionDead }, [sessionDead])

  const sendInput = useCallback(async (data: string) => {
    if (sessionDeadRef.current) return
    
    try {
      const res = await fetchWithCsrf(`/api/terminal/${sessionId}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data })
      })
      
      if (res.status === 404) {
        setSessionDead(true)
        setError('Session expired')
        onSessionDeadRef.current?.()
      }
    } catch (err) {
      console.error('Failed to send input:', err)
    }
  }, [sessionId]) // stable — no external deps that change

  const resize = useCallback(async (cols: number, rows: number) => {
    if (sessionDeadRef.current) return
    
    try {
      await fetchWithCsrf(`/api/terminal/${sessionId}/resize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols, rows })
      })
    } catch (err) {
      console.error('Failed to resize:', err)
    }
  }, [sessionId]) // stable

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#c0caf5',
        cursorAccent: '#1a1b26',
        selectionBackground: '#33467c',
        black: '#32344a',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#ad8ee6',
        cyan: '#449dab',
        white: '#787c99',
        brightBlack: '#444b6a',
        brightRed: '#ff7a93',
        brightGreen: '#b9f27c',
        brightYellow: '#ff9e64',
        brightBlue: '#7da6ff',
        brightMagenta: '#bb9af7',
        brightCyan: '#0db9d7',
        brightWhite: '#acb0d0'
      }
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(terminalRef.current)
    
    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // Fit terminal to container
    setTimeout(() => {
      fitAddon.fit()
      resize(term.cols, term.rows)
    }, 100)

    // Handle input
    term.onData(sendInput)

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && xtermRef.current) {
        fitAddonRef.current.fit()
        resize(xtermRef.current.cols, xtermRef.current.rows)
      }
    })
    resizeObserver.observe(terminalRef.current)

    // Connect to stream
    const eventSource = new EventSource(`/api/terminal/${sessionId}/stream`)
    eventSourceRef.current = eventSource
    
    eventSource.onopen = () => {
      setConnected(true)
      setError(null)
    }
    
    eventSource.onmessage = (event) => {
      if (event.data && xtermRef.current) {
        // Decode base64 data from server
        try {
          const decoded = atob(event.data)
          xtermRef.current.write(decoded)
        } catch {
          // Fallback: write as-is if not base64
          xtermRef.current.write(event.data)
        }
      }
    }

    eventSource.addEventListener('exit', (event) => {
      console.log('Terminal exited with code:', event.data)
      setSessionDead(true)
      setError('Terminal exited')
    })
    
    eventSource.onerror = () => {
      setConnected(false)
      if (!sessionDead) {
        setError('Connection lost')
        setSessionDead(true)
      }
    }

    return () => {
      eventSource.close()
      eventSourceRef.current = null
      resizeObserver.disconnect()
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  // Only re-mount if sessionId changes — never on callback changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  if (sessionDead) {
    return (
      <div className="h-full flex items-center justify-center bg-[#1a1b26] text-white">
        <div className="text-center">
          <p className="text-red-400 mb-2">⚠️ {error || 'Session expired'}</p>
          <p className="text-gray-400 text-sm mb-4">Close this terminal and open a new one</p>
          {onClose && (
            <button 
              onClick={onClose}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm"
            >
              Close Terminal
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full relative">
      {error && !sessionDead && (
        <div className="absolute top-2 right-2 bg-red-500/80 text-white text-xs px-2 py-1 rounded z-10">
          {error}
        </div>
      )}
      {!connected && !error && (
        <div className="absolute top-2 right-2 bg-yellow-500/80 text-white text-xs px-2 py-1 rounded z-10">
          Connecting...
        </div>
      )}
      <div ref={terminalRef} className="h-full w-full" />
    </div>
  )
}
