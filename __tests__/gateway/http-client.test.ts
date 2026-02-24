/**
 * Tests for lib/gateway/http-client.ts
 * HTTP client for gateway — mocks fetch + circuit-breaker
 */

// ─── Module mocks BEFORE imports ─────────────────────────────────────────────

jest.mock('@/lib/gateway/circuit-breaker', () => ({
  isCircuitOpen: jest.fn().mockReturnValue(false),
  withRetry: jest.fn().mockImplementation((fn: () => unknown) => fn()),
}))

// Mock SSRF protection to allow localhost in tests
jest.mock('@/lib/ssrf-protection', () => ({
  validateGatewayUrl: jest.fn().mockReturnValue({ allowed: true }),
}))

jest.mock('@/lib/logger', () => ({
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { callGateway, checkGatewayHealth, sendMessageHttp } from '@/lib/gateway/http-client'
import { isCircuitOpen, withRetry } from '@/lib/gateway/circuit-breaker'
import type { GatewayConfig } from '@/lib/gateway/types'

const mockIsCircuitOpen = isCircuitOpen as jest.MockedFunction<typeof isCircuitOpen>
const mockWithRetry = withRetry as jest.MockedFunction<typeof withRetry>

// ─── fetch mock ──────────────────────────────────────────────────────────────

const mockFetch = jest.fn()
global.fetch = mockFetch

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGateway(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    id: 'test-gw',
    name: 'Test Gateway',
    url: 'http://127.0.0.1:18750',
    token: 'test-token',
    ...overrides,
  }
}

function mockFetchResponse(ok: boolean, body: unknown, status = 200) {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  mockIsCircuitOpen.mockReturnValue(false)
  mockWithRetry.mockImplementation(<T>(fn: () => Promise<T>) => fn())
})

describe('callGateway', () => {
  it('throws when circuit is open', async () => {
    mockIsCircuitOpen.mockReturnValue(true)
    await expect(callGateway(makeGateway(), '/api/test')).rejects.toThrow(
      'unavailable (circuit open)'
    )
  })

  it('makes a GET request and returns response JSON', async () => {
    const responseData = { status: 'ok', version: '1.0' }
    mockFetch.mockResolvedValue(mockFetchResponse(true, responseData))

    const result = await callGateway(makeGateway(), '/api/status')
    expect(result).toEqual(responseData)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:18750/api/status',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('includes Authorization header when token is provided', async () => {
    mockFetch.mockResolvedValue(mockFetchResponse(true, {}))

    await callGateway(makeGateway({ token: 'my-secret-token' }), '/api/test')

    const callArgs = mockFetch.mock.calls[0][1]
    expect(callArgs.headers['Authorization']).toBe('Bearer my-secret-token')
  })

  it('does not include Authorization header when no token', async () => {
    mockFetch.mockResolvedValue(mockFetchResponse(true, {}))

    await callGateway(makeGateway({ token: undefined }), '/api/test')

    const callArgs = mockFetch.mock.calls[0][1]
    expect(callArgs.headers['Authorization']).toBeUndefined()
  })

  it('makes a POST request with body', async () => {
    mockFetch.mockResolvedValue(mockFetchResponse(true, { success: true }))
    const body = { message: 'Hello' }

    await callGateway(makeGateway(), '/api/chat', 'POST', body)

    const callArgs = mockFetch.mock.calls[0][1]
    expect(callArgs.method).toBe('POST')
    expect(JSON.parse(callArgs.body)).toEqual(body)
  })

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValue(mockFetchResponse(false, 'Unauthorized', 401))

    await expect(callGateway(makeGateway(), '/api/test')).rejects.toThrow('error: 401')
  })

  it('throws timeout error when AbortError is thrown', async () => {
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    mockFetch.mockRejectedValue(abortError)

    await expect(callGateway(makeGateway(), '/api/test', 'GET', undefined, 100)).rejects.toThrow(
      'timeout after'
    )
  })

  it('re-throws network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'))

    await expect(callGateway(makeGateway(), '/api/test')).rejects.toThrow('Connection refused')
  })
})

describe('checkGatewayHealth', () => {
  it('returns false when circuit is open', async () => {
    mockIsCircuitOpen.mockReturnValue(true)
    const result = await checkGatewayHealth(makeGateway())
    expect(result).toBe(false)
  })

  it('returns true when gateway responds with ok', async () => {
    mockFetch.mockResolvedValue({ ok: true })
    const result = await checkGatewayHealth(makeGateway())
    expect(result).toBe(true)
  })

  it('returns false when gateway responds with error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 })
    const result = await checkGatewayHealth(makeGateway())
    expect(result).toBe(false)
  })

  it('returns false when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))
    const result = await checkGatewayHealth(makeGateway())
    expect(result).toBe(false)
  })
})

describe('sendMessageHttp', () => {
  it('sends message and returns reply from choices', async () => {
    const responseData = {
      choices: [{ message: { content: 'Hello back!' } }],
    }
    mockFetch.mockResolvedValue(mockFetchResponse(true, responseData))
    mockWithRetry.mockImplementation(<T>(fn: () => Promise<T>) => fn())

    const result = await sendMessageHttp(makeGateway(), 'Hello!')
    expect(result.reply).toBe('Hello back!')
  })

  it('returns "(no response)" when no choices in response', async () => {
    mockFetch.mockResolvedValue(mockFetchResponse(true, { choices: [] }))

    const result = await sendMessageHttp(makeGateway(), 'Hello!')
    expect(result.reply).toBe('(no response)')
  })

  it('sends history as part of messages', async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse(true, {
        choices: [{ message: { content: 'Reply' } }],
      })
    )

    const history = [
      { role: 'user', content: 'Previous message' },
      { role: 'assistant', content: 'Previous reply' },
    ]
    await sendMessageHttp(makeGateway(), 'New message', history)

    const fetchCall = mockFetch.mock.calls[0][1]
    const body = JSON.parse(fetchCall.body)
    expect(body.messages).toHaveLength(3) // history (2) + new message (1)
    expect(body.messages[0].content).toBe('Previous message')
    expect(body.messages[2].content).toBe('New message')
    expect(body.messages[2].role).toBe('user')
  })
})
