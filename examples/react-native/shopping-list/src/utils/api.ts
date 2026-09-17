import { Platform } from 'react-native'
import { createOfflineAwareFetch } from '../network/simulatedOffline'

const SERVER_PORT = 3001
export const API_URL = Platform.select({
  android: `http://10.0.2.2:${SERVER_PORT}`,
  ios: `http://localhost:${SERVER_PORT}`,
  default: `http://localhost:${SERVER_PORT}`,
})
const offlineAwareFetch = createOfflineAwareFetch(fetch)

// ─── Types ──────────────────────────────────────────────

export interface ShoppingList {
  id: string
  name: string
  createdAt: string
}

export interface ShoppingItem {
  id: string
  listId: string
  text: string
  checked: boolean
  createdAt: string
}

type ApiTxResult<T> = { txid: number } & T

// ─── Lists API ──────────────────────────────────────────

export const listsApi = {
  async getAll(): Promise<Array<ShoppingList>> {
    const response = await offlineAwareFetch(`${API_URL}/api/lists`)
    if (!response.ok) {
      throw new Error(`Failed to fetch lists: ${response.status}`)
    }
    return response.json()
  },

  async create(data: {
    id?: string
    name: string
    createdAt?: string
  }): Promise<ApiTxResult<{ list: ShoppingList }>> {
    const response = await offlineAwareFetch(`${API_URL}/api/lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!response.ok) {
      throw new Error(`Failed to create list: ${response.status}`)
    }
    return response.json()
  },

  async update(
    id: string,
    data: { name?: string },
  ): Promise<ApiTxResult<{ list: ShoppingList }> | null> {
    const response = await offlineAwareFetch(`${API_URL}/api/lists/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Failed to update list: ${response.status}`)
    }
    return response.json()
  },

  async delete(id: string): Promise<ApiTxResult<{ success: boolean }> | null> {
    const response = await offlineAwareFetch(`${API_URL}/api/lists/${id}`, {
      method: 'DELETE',
    })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Failed to delete list: ${response.status}`)
    }
    return response.json()
  },
}

// ─── Items API ──────────────────────────────────────────

export const itemsApi = {
  async getAll(): Promise<Array<ShoppingItem>> {
    const response = await offlineAwareFetch(`${API_URL}/api/items`)
    if (!response.ok) {
      throw new Error(`Failed to fetch items: ${response.status}`)
    }
    return response.json()
  },

  async create(data: {
    id?: string
    listId: string
    text: string
    checked?: boolean
    createdAt?: string
  }): Promise<ApiTxResult<{ item: ShoppingItem }>> {
    const response = await offlineAwareFetch(`${API_URL}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!response.ok) {
      throw new Error(`Failed to create item: ${response.status}`)
    }
    return response.json()
  },

  async update(
    id: string,
    data: { text?: string; checked?: boolean },
  ): Promise<ApiTxResult<{ item: ShoppingItem }> | null> {
    const response = await offlineAwareFetch(`${API_URL}/api/items/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Failed to update item: ${response.status}`)
    }
    return response.json()
  },

  async delete(id: string): Promise<ApiTxResult<{ success: boolean }> | null> {
    const response = await offlineAwareFetch(`${API_URL}/api/items/${id}`, {
      method: 'DELETE',
    })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Failed to delete item: ${response.status}`)
    }
    return response.json()
  },
}
