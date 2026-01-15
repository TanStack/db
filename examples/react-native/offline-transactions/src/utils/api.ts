import { Platform } from 'react-native'

// Server URL differs by platform
// Android emulator: 10.0.2.2 maps to host machine's localhost
// iOS simulator: localhost works directly
const SERVER_PORT = 3001
const BASE_URL = Platform.select({
  android: `http://10.0.2.2:${SERVER_PORT}`,
  ios: `http://localhost:${SERVER_PORT}`,
  default: `http://localhost:${SERVER_PORT}`,
})

export interface Todo {
  id: string
  text: string
  completed: boolean
  createdAt: Date
  updatedAt: Date
}

interface TodoResponse {
  id: string
  text: string
  completed: boolean
  createdAt: string
  updatedAt: string
}

// Convert API response to Todo with Date objects
function parseTodo(todo: TodoResponse): Todo {
  return {
    ...todo,
    createdAt: new Date(todo.createdAt),
    updatedAt: new Date(todo.updatedAt),
  }
}

// API client that calls the shared backend server
export const todoApi = {
  async getAll(): Promise<Array<Todo>> {
    const response = await fetch(`${BASE_URL}/api/todos`)
    if (!response.ok) {
      throw new Error(`Failed to fetch todos: ${response.status}`)
    }
    const data: Array<TodoResponse> = await response.json()
    return data.map(parseTodo)
  },

  async create(data: { text: string; completed?: boolean }): Promise<Todo> {
    const response = await fetch(`${BASE_URL}/api/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!response.ok) {
      throw new Error(`Failed to create todo: ${response.status}`)
    }
    const todo: TodoResponse = await response.json()
    return parseTodo(todo)
  },

  async update(
    id: string,
    data: { text?: string; completed?: boolean }
  ): Promise<Todo | null> {
    const response = await fetch(`${BASE_URL}/api/todos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (response.status === 404) {
      return null
    }
    if (!response.ok) {
      throw new Error(`Failed to update todo: ${response.status}`)
    }
    const todo: TodoResponse = await response.json()
    return parseTodo(todo)
  },

  async delete(id: string): Promise<boolean> {
    const response = await fetch(`${BASE_URL}/api/todos/${id}`, {
      method: 'DELETE',
    })
    if (response.status === 404) {
      return false
    }
    if (!response.ok) {
      throw new Error(`Failed to delete todo: ${response.status}`)
    }
    return true
  },
}
