// Tests for lib/terminal/pty-manager.ts (CRITICAL - Terminal session management)

// Mock node-pty before importing ptyManager
const mockPty = {
  spawn: jest.fn(),
}

jest.mock('node-pty', () => mockPty)

// Mock logger
jest.mock('@/lib/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

describe('PTYManager', () => {
  let PTYManager: {
    createSession: (id: string) => unknown
    getSession: (id: string) => unknown
    write: (id: string, data: string) => boolean
    resize: (id: string, cols: number, rows: number) => boolean
    destroySession: (id: string) => boolean
    listSessions: () => { id: string }[]
  }

  let mockPtyProcess: {
    onData: jest.Mock
    onExit: jest.Mock
    write: jest.Mock
    resize: jest.Mock
    kill: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()

    // Create mock PTY process
    mockPtyProcess = {
      onData: jest.fn(),
      onExit: jest.fn(),
      write: jest.fn(),
      resize: jest.fn(),
      kill: jest.fn(),
    }

    mockPty.spawn.mockReturnValue(mockPtyProcess)

    // Re-import to get fresh instance
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ptyModule = require('@/lib/terminal/pty-manager')
    PTYManager = ptyModule.ptyManager
  })

  describe('createSession', () => {
    it('should create a new terminal session', () => {
      const session = PTYManager.createSession('test-session-1')

      expect(session).not.toBeNull()
      expect(session?.id).toBe('test-session-1')
      expect(session?.createdAt).toBeInstanceOf(Date)
      expect(mockPty.spawn).toHaveBeenCalledWith(
        '/bin/bash',
        [],
        expect.objectContaining({
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
        })
      )
    })

    it('should set up data handler on PTY process', () => {
      PTYManager.createSession('test-session-2')

      expect(mockPtyProcess.onData).toHaveBeenCalled()
    })

    it('should set up exit handler on PTY process', () => {
      PTYManager.createSession('test-session-3')

      expect(mockPtyProcess.onExit).toHaveBeenCalled()
    })

    it('should use sanitized environment variables', () => {
      PTYManager.createSession('test-session-4')

      const spawnCall = mockPty.spawn.mock.calls[0]
      const env = spawnCall[2].env

      // Should have safe vars
      expect(env.TERM).toBe('xterm-256color')
      expect(env.COLORTERM).toBe('truecolor')

      // Should NOT have sensitive vars
      expect(env.GATEWAY_TOKEN).toBeUndefined()
      expect(env.CSRF_SECRET).toBeUndefined()
      expect(env.CLAOS_PASSWORD_HASH).toBeUndefined()
    })
  })

  describe('getSession', () => {
    it('should return existing session', () => {
      const created = PTYManager.createSession('get-test-1')
      const retrieved = PTYManager.getSession('get-test-1')

      expect(retrieved).toBe(created)
    })

    it('should return undefined for non-existent session', () => {
      const result = PTYManager.getSession('non-existent')

      expect(result).toBeUndefined()
    })
  })

  describe('write', () => {
    it('should write data to existing session', () => {
      PTYManager.createSession('write-test-1')

      const result = PTYManager.write('write-test-1', 'ls -la\n')

      expect(result).toBe(true)
      expect(mockPtyProcess.write).toHaveBeenCalledWith('ls -la\n')
    })

    it('should return false for non-existent session', () => {
      const result = PTYManager.write('non-existent', 'test')

      expect(result).toBe(false)
    })

    it('should update lastActivity on write', () => {
      PTYManager.createSession('write-test-2')
      const before = PTYManager.getSession('write-test-2')?.lastActivity

      // Small delay to ensure time difference
      if (jest.advanceTimersByTime) {
        jest.advanceTimersByTime(100)
      }

      PTYManager.write('write-test-2', 'test')
      const after = PTYManager.getSession('write-test-2')?.lastActivity

      expect(after?.getTime()).toBeGreaterThanOrEqual(before?.getTime() || 0)
    })
  })

  describe('resize', () => {
    it('should resize existing session', () => {
      PTYManager.createSession('resize-test-1')

      const result = PTYManager.resize('resize-test-1', 120, 40)

      expect(result).toBe(true)
      expect(mockPtyProcess.resize).toHaveBeenCalledWith(120, 40)
    })

    it('should return false for non-existent session', () => {
      const result = PTYManager.resize('non-existent', 80, 24)

      expect(result).toBe(false)
    })
  })

  describe('destroySession', () => {
    it('should destroy existing session', () => {
      PTYManager.createSession('destroy-test-1')

      const result = PTYManager.destroySession('destroy-test-1')

      expect(result).toBe(true)
      expect(mockPtyProcess.kill).toHaveBeenCalled()
      expect(PTYManager.getSession('destroy-test-1')).toBeUndefined()
    })

    it('should return false for non-existent session', () => {
      const result = PTYManager.destroySession('non-existent')

      expect(result).toBe(false)
    })
  })

  describe('listSessions', () => {
    it('should return empty array when no sessions', () => {
      // Clear existing sessions
      const sessions = PTYManager.listSessions()
      sessions.forEach((s: { id: string }) => PTYManager.destroySession(s.id))

      const result = PTYManager.listSessions()

      expect(result).toEqual([])
    })

    it('should return all active sessions', () => {
      // Clear existing
      PTYManager.listSessions().forEach((s: { id: string }) => PTYManager.destroySession(s.id))

      PTYManager.createSession('list-test-1')
      PTYManager.createSession('list-test-2')

      const result = PTYManager.listSessions()

      expect(result).toHaveLength(2)
      expect(result.map((s: { id: string }) => s.id)).toContain('list-test-1')
      expect(result.map((s: { id: string }) => s.id)).toContain('list-test-2')
    })
  })

  describe('Security', () => {
    it('should not expose sensitive environment variables', () => {
      // Set some sensitive env vars
      process.env.GATEWAY_TOKEN = 'secret-token'
      process.env.CSRF_SECRET = 'secret-csrf'
      process.env.CLAOS_PASSWORD_HASH = 'secret-hash'

      PTYManager.createSession('security-test-1')

      const spawnCall = mockPty.spawn.mock.calls[0]
      const env = spawnCall[2].env

      expect(env.GATEWAY_TOKEN).toBeUndefined()
      expect(env.CSRF_SECRET).toBeUndefined()
      expect(env.CLAOS_PASSWORD_HASH).toBeUndefined()

      // Cleanup
      delete process.env.GATEWAY_TOKEN
      delete process.env.CSRF_SECRET
      delete process.env.CLAOS_PASSWORD_HASH
    })
  })
})
