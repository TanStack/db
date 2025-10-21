// API client for communicating with the backend server in SPA mode

const API_BASE_URL = import.meta.env.VITE_API_URL || `http://localhost:3001/api`

async function fetchAPI(endpoint: string, options?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': `application/json`,
      ...options?.headers,
    },
    credentials: `include`, // Include cookies for auth
  })

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText }))
    throw new Error(error.error || `API request failed`)
  }

  return response.json()
}

// Issue API functions
export const issuesAPI = {
  getAll: () => fetchAPI(`/issues`),

  create: (data: {
    title: string
    description?: string
    priority: string
    status: string
    kanbanorder: string
  }) =>
    fetchAPI(`/issues`, {
      method: `POST`,
      body: JSON.stringify(data),
    }),

  update: (data: {
    id: string
    title?: string
    description?: string
    priority?: string
    status?: string
    kanbanorder?: string
  }) =>
    fetchAPI(`/issues/${data.id}`, {
      method: `PUT`,
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    fetchAPI(`/issues/${id}`, {
      method: `DELETE`,
    }),
}

// Comment API functions
export const commentsAPI = {
  getAll: (issueId?: string) => {
    const query = issueId ? `?issueId=${issueId}` : ``
    return fetchAPI(`/comments${query}`)
  },

  create: (data: { body: string; issue_id: string }) =>
    fetchAPI(`/comments`, {
      method: `POST`,
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    fetchAPI(`/comments/${id}`, {
      method: `DELETE`,
    }),
}
