import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { startOfflineExecutor } from '@tanstack/offline-transactions/react-native'
import { z } from 'zod'
import { queryClient } from '../utils/queryClient'
import {  todoApi } from '../utils/api'
import { AsyncStorageAdapter } from './AsyncStorageAdapter'
import type {Todo} from '../utils/api';
import type { PendingMutation } from '@tanstack/db'

// Define schema
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

// Create the todo collection with polling to sync changes from other devices
export const todoCollection = createCollection(
  queryCollectionOptions({
    id: `todos-collection`, // Explicit ID to avoid crypto.randomUUID() on RN
    queryClient,
    queryKey: [`todos`],
    queryFn: async (): Promise<Array<Todo>> => {
      const todos = await todoApi.getAll()
      return todos
    },
    getKey: (item) => item.id,
    schema: todoSchema,
    // Poll every 3 seconds to sync changes from other devices
    refetchInterval: 3000,
  })
)

// Sync function to push mutations to the "backend"
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
        case `insert`: {
          const todoData = mutation.modified as Todo
          await todoApi.create({
            text: todoData.text,
            completed: todoData.completed,
          })
          break
        }

        case `update`: {
          const todoData = mutation.modified as Partial<Todo>
          const id = (mutation.modified as Todo).id
          await todoApi.update(id, {
            text: todoData.text,
            completed: todoData.completed,
          })
          break
        }

        case `delete`: {
          const id = (mutation.original as Todo).id
          await todoApi.delete(id)
          break
        }
      }
    } catch (error) {
      console.error(`[Sync] Error syncing mutation:`, mutation, error)
      throw error
    }
  }

  // Refresh the collection after sync
  await todoCollection.utils.refetch()
}

// Create the offline executor with React Native support
export function createOfflineExecutor() {
  console.log(`[Offline] Creating executor with AsyncStorage adapter`)

  const executor = startOfflineExecutor({
    collections: { todos: todoCollection },
    storage: new AsyncStorageAdapter(`offline-todos:`),
    mutationFns: {
      syncTodos,
    },
    onLeadershipChange: (isLeader) => {
      console.log(`[Offline] Leadership changed:`, isLeader)
    },
    onStorageFailure: (diagnostic) => {
      console.warn(`[Offline] Storage failure:`, diagnostic)
    },
  })

  console.log(`[Offline] Executor mode:`, executor.mode)
  console.log(`[Offline] Storage diagnostic:`, executor.storageDiagnostic)

  return executor
}

// Helper functions to create offline actions
export function createTodoActions(offline: ReturnType<typeof createOfflineExecutor> | null) {
  if (!offline) {
    return {
      addTodo: null,
      toggleTodo: null,
      deleteTodo: null,
    }
  }

  const addTodoAction = offline.createOfflineAction({
    mutationFnName: `syncTodos`,
    onMutate: (text: string) => {
      // Use Math.random based ID generation (crypto.randomUUID not available on RN Hermes)
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`
      const newTodo = {
        id,
        text: text.trim(),
        completed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      todoCollection.insert(newTodo)
      return newTodo
    },
  })

  const toggleTodoAction = offline.createOfflineAction({
    mutationFnName: `syncTodos`,
    onMutate: (id: string) => {
      const todo = todoCollection.get(id)
      if (!todo) return
      todoCollection.update(id, (draft) => {
        draft.completed = !draft.completed
        draft.updatedAt = new Date()
      })
      return todo
    },
  })

  const deleteTodoAction = offline.createOfflineAction({
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
