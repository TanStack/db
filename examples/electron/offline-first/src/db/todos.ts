import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { startOfflineExecutor } from '@tanstack/offline-transactions'
import {
  createElectronSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/db-electron-sqlite-persisted-collection'
import { z } from 'zod'
import { queryClient } from '../utils/queryClient'
import type { StorageAdapter } from '@tanstack/offline-transactions'
import type { Todo } from '../utils/api'
import type { PendingMutation } from '@tanstack/db'

// Declare the electronAPI exposed via preload
declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, ...args: Array<unknown>) => Promise<unknown>
      resetDatabase: () => Promise<void>
      kv: {
        get: (key: string) => Promise<string | null>
        set: (key: string, value: string) => Promise<void>
        delete: (key: string) => Promise<void>
        keys: () => Promise<Array<string>>
        clear: () => Promise<void>
      }
    }
  }
}

/**
 * SQLite-backed storage adapter for the offline transactions outbox.
 * Stores pending mutations in the main process SQLite database via IPC,
 * so they survive app restarts (unlike IndexedDB in Electron).
 */
class ElectronSQLiteStorageAdapter implements StorageAdapter {
  private prefix: string

  constructor(prefix = 'offline-tx:') {
    this.prefix = prefix
  }

  private prefixedKey(key: string): string {
    return `${this.prefix}${key}`
  }

  async get(key: string): Promise<string | null> {
    return window.electronAPI.kv.get(this.prefixedKey(key))
  }

  async set(key: string, value: string): Promise<void> {
    await window.electronAPI.kv.set(this.prefixedKey(key), value)
  }

  async delete(key: string): Promise<void> {
    await window.electronAPI.kv.delete(this.prefixedKey(key))
  }

  async keys(): Promise<Array<string>> {
    const allKeys = await window.electronAPI.kv.keys()
    return allKeys
      .filter((k) => k.startsWith(this.prefix))
      .map((k) => k.slice(this.prefix.length))
  }

  async clear(): Promise<void> {
    const keys = await this.keys()
    for (const key of keys) {
      await window.electronAPI.kv.delete(this.prefixedKey(key))
    }
  }
}

/**
 * Fetch with retry and exponential backoff.
 * Keeps retrying on network errors and non-OK responses so the app
 * degrades gracefully when the server is temporarily unreachable.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryConfig: { retries?: number; delay?: number; backoff?: number } = {},
): Promise<Response> {
  const { retries = 6, delay = 1000, backoff = 2 } = retryConfig

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, options)
      if (response.ok) return response

      console.warn(
        `Fetch attempt ${i + 1} failed with status: ${response.status}. Retrying...`,
      )
    } catch (error) {
      console.error(
        `Fetch attempt ${i + 1} failed due to a network error:`,
        error,
      )
      if (i >= retries) throw error
    }

    if (i < retries) {
      const currentDelay = delay * Math.pow(backoff, i)
      await new Promise((resolve) => setTimeout(resolve, currentDelay))
    }
  }

  throw new Error(`Failed to fetch ${url} after ${retries} retries.`)
}

// Schema — use ISO strings for dates (SQLite-friendly)
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// Create persistence via IPC bridge to the main process SQLite database
const persistence = createElectronSQLitePersistence({
  invoke: window.electronAPI.invoke,
})

const BASE_URL = 'http://localhost:3001'

// Compose: query sync wrapped in persisted collection
const queryOpts = queryCollectionOptions({
  id: 'todos-collection',
  queryClient,
  queryKey: ['todos'],
  queryFn: async (): Promise<Array<Todo>> => {
    const response = await fetchWithRetry(`${BASE_URL}/api/todos`)
    if (!response.ok) {
      throw new Error(`Failed to fetch todos: ${response.status}`)
    }
    return response.json()
  },
  getKey: (item) => item.id,
  schema: todoSchema,
  refetchInterval: 3000,
})

// Sync function to push mutations to the backend
async function syncTodos({
  transaction,
  idempotencyKey,
}: {
  transaction: { mutations: Array<PendingMutation> }
  idempotencyKey: string
}) {
  const mutations = transaction.mutations

  console.log(`[Sync] Processing ${mutations.length} mutations`, idempotencyKey)

  for (const mutation of mutations) {
    try {
      switch (mutation.type) {
        case 'insert': {
          const todoData = mutation.modified as Todo
          const response = await fetchWithRetry(`${BASE_URL}/api/todos`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify({
              id: todoData.id,
              text: todoData.text,
              completed: todoData.completed,
            }),
          })
          if (!response.ok) {
            throw new Error(`Failed to sync insert: ${response.statusText}`)
          }
          break
        }

        case 'update': {
          const todoData = mutation.modified as Partial<Todo>
          const id = (mutation.modified as Todo).id
          const response = await fetchWithRetry(`${BASE_URL}/api/todos/${id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify({
              text: todoData.text,
              completed: todoData.completed,
            }),
          })
          if (!response.ok) {
            throw new Error(`Failed to sync update: ${response.statusText}`)
          }
          break
        }

        case 'delete': {
          const id = (mutation.original as Todo).id
          const response = await fetchWithRetry(`${BASE_URL}/api/todos/${id}`, {
            method: 'DELETE',
            headers: {
              'Idempotency-Key': idempotencyKey,
            },
          })
          if (!response.ok) {
            throw new Error(`Failed to sync delete: ${response.statusText}`)
          }
          break
        }
      }
    } catch (error) {
      console.error('[Sync] Error syncing mutation:', mutation, error)
      throw error
    }
  }

  // Refresh the collection after sync
  await collection.utils.refetch()
}

// Create the persisted collection
const collection = createCollection(
  persistedCollectionOptions({
    ...queryOpts,
    persistence,
    schemaVersion: 1,
  }),
)

// Create todos setup: collection + offline executor
export function createTodos() {
  const executor = startOfflineExecutor({
    collections: { todos: collection },
    storage: new ElectronSQLiteStorageAdapter('offline-tx:'),
    mutationFns: {
      syncTodos,
    },
    onLeadershipChange: (isLeader) => {
      console.log('[Offline] Leadership changed:', isLeader)
    },
    onStorageFailure: (diagnostic) => {
      console.warn('[Offline] Storage failure:', diagnostic)
    },
  })

  console.log('[Offline] Executor mode:', executor.mode)

  // Log when initialization completes and pending transactions are loaded
  executor
    .waitForInit()
    .then(() => {
      console.log(
        '[Offline] Init complete. isOfflineEnabled:',
        executor.isOfflineEnabled,
      )
      console.log('[Offline] Pending count:', executor.getPendingCount())
    })
    .catch((err) => {
      console.error('[Offline] Init failed:', err)
    })

  return {
    collection,
    executor,
    close: () => {
      executor.dispose()
    },
  }
}

// Helper to create offline actions
export function createTodoActions(
  offline: ReturnType<typeof createTodos>['executor'],
) {
  const addTodo = offline.createOfflineAction({
    mutationFnName: 'syncTodos',
    onMutate: (text: string) => {
      const now = new Date().toISOString()
      const newTodo: Todo = {
        id: crypto.randomUUID(),
        text: text.trim(),
        completed: false,
        createdAt: now,
        updatedAt: now,
      }
      collection.insert(newTodo)
      return newTodo
    },
  })

  const toggleTodo = offline.createOfflineAction({
    mutationFnName: 'syncTodos',
    onMutate: (id: string) => {
      const todo = collection.get(id)
      if (!todo) return
      collection.update(id, (draft) => {
        draft.completed = !draft.completed
        draft.updatedAt = new Date().toISOString()
      })
      return todo
    },
  })

  const deleteTodo = offline.createOfflineAction({
    mutationFnName: 'syncTodos',
    onMutate: (id: string) => {
      const todo = collection.get(id)
      if (todo) {
        collection.delete(id)
      }
      return todo
    },
  })

  return { addTodo, toggleTodo, deleteTodo }
}
