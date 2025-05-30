import type { UpdateConfig, UpdateTodo } from "../db/validation"

const API_BASE_URL = `http://localhost:3001/api`

export const api = {
  // Todo API methods
  todos: {
    create: async (
      todo: Partial<UpdateTodo>
    ): Promise<{ todo: UpdateTodo; txid: number }> => {
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
      changes: Partial<UpdateTodo>
    ): Promise<{ todo: UpdateTodo; txid: number }> => {
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
    create: async (
      config: Partial<UpdateConfig>
    ): Promise<{ config: UpdateConfig; txid: number }> => {
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
      changes: Partial<UpdateConfig>
    ): Promise<{ config: UpdateConfig; txid: number }> => {
      const response = await fetch(`${API_BASE_URL}/config/${id}`, {
        method: `PUT`,
        headers: { "Content-Type": `application/json` },
        body: JSON.stringify(changes),
      })
      if (!response.ok)
        throw new Error(`HTTP error! Status: ${response.status}`)
      return response.json()
    },
  },
}
