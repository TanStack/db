import type { SelectConfig, SelectTodo } from "../db/validation"

// API helper for todos and config
const API_BASE_URL = `/api`

export const api = {
  // Todo API methods
  todos: {
    getAll: async (): Promise<Array<SelectTodo>> => {
      const response = await fetch(`${API_BASE_URL}/todos`)
      if (!response.ok)
        throw new Error(`HTTP error! Status: ${response.status}`)
      return response.json()
    },
    getById: async (id: number): Promise<SelectTodo> => {
      const response = await fetch(`${API_BASE_URL}/todos/${id}`)
      if (!response.ok)
        throw new Error(`HTTP error! Status: ${response.status}`)
      return response.json()
    },
    create: async (
      todo: Partial<SelectTodo>
    ): Promise<{ todo: SelectTodo; txid: number }> => {
      const response = await fetch(`${API_BASE_URL}/todos`, {
        method: `POST`,
        headers: { "Content-Type": `application/json` },
        body: JSON.stringify(todo),
      })
      if (!response.ok)
        throw new Error(`HTTP error! Status: ${response.status}`)
      return response.json()
    },
    update: async (
      id: unknown,
      changes: Partial<SelectTodo>
    ): Promise<{ todo: SelectTodo; txid: number }> => {
      const response = await fetch(`${API_BASE_URL}/todos/${id}`, {
        method: `PUT`,
        headers: { "Content-Type": `application/json` },
        body: JSON.stringify(changes),
      })
      if (!response.ok)
        throw new Error(`HTTP error! Status: ${response.status}`)
      return response.json()
    },
    delete: async (
      id: unknown
    ): Promise<{ success: boolean; txid: number }> => {
      const response = await fetch(`${API_BASE_URL}/todos/${id}`, {
        method: `DELETE`,
      })
      if (!response.ok)
        throw new Error(`HTTP error! Status: ${response.status}`)
      return response.json()
    },
  },

  // Config API methods
  config: {
    getAll: async (): Promise<Array<SelectConfig>> => {
      const response = await fetch(`${API_BASE_URL}/config`)
      if (!response.ok)
        throw new Error(`HTTP error! Status: ${response.status}`)
      return response.json()
    },
    getById: async (id: number): Promise<SelectConfig> => {
      const response = await fetch(`${API_BASE_URL}/config/${id}`)
      if (!response.ok)
        throw new Error(`HTTP error! Status: ${response.status}`)
      return response.json()
    },
    create: async (
      config: Partial<SelectConfig>
    ): Promise<{ config: SelectConfig; txid: number }> => {
      const response = await fetch(`${API_BASE_URL}/config`, {
        method: `POST`,
        headers: { "Content-Type": `application/json` },
        body: JSON.stringify(config),
      })
      if (!response.ok)
        throw new Error(`HTTP error! Status: ${response.status}`)
      return response.json()
    },
    update: async (
      id: number,
      changes: Partial<SelectConfig>
    ): Promise<{ config: SelectConfig; txid: number }> => {
      const response = await fetch(`${API_BASE_URL}/config/${id}`, {
        method: `PUT`,
        headers: { "Content-Type": `application/json` },
        body: JSON.stringify(changes),
      })
      if (!response.ok)
        throw new Error(`HTTP error! Status: ${response.status}`)
      return response.json()
    },
    delete: async (id: number): Promise<{ success: boolean; txid: number }> => {
      const response = await fetch(`${API_BASE_URL}/config/${id}`, {
        method: `DELETE`,
      })
      if (!response.ok)
        throw new Error(`HTTP error! Status: ${response.status}`)
      return response.json()
    },
  },
}
