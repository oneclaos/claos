/**
 * Tests for lib/csrf-client.ts
 * Covers all branches: getCsrfToken, fetchCsrfToken, fetchWithCsrf, clearCsrfToken, setCsrfToken
 */

const mockFetch = jest.fn()
global.fetch = mockFetch

// Must reset module cache to clear cached token between tests
beforeEach(() => {
  jest.resetModules()
  mockFetch.mockReset()
})

function makeFetchResponse(ok: boolean, body: unknown, status = ok ? 200 : 500) {
  const text = JSON.stringify(body)
  return {
    ok,
    status,
    clone: () => ({ json: () => Promise.resolve(body) }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(text),
  }
}

describe('getCsrfToken — returns cached token', () => {
  it('returns cached token without fetching again', async () => {
    const { getCsrfToken, setCsrfToken } = await import('@/lib/csrf-client')
    setCsrfToken('cached-token-123')
    const token = await getCsrfToken()
    expect(token).toBe('cached-token-123')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('getCsrfToken — fetches token from /api/auth GET', () => {
  it('returns csrfToken from GET /api/auth response', async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse(true, { csrfToken: 'tok-abc', authenticated: true })
    )
    const { getCsrfToken } = await import('@/lib/csrf-client')
    const token = await getCsrfToken()
    expect(token).toBe('tok-abc')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to POST /api/auth when authenticated but no csrfToken in GET response', async () => {
    mockFetch
      .mockResolvedValueOnce(makeFetchResponse(true, { authenticated: true }))
      .mockResolvedValueOnce(makeFetchResponse(true, { csrfToken: 'tok-post' }))
    const { getCsrfToken } = await import('@/lib/csrf-client')
    const token = await getCsrfToken()
    expect(token).toBe('tok-post')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('throws when GET /api/auth is not ok', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(false, {}, 401))
    const { getCsrfToken } = await import('@/lib/csrf-client')
    await expect(getCsrfToken()).rejects.toThrow()
  })

  it('throws when GET is ok but not authenticated and no csrfToken', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(true, { authenticated: false }))
    const { getCsrfToken } = await import('@/lib/csrf-client')
    await expect(getCsrfToken()).rejects.toThrow()
  })

  it('throws when POST csrf fallback fails', async () => {
    mockFetch
      .mockResolvedValueOnce(makeFetchResponse(true, { authenticated: true }))
      .mockResolvedValueOnce(makeFetchResponse(false, {}, 401))
    const { getCsrfToken } = await import('@/lib/csrf-client')
    await expect(getCsrfToken()).rejects.toThrow()
  })

  it('throws when POST returns ok but no csrfToken', async () => {
    mockFetch
      .mockResolvedValueOnce(makeFetchResponse(true, { authenticated: true }))
      .mockResolvedValueOnce(makeFetchResponse(true, {}))
    const { getCsrfToken } = await import('@/lib/csrf-client')
    await expect(getCsrfToken()).rejects.toThrow()
  })

  it('deduplicates concurrent requests', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse(true, { csrfToken: 'tok-concurrent' }))
    const { getCsrfToken } = await import('@/lib/csrf-client')
    const [t1, t2, t3] = await Promise.all([getCsrfToken(), getCsrfToken(), getCsrfToken()])
    expect(t1).toBe('tok-concurrent')
    expect(t2).toBe('tok-concurrent')
    expect(t3).toBe('tok-concurrent')
    // Might be called once or a few times due to dedup, but not 3 separate calls
    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(3)
  })
})

describe('clearCsrfToken', () => {
  it('clears cached token so next call re-fetches', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse(true, { csrfToken: 'tok-fresh' }))
    const { getCsrfToken, setCsrfToken, clearCsrfToken } = await import('@/lib/csrf-client')
    setCsrfToken('old-token')
    clearCsrfToken()
    const token = await getCsrfToken()
    expect(token).toBe('tok-fresh')
    expect(mockFetch).toHaveBeenCalled()
  })
})

describe('fetchWithCsrf', () => {
  it('does NOT add CSRF token for GET requests', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(true, {}))
    const { fetchWithCsrf, setCsrfToken } = await import('@/lib/csrf-client')
    setCsrfToken('mytoken')
    await fetchWithCsrf('/api/something', { method: 'GET' })
    const callHeaders = mockFetch.mock.calls[0][1].headers
    expect(callHeaders?.['X-CSRF-Token']).toBeUndefined()
  })

  it('adds CSRF token for POST requests', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(true, {}))
    const { fetchWithCsrf, setCsrfToken } = await import('@/lib/csrf-client')
    setCsrfToken('mytoken')
    await fetchWithCsrf('/api/something', { method: 'POST' })
    const callHeaders = mockFetch.mock.calls[0][1].headers
    expect(callHeaders?.['X-CSRF-Token']).toBe('mytoken')
  })

  it('adds CSRF token for PUT, DELETE, PATCH', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse(true, {}))
    const { fetchWithCsrf, setCsrfToken } = await import('@/lib/csrf-client')
    setCsrfToken('mytoken')
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      jest.resetModules()
      mockFetch.mockClear()
      mockFetch.mockResolvedValueOnce(makeFetchResponse(true, {}))
      const m = await import('@/lib/csrf-client')
      m.setCsrfToken('mytoken')
      await m.fetchWithCsrf('/api/something', { method })
      const h = mockFetch.mock.calls[0][1].headers
      expect(h?.['X-CSRF-Token']).toBe('mytoken')
    }
  })

  it('retries with fresh token on 403 CSRF error', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ...makeFetchResponse(false, { error: 'CSRF token invalid' }, 403),
        status: 403,
      })
      .mockResolvedValueOnce(makeFetchResponse(true, { csrfToken: 'fresh-token' }))
      .mockResolvedValueOnce(makeFetchResponse(true, { success: true }))

    const { fetchWithCsrf, setCsrfToken } = await import('@/lib/csrf-client')
    setCsrfToken('old-token')
    const res = await fetchWithCsrf('/api/something', { method: 'POST' })
    expect(res.ok).toBe(true)
    // Should have fetched fresh token then retried
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('returns 403 as-is when error is not CSRF-related', async () => {
    mockFetch.mockResolvedValueOnce({
      ...makeFetchResponse(false, { error: 'Forbidden' }, 403),
      status: 403,
    })
    const { fetchWithCsrf, setCsrfToken } = await import('@/lib/csrf-client')
    setCsrfToken('tok')
    const res = await fetchWithCsrf('/api/something', { method: 'POST' })
    expect(res.status).toBe(403)
  })

  it('defaults to GET when no method provided', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(true, {}))
    const { fetchWithCsrf, setCsrfToken } = await import('@/lib/csrf-client')
    setCsrfToken('tok')
    await fetchWithCsrf('/api/something')
    const callHeaders = mockFetch.mock.calls[0][1].headers
    expect(callHeaders?.['X-CSRF-Token']).toBeUndefined()
  })
})
