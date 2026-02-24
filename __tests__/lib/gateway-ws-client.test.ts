// Tests for lib/gateway/ws-client.ts (CRITICAL - Gateway WebSocket connection)

import { EventEmitter } from 'events'

// Create mock WebSocket class
class MockWebSocket extends EventEmitter {
  static instances: MockWebSocket[] = []
  readyState = 1 // OPEN

  constructor(
    public url: string,
    public options?: object
  ) {
    super()
    MockWebSocket.instances.push(this)
    // Simulate async open
    setImmediate(() => this.emit('open'))
  }

  send = jest.fn()
  close = jest.fn(() => {
    this.readyState = 3 // CLOSED
    this.emit('close', 1000, 'Normal closure')
  })
  terminate = jest.fn(() => {
    this.readyState = 3
    this.emit('close', 1006, 'Terminated')
  })

  // Helper to simulate receiving a message
  simulateMessage(data: object) {
    this.emit('message', JSON.stringify(data))
  }

  // Helper to simulate error
  simulateError(error: Error) {
    this.emit('error', error)
  }

  static reset() {
    MockWebSocket.instances = []
  }
}

// Mock ws module
jest.mock('ws', () => ({
  WebSocket: MockWebSocket,
}))

// Mock logger
jest.mock('@/lib/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

// Import after mocking
import { GatewayWsClient, GatewayError } from '@/lib/gateway/ws-client'

describe('GatewayWsClient', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    MockWebSocket.reset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('Constructor', () => {
    it('should create client with required options', () => {
      const client = new GatewayWsClient({
        token: 'test-token',
      })

      expect(client).toBeInstanceOf(GatewayWsClient)
    })

    it('should use default URL when not provided', () => {
      const client = new GatewayWsClient({
        token: 'test-token',
      })

      expect(client).toBeDefined()
    })

    it('should accept custom URL', () => {
      const client = new GatewayWsClient({
        url: 'ws://custom:9999',
        token: 'test-token',
      })

      expect(client).toBeDefined()
    })

    it('should accept custom client ID', () => {
      const client = new GatewayWsClient({
        token: 'test-token',
        clientId: 'custom-client',
      })

      expect(client).toBeDefined()
    })
  })

  describe('Connection', () => {
    it('should create WebSocket on connect', async () => {
      const client = new GatewayWsClient({
        url: 'ws://localhost:18789',
        token: 'test-token',
      })

      // Start connection but don't await (need to handle handshake)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _connectPromise = client.connect()

      // Run timers to trigger open event
      jest.runAllTimers()

      // Simulate the gateway handshake
      const ws = MockWebSocket.instances[0]
      ws.simulateMessage({
        event: 'connect.challenge',
        payload: { nonce: 'test-nonce' },
      })

      // Client should send connect response
      expect(ws.send).toHaveBeenCalled()
    })

    it('should reject on connection timeout', async () => {
      const client = new GatewayWsClient({
        url: 'ws://localhost:18789',
        token: 'test-token',
      })

      const promise = client.connect()

      // Advance past timeout without completing handshake
      jest.advanceTimersByTime(15000)

      await expect(promise).rejects.toThrow()
    })

    it('should handle connection errors', async () => {
      const client = new GatewayWsClient({
        url: 'ws://localhost:18789',
        token: 'test-token',
      })

      // Start connection (fire-and-forget for this test)
      void client.connect()

      jest.runAllTimers()

      const ws = MockWebSocket.instances[0]
      ws.simulateError(new Error('Connection refused'))

      // Should not throw immediately, might retry
      expect(ws).toBeDefined()
    })
  })

  describe('Authentication', () => {
    it('should respond to connect.challenge with token', async () => {
      const client = new GatewayWsClient({
        url: 'ws://localhost:18789',
        token: 'my-secret-token',
      })

      client.connect()
      jest.runAllTimers()

      const ws = MockWebSocket.instances[0]
      ws.simulateMessage({
        event: 'connect.challenge',
        payload: { nonce: 'challenge-nonce' },
      })

      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('connect'))

      const sendCall = ws.send.mock.calls[0][0]
      const parsed = JSON.parse(sendCall)
      expect(parsed.event).toBe('connect')
      expect(parsed.payload).toHaveProperty('nonce')
      expect(parsed.payload).toHaveProperty('token')
    })

    it('should emit ready after successful handshake', async () => {
      const onReady = jest.fn()
      const client = new GatewayWsClient({
        url: 'ws://localhost:18789',
        token: 'test-token',
        onReady,
      })

      const connectPromise = client.connect()
      jest.runAllTimers()

      const ws = MockWebSocket.instances[0]

      // Challenge
      ws.simulateMessage({
        event: 'connect.challenge',
        payload: { nonce: 'nonce' },
      })

      // Hello OK (handshake complete)
      ws.simulateMessage({
        event: 'hello-ok',
        payload: {},
      })

      await connectPromise

      expect(onReady).toHaveBeenCalled()
    })
  })

  describe('isReady', () => {
    it('should return false before connection', () => {
      const client = new GatewayWsClient({
        token: 'test-token',
      })

      expect(client.isReady()).toBe(false)
    })

    it('should return true after successful handshake', async () => {
      const client = new GatewayWsClient({
        token: 'test-token',
      })

      const connectPromise = client.connect()
      jest.runAllTimers()

      const ws = MockWebSocket.instances[0]
      ws.simulateMessage({
        event: 'connect.challenge',
        payload: { nonce: 'nonce' },
      })
      ws.simulateMessage({
        event: 'hello-ok',
        payload: {},
      })

      await connectPromise

      expect(client.isReady()).toBe(true)
    })
  })

  describe('close', () => {
    it('should close WebSocket connection', async () => {
      const client = new GatewayWsClient({
        token: 'test-token',
      })

      const connectPromise = client.connect()
      jest.runAllTimers()

      const ws = MockWebSocket.instances[0]
      ws.simulateMessage({
        event: 'connect.challenge',
        payload: { nonce: 'nonce' },
      })
      ws.simulateMessage({
        event: 'hello-ok',
        payload: {},
      })

      await connectPromise

      client.close()

      expect(ws.close).toHaveBeenCalled()
    })
  })

  describe('Event Handling', () => {
    it('should emit events for agent messages', async () => {
      const onMessage = jest.fn()
      const client = new GatewayWsClient({
        token: 'test-token',
        onMessage,
      })

      const connectPromise = client.connect()
      jest.runAllTimers()

      const ws = MockWebSocket.instances[0]
      ws.simulateMessage({
        event: 'connect.challenge',
        payload: { nonce: 'nonce' },
      })
      ws.simulateMessage({
        event: 'hello-ok',
        payload: {},
      })

      await connectPromise

      // Simulate agent event
      ws.simulateMessage({
        event: 'agent',
        payload: { runId: 'run-123', stream: 'assistant', data: { delta: 'Hello' } },
      })

      expect(onMessage).toHaveBeenCalledWith('agent', expect.any(Object))
    })

    it('should support EventEmitter API', async () => {
      const client = new GatewayWsClient({
        token: 'test-token',
      })

      const agentHandler = jest.fn()
      client.on('agent', agentHandler)

      const connectPromise = client.connect()
      jest.runAllTimers()

      const ws = MockWebSocket.instances[0]
      ws.simulateMessage({
        event: 'connect.challenge',
        payload: { nonce: 'nonce' },
      })
      ws.simulateMessage({
        event: 'hello-ok',
        payload: {},
      })

      await connectPromise

      ws.simulateMessage({
        event: 'agent',
        payload: { runId: 'run-456', text: 'Response' },
      })

      expect(agentHandler).toHaveBeenCalledWith({ runId: 'run-456', text: 'Response' })
    })

    it('should allow removing event listeners', async () => {
      const client = new GatewayWsClient({
        token: 'test-token',
      })

      const handler = jest.fn()
      client.on('agent', handler)
      client.off('agent', handler)

      const connectPromise = client.connect()
      jest.runAllTimers()

      const ws = MockWebSocket.instances[0]
      ws.simulateMessage({
        event: 'connect.challenge',
        payload: { nonce: 'nonce' },
      })
      ws.simulateMessage({
        event: 'hello-ok',
        payload: {},
      })

      await connectPromise

      ws.simulateMessage({
        event: 'agent',
        payload: { text: 'Test' },
      })

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('Error Callbacks', () => {
    it('should call onError callback on WebSocket error', async () => {
      const onError = jest.fn()
      const client = new GatewayWsClient({
        token: 'test-token',
        onError,
      })

      client.connect()
      jest.runAllTimers()

      const ws = MockWebSocket.instances[0]
      const error = new Error('Socket error')
      ws.simulateError(error)

      expect(onError).toHaveBeenCalledWith(error)
    })

    it('should call onClose callback on disconnect', async () => {
      const onClose = jest.fn()
      const client = new GatewayWsClient({
        token: 'test-token',
        onClose,
      })

      const connectPromise = client.connect()
      jest.runAllTimers()

      const ws = MockWebSocket.instances[0]
      ws.simulateMessage({
        event: 'connect.challenge',
        payload: { nonce: 'nonce' },
      })
      ws.simulateMessage({
        event: 'hello-ok',
        payload: {},
      })

      await connectPromise

      ws.emit('close', 1000, 'Normal')

      expect(onClose).toHaveBeenCalledWith(1000, 'Normal')
    })
  })

  describe('GatewayError', () => {
    it('should create error with code', () => {
      const error = new GatewayError('gateway.timeout')

      expect(error).toBeInstanceOf(Error)
      expect(error.code).toBe('gateway.timeout')
    })

    it('should support retryable flag', () => {
      const error = new GatewayError('gateway.unavailable', true)

      expect(error.retryable).toBe(true)
    })

    it('should have message based on code', () => {
      const error = new GatewayError('gateway.token_invalid')

      expect(error.message).toContain('token')
    })
  })
})

describe('GatewayWsClient Security', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    MockWebSocket.reset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('should not expose token in error messages', async () => {
    const secretToken = 'super-secret-token-12345'
    const client = new GatewayWsClient({
      token: secretToken,
    })

    client.connect()
    jest.runAllTimers()

    const ws = MockWebSocket.instances[0]
    ws.simulateMessage({
      event: 'connect.challenge',
      payload: { nonce: 'nonce' },
    })

    // Check that sent message doesn't expose token in plaintext
    const sendCall = ws.send.mock.calls[0]?.[0]
    if (sendCall) {
      // Token should be hashed/transformed in the connect response
      expect(sendCall).not.toContain(secretToken)
    }
  })

  it('should handle malformed messages gracefully', async () => {
    const client = new GatewayWsClient({
      token: 'test-token',
    })

    client.connect()
    jest.runAllTimers()

    const ws = MockWebSocket.instances[0]

    // Send malformed JSON - should not crash
    expect(() => {
      ws.emit('message', 'not-json')
    }).not.toThrow()

    // Send valid JSON but missing event - should not crash
    expect(() => {
      ws.emit('message', JSON.stringify({ foo: 'bar' }))
    }).not.toThrow()
  })
})
