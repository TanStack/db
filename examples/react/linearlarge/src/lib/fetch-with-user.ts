// Wrapper to add user headers to all server function calls
export function getUserHeaders(): HeadersInit {
  // Get user info from URL query params
  const params = new URLSearchParams(window.location.search)
  const userId = params.get('userId')
  const username = params.get('username')

  if (!userId || !username) {
    throw new Error('No user found in URL query params')
  }

  return {
    'x-user-id': userId,
    'x-user-name': username,
  }
}

// Patch fetch globally to add user headers to server function calls
if (typeof window !== 'undefined') {
  const originalFetch = window.fetch

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    // Only add headers to relative URLs (server functions)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

    if (url.startsWith('/') || url.startsWith(window.location.origin)) {
      try {
        const userHeaders = getUserHeaders()
        const headers = new Headers(init?.headers)

        Object.entries(userHeaders).forEach(([key, value]) => {
          headers.set(key, value)
        })

        init = {
          ...init,
          headers,
        }
      } catch (e) {
        // If no user headers, let it fail naturally on the server
        console.warn('Could not add user headers:', e)
      }
    }

    return originalFetch(input, init)
  }
}
