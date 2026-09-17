const BASE_URL = 'http://localhost:3001'

export interface Todo {
  id: string
  text: string
  completed: boolean
  createdAt: string
  updatedAt: string
}

export const todoApi = {
  async getAll(): Promise<Array<Todo>> {
    const response = await fetch(`${BASE_URL}/api/todos`)
    if (!response.ok) {
      throw new Error(`Failed to fetch todos: ${response.status}`)
    }
    return response.json()
  },

  async create(data: {
    id: string
    text: string
    completed?: boolean
  }): Promise<Todo> {
    const response = await fetch(`${BASE_URL}/api/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!response.ok) {
      throw new Error(`Failed to create todo: ${response.status}`)
    }
    return response.json()
  },

  async update(
    id: string,
    data: { text?: string; completed?: boolean },
  ): Promise<Todo | null> {
    const response = await fetch(`${BASE_URL}/api/todos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Failed to update todo: ${response.status}`)
    }
    return response.json()
  },

  async delete(id: string): Promise<boolean> {
    const response = await fetch(`${BASE_URL}/api/todos/${id}`, {
      method: 'DELETE',
    })
    if (response.status === 404) return false
    if (!response.ok) {
      throw new Error(`Failed to delete todo: ${response.status}`)
    }
    return true
  },

  async deleteAll(): Promise<void> {
    const response = await fetch(`${BASE_URL}/api/todos`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      throw new Error(`Failed to delete all todos: ${response.status}`)
    }
  },
}
