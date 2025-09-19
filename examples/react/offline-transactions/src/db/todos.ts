import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import {
  IndexedDBAdapter,
  LocalStorageAdapter,
  startOfflineExecutor,
} from "@tanstack/offline-transactions"
import { z } from "zod"
import type { PendingMutation } from "@tanstack/db"
import type { Todo } from "~/utils/todos"
import { queryClient } from "~/utils/queryClient"

/**
 * A utility function to fetch data from a URL with built-in retry logic for non-200 responses.
 *
 * This function will automatically retry the GET request a specified number of times if the initial
 * fetch fails or returns a non-200 OK status. It uses an exponential backoff strategy to increase
 * the delay between retries, reducing the load on the server.
 *
 * @param url The URL to fetch.
 * @param options A standard `RequestInit` object for the fetch request. Note: Only 'GET' method is supported.
 * @param retryConfig An object with retry configuration.
 * @param retryConfig.retries The number of times to retry the request (default: 3).
 * @param retryConfig.delay The initial delay in milliseconds before the first retry (default: 1000).
 * @param retryConfig.backoff The backoff multiplier for subsequent retries (default: 2).
 * @returns A promise that resolves to the `Response` object if the fetch is successful.
 * @throws An error if the maximum number of retries is exceeded.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryConfig: { retries?: number; delay?: number; backoff?: number } = {}
): Promise<Response> {
  const { retries = 3, delay = 1000, backoff = 2 } = retryConfig

  // Ensure the request method is 'GET'
  if (options.method && options.method.toUpperCase() !== `GET`) {
    throw new Error(`This function only supports GET requests.`)
  }

  // Loop for the specified number of retries
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, { ...options, method: `GET` })

      // If the response is OK, return it immediately
      if (response.ok) {
        return response
      }

      // If it's a non-200 response, log the status and prepare to retry
      console.warn(
        `Fetch attempt ${i + 1} failed with status: ${response.status}. Retrying...`
      )

      // Wait before the next attempt, with exponential backoff
      if (i < retries) {
        const currentDelay = delay * Math.pow(backoff, i)
        await new Promise((resolve) => setTimeout(resolve, currentDelay))
      }
    } catch (error) {
      // Catch network errors and log a message
      console.error(
        `Fetch attempt ${i + 1} failed due to a network error:`,
        error
      )

      // Wait before the next attempt, with exponential backoff
      if (i < retries) {
        const currentDelay = delay * Math.pow(backoff, i)
        await new Promise((resolve) => setTimeout(resolve, currentDelay))
      } else {
        // If all retries have failed, re-throw the original error
        throw error
      }
    }
  }

  // If the loop completes without a successful response, throw a final error
  throw new Error(`Failed to fetch ${url} after ${retries} retries.`)
}

// Define schema
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

// Create the todo collection
export const todoCollection = createCollection(
  queryCollectionOptions({
    queryClient,
    queryKey: [`todos`],
    queryFn: async (): Promise<Array<Todo>> => {
      const response = await fetchWithRetry(`/api/todos`)
      if (!response.ok) {
        throw new Error(`Failed to fetch todos`)
      }
      const data = await response.json()
      const res = data.map((todo: any) => ({
        ...todo,
        createdAt: new Date(todo.createdAt),
        updatedAt: new Date(todo.updatedAt),
      }))
      console.log(`data returning from queryFn`, res)
      return res
    },
    getKey: (item) => item.id,
    schema: todoSchema,
  })
)

// API client functions
export const todoAPI = {
  async syncTodos({
    transaction,
    idempotencyKey,
  }: {
    transaction: { mutations: Array<PendingMutation> }
    idempotencyKey: string
  }) {
    const mutations = transaction.mutations

    for (const mutation of mutations) {
      try {
        switch (mutation.type) {
          case `insert`: {
            const todoData = mutation.modified as Todo
            const response = await fetch(`/api/todos`, {
              method: `POST`,
              headers: {
                "Content-Type": `application/json`,
                "Idempotency-Key": idempotencyKey,
              },
              body: JSON.stringify({
                text: todoData.text,
                completed: todoData.completed,
              }),
            })

            if (!response.ok) {
              throw new Error(`Failed to sync insert: ${response.statusText}`)
            }
            break
          }

          case `update`: {
            const todoData = mutation.modified as Partial<Todo>
            const response = await fetch(
              `/api/todos/${(mutation.modified as Todo).id}`,
              {
                method: `PUT`,
                headers: {
                  "Content-Type": `application/json`,
                  "Idempotency-Key": idempotencyKey,
                },
                body: JSON.stringify({
                  text: todoData.text,
                  completed: todoData.completed,
                }),
              }
            )

            if (!response.ok) {
              throw new Error(`Failed to sync update: ${response.statusText}`)
            }
            break
          }

          case `delete`: {
            const response = await fetch(
              `/api/todos/${(mutation.original as Todo).id}`,
              {
                method: `DELETE`,
                headers: {
                  "Idempotency-Key": idempotencyKey,
                },
              }
            )

            if (!response.ok) {
              throw new Error(`Failed to sync delete: ${response.statusText}`)
            }
            break
          }
        }
      } catch (error) {
        console.error(`Sync error for mutation:`, mutation, error)
        throw error
      }
    }
    await todoCollection.utils.refetch()
  },
}

// Helper functions to create offline actions
export function createTodoActions(offline: any) {
  const addTodoAction = offline?.createOfflineAction({
    mutationFnName: `syncTodos`,
    onMutate: (text: string) => {
      const newTodo = {
        id: crypto.randomUUID(),
        text: text.trim(),
        completed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      todoCollection.insert(newTodo)
      return newTodo
    },
  })

  const toggleTodoAction = offline?.createOfflineAction({
    mutationFnName: `syncTodos`,
    onMutate: (id: string) => {
      const todo = todoCollection.get(id)
      if (!todo) return
      todoCollection.update(id, (draft) => {
        console.log(
          `inside update`,
          draft.text,
          draft.completed,
          todo.completed
        )
        draft.completed = !draft.completed
        draft.updatedAt = new Date()
      })
      return todo
    },
  })

  const deleteTodoAction = offline?.createOfflineAction({
    mutationFnName: `syncTodos`,
    onMutate: (id: string) => {
      const todo = todoCollection.get(id)
      if (todo) {
        todoCollection.delete(id)
      }
      return todo
    },
  })

  return {
    addTodo: addTodoAction,
    toggleTodo: toggleTodoAction,
    deleteTodo: deleteTodoAction,
  }
}

// IndexedDB offline executor
export function createIndexedDBOfflineExecutor() {
  return startOfflineExecutor({
    collections: { todos: todoCollection },
    storage: new IndexedDBAdapter(`offline-todos-indexeddb`, `transactions`),
    mutationFns: {
      syncTodos: todoAPI.syncTodos,
    },
    onLeadershipChange: (isLeader) => {
      console.log(`IndexedDB executor leadership changed:`, isLeader)
      if (!isLeader) {
        console.warn(`Running in online-only mode (another tab is the leader)`)
      }
    },
  })
}

// localStorage offline executor
export function createLocalStorageOfflineExecutor() {
  return startOfflineExecutor({
    collections: { todos: todoCollection },
    storage: new LocalStorageAdapter(`offline-todos-ls:`),
    mutationFns: {
      syncTodos: todoAPI.syncTodos,
    },
    onLeadershipChange: (isLeader) => {
      console.log(`localStorage executor leadership changed:`, isLeader)
      if (!isLeader) {
        console.warn(`Running in online-only mode (another tab is the leader)`)
      }
    },
  })
}
