// CSRF Token Management for Client-Side

let cachedCsrfToken: string | null = null
let tokenFetchPromise: Promise<string> | null = null

export async function getCsrfToken(): Promise<string> {
  // Return cached token if available
  if (cachedCsrfToken) {
    return cachedCsrfToken
  }

  // Deduplicate concurrent requests
  if (tokenFetchPromise) {
    return tokenFetchPromise
  }

  tokenFetchPromise = fetchCsrfToken()
  
  try {
    const token = await tokenFetchPromise
    return token
  } finally {
    tokenFetchPromise = null
  }
}

async function fetchCsrfToken(): Promise<string> {
  try {
    // First try: GET /api/auth (returns csrfToken if authenticated)
    const res = await fetch('/api/auth', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    })
    
    if (res.ok) {
      const data = await res.json()
      if (data.csrfToken) {
        cachedCsrfToken = data.csrfToken
        return data.csrfToken
      }
      
      // Authenticated but no token? Try explicit request
      if (data.authenticated) {
        const csrfRes = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'csrf' }),
          credentials: 'include'
        })
        
        if (csrfRes.ok) {
          const csrfData = await csrfRes.json()
          if (csrfData.csrfToken) {
            cachedCsrfToken = csrfData.csrfToken
            return csrfData.csrfToken
          }
        }
      }
    }
    
    throw new Error('Not authenticated or no CSRF token available')
  } catch (err) {
    console.error('Failed to get CSRF token:', err)
    throw err
  }
}

export function clearCsrfToken(): void {
  cachedCsrfToken = null
}

export function setCsrfToken(token: string): void {
  cachedCsrfToken = token
}

// Wrapper for fetch with CSRF token
export async function fetchWithCsrf(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const method = options.method?.toUpperCase() || 'GET'
  
  // Only add CSRF token for mutating requests
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const csrfToken = await getCsrfToken()
    
    options.headers = {
      ...options.headers,
      'X-CSRF-Token': csrfToken
    }
  }
  
  options.credentials = 'include'
  
  const response = await fetch(url, options)
  
  // If CSRF token is invalid, clear cache and retry once
  if (response.status === 403) {
    const data = await response.clone().json().catch(() => ({}))
    
    if (data.error?.includes('CSRF')) {
      clearCsrfToken()
      
      // Retry with fresh token
      const freshToken = await getCsrfToken()
      options.headers = {
        ...options.headers,
        'X-CSRF-Token': freshToken
      }
      
      return fetch(url, options)
    }
  }
  
  return response
}
