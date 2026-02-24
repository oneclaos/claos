import * as pty from 'node-pty'
import { EventEmitter } from 'events'
import { log } from '../logger'

interface TerminalSession {
  id: string
  pty: pty.IPty
  createdAt: Date
  lastActivity: Date
  emitter: EventEmitter
}

// Whitelist of safe environment variables for terminal sessions
// Explicitly excludes GATEWAY_TOKEN, CSRF_SECRET, CLAOS_PASSWORD_HASH, etc.
const TERMINAL_SAFE_ENV_KEYS = [
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'PATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'COLORTERM',
  'XDG_RUNTIME_DIR',
  'TMPDIR',
  'TZ',
]

// Configuration from environment
const MAX_SESSIONS = parseInt(process.env.TERMINAL_MAX_SESSIONS || '20', 10)
const SESSION_TIMEOUT_MS = parseInt(process.env.TERMINAL_SESSION_TIMEOUT || '1800000', 10) // 30 min default
const CLEANUP_INTERVAL_MS = 60_000 // 1 minute
const TERMINAL_USER = process.env.TERMINAL_USER || process.env.USER || 'root'
const TERMINAL_HOME = process.env.TERMINAL_HOME || process.env.HOME || '/home'

class PTYManager {
  private sessions: Map<string, TerminalSession> = new Map()
  private cleanupTimer: NodeJS.Timeout | null = null

  constructor() {
    this.startCleanupTimer()
  }

  private startCleanupTimer(): void {
    // Clear any existing timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }

    // Cleanup inactive sessions every minute
    this.cleanupTimer = setInterval(() => {
      this.cleanupInactiveSessions()
    }, CLEANUP_INTERVAL_MS)

    // Don't prevent process exit
    this.cleanupTimer.unref()

    log.info('PTY cleanup timer started', {
      intervalMs: CLEANUP_INTERVAL_MS,
      timeoutMs: SESSION_TIMEOUT_MS,
      maxSessions: MAX_SESSIONS,
    })
  }

  createSession(id: string): TerminalSession | null {
    // Clean up any dead sessions first
    this.cleanupDeadSessions()

    if (this.sessions.size >= MAX_SESSIONS) {
      log.warn('PTY max sessions reached', {
        maxSessions: MAX_SESSIONS,
        currentSessions: this.sessions.size,
        sessionId: id,
      })
      return null
    }

    const shell = process.env.SHELL || '/bin/bash'
    const emitter = new EventEmitter()
    emitter.setMaxListeners(20)

    // Build sanitized environment
    const safeEnv: Record<string, string> = {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: 'en_US.UTF-8',
      HOME: TERMINAL_HOME,
      USER: TERMINAL_USER,
    }
    for (const key of TERMINAL_SAFE_ENV_KEYS) {
      const val = process.env[key]
      if (val && !safeEnv[key]) safeEnv[key] = val
    }

    let ptyProcess: pty.IPty
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: TERMINAL_HOME,
        env: safeEnv,
      })
    } catch (err) {
      log.error('Failed to spawn PTY', {
        error: err instanceof Error ? err.message : String(err),
        shell,
        cwd: TERMINAL_HOME,
      })
      return null
    }

    const session: TerminalSession = {
      id,
      pty: ptyProcess,
      createdAt: new Date(),
      lastActivity: new Date(),
      emitter,
    }

    ptyProcess.onData((data) => {
      session.lastActivity = new Date()
      emitter.emit('data', data)
    })

    ptyProcess.onExit(({ exitCode }) => {
      log.info('PTY process exited', { sessionId: id, exitCode })
      emitter.emit('exit', exitCode)
      this.sessions.delete(id)
    })

    this.sessions.set(id, session)
    log.info('PTY session created', {
      sessionId: id,
      totalSessions: this.sessions.size,
      shell,
      cwd: TERMINAL_HOME,
    })

    return session
  }

  getSession(id: string): TerminalSession | undefined {
    return this.sessions.get(id)
  }

  write(id: string, data: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false

    session.lastActivity = new Date()
    session.pty.write(data)
    return true
  }

  resize(id: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(id)
    if (!session) return false

    try {
      session.pty.resize(cols, rows)
      return true
    } catch (err) {
      log.error('Failed to resize PTY', {
        sessionId: id,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }

  destroySession(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) {
      log.warn('Attempted to destroy non-existent session', { sessionId: id })
      return false
    }

    try {
      // Force kill the PTY process
      session.pty.kill()
    } catch (err) {
      log.error('Error killing PTY process', {
        sessionId: id,
        error: err instanceof Error ? err.message : String(err),
      })
      // Continue with cleanup anyway
    }

    session.emitter.removeAllListeners()
    this.sessions.delete(id)

    log.info('PTY session destroyed', {
      sessionId: id,
      remainingSessions: this.sessions.size,
    })

    return true
  }

  /**
   * Force destroy all sessions (useful for cleanup)
   */
  destroyAllSessions(): number {
    const count = this.sessions.size
    const ids = [...this.sessions.keys()]

    for (const id of ids) {
      this.destroySession(id)
    }

    log.info('All PTY sessions destroyed', { count })
    return count
  }

  listSessions(): Array<{ id: string; createdAt: Date; lastActivity: Date }> {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
    }))
  }

  /**
   * Clean up sessions that have been inactive for too long
   */
  private cleanupInactiveSessions(): void {
    const now = Date.now()
    let cleaned = 0

    for (const [id, session] of this.sessions) {
      const inactiveMs = now - session.lastActivity.getTime()
      if (inactiveMs > SESSION_TIMEOUT_MS) {
        log.info('Cleaning up inactive PTY session', {
          sessionId: id,
          inactiveMinutes: Math.round(inactiveMs / 60000),
        })
        this.destroySession(id)
        cleaned++
      }
    }

    if (cleaned > 0) {
      log.info('PTY cleanup completed', {
        cleaned,
        remaining: this.sessions.size,
      })
    }
  }

  /**
   * Clean up sessions where the PTY process has died
   */
  private cleanupDeadSessions(): void {
    let cleaned = 0

    for (const [id, session] of this.sessions) {
      try {
        // Check if process is still alive by accessing pid
        // If the process is dead, this will throw or return undefined
        if (!session.pty.pid) {
          log.info('Cleaning up dead PTY session (no pid)', { sessionId: id })
          this.destroySession(id)
          cleaned++
        }
      } catch {
        log.info('Cleaning up dead PTY session (error)', { sessionId: id })
        this.destroySession(id)
        cleaned++
      }
    }

    if (cleaned > 0) {
      log.info('Dead PTY sessions cleaned', { cleaned })
    }
  }

  /**
   * Get current session count
   */
  getSessionCount(): number {
    return this.sessions.size
  }

  /**
   * Get configuration info (for debugging)
   */
  getConfig(): { maxSessions: number; timeoutMs: number; user: string; home: string } {
    return {
      maxSessions: MAX_SESSIONS,
      timeoutMs: SESSION_TIMEOUT_MS,
      user: TERMINAL_USER,
      home: TERMINAL_HOME,
    }
  }
}

// Singleton
export const ptyManager = new PTYManager()
