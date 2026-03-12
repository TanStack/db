import { Platform } from 'react-native'

const SERVER_PORT = 3001
const BASE_URL = Platform.select({
  android: `http://10.0.2.2:${SERVER_PORT}`,
  ios: `http://localhost:${SERVER_PORT}`,
  default: `http://localhost:${SERVER_PORT}`,
})

// ─── Types ──────────────────────────────────────────────

export interface ShoppingList {
  id: string
  name: string
  createdAt: Date
}

interface ShoppingListResponse {
  id: string
  name: string
  createdAt: string
}

export interface ShoppingItem {
  id: string
  listId: string
  text: string
  checked: boolean
  createdAt: Date
}

interface ShoppingItemResponse {
  id: string
  listId: string
  text: string
  checked: boolean
  createdAt: string
}

function parseList(list: ShoppingListResponse): ShoppingList {
  return { ...list, createdAt: new Date(list.createdAt) }
}

function parseItem(item: ShoppingItemResponse): ShoppingItem {
  return { ...item, createdAt: new Date(item.createdAt) }
}

// ─── Lists API ──────────────────────────────────────────

export const listsApi = {
  async getAll(): Promise<Array<ShoppingList>> {
    const response = await fetch(`${BASE_URL}/api/lists`)
    if (!response.ok)
      throw new Error(`Failed to fetch lists: ${response.status}`)
    const data: Array<ShoppingListResponse> = await response.json()
    return data.map(parseList)
  },

  async create(data: { id?: string; name: string }): Promise<ShoppingList> {
    const response = await fetch(`${BASE_URL}/api/lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!response.ok)
      throw new Error(`Failed to create list: ${response.status}`)
    return parseList(await response.json())
  },

  async update(
    id: string,
    data: { name?: string },
  ): Promise<ShoppingList | null> {
    const response = await fetch(`${BASE_URL}/api/lists/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (response.status === 404) return null
    if (!response.ok)
      throw new Error(`Failed to update list: ${response.status}`)
    return parseList(await response.json())
  },

  async delete(id: string): Promise<boolean> {
    const response = await fetch(`${BASE_URL}/api/lists/${id}`, {
      method: 'DELETE',
    })
    if (response.status === 404) return false
    if (!response.ok)
      throw new Error(`Failed to delete list: ${response.status}`)
    return true
  },
}

// ─── Items API ──────────────────────────────────────────

export const itemsApi = {
  async getAll(): Promise<Array<ShoppingItem>> {
    const response = await fetch(`${BASE_URL}/api/items`)
    if (!response.ok)
      throw new Error(`Failed to fetch items: ${response.status}`)
    const data: Array<ShoppingItemResponse> = await response.json()
    return data.map(parseItem)
  },

  async create(data: {
    id?: string
    listId: string
    text: string
    checked?: boolean
  }): Promise<ShoppingItem> {
    const response = await fetch(`${BASE_URL}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!response.ok)
      throw new Error(`Failed to create item: ${response.status}`)
    return parseItem(await response.json())
  },

  async update(
    id: string,
    data: { text?: string; checked?: boolean },
  ): Promise<ShoppingItem | null> {
    const response = await fetch(`${BASE_URL}/api/items/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (response.status === 404) return null
    if (!response.ok)
      throw new Error(`Failed to update item: ${response.status}`)
    return parseItem(await response.json())
  },

  async delete(id: string): Promise<boolean> {
    const response = await fetch(`${BASE_URL}/api/items/${id}`, {
      method: 'DELETE',
    })
    if (response.status === 404) return false
    if (!response.ok)
      throw new Error(`Failed to delete item: ${response.status}`)
    return true
  },
}
