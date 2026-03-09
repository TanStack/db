import { open } from '@op-engineering/op-sqlite'
import { createCollection } from '@tanstack/react-db'
import {
  createReactNativeSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/db-react-native-sqlite-persisted-collection'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { startOfflineExecutor } from '@tanstack/offline-transactions/react-native'
import { queryClient } from '../utils/queryClient'
import { todoApi } from '../utils/api'
import { AsyncStorageAdapter } from './AsyncStorageAdapter'
import type { Collection, PendingMutation } from '@tanstack/db'

export type Todo = {
  id: string
  text: string
  completed: boolean
  createdAt: string
  updatedAt: string
}

export type TodosHandle = {
  collection: Collection<Todo, string>
  executor: ReturnType<typeof startOfflineExecutor>
  close: () => void
}

export function createTodos(): TodosHandle {
  const database = open({
    name: `tanstack-db-demo.sqlite`,
    location: `default`,
  })

  const persistence = createReactNativeSQLitePersistence({ database })

  // Query collection options provide server sync (polling every 3s)
  const queryOpts = queryCollectionOptions<Todo, string>({
    id: `todos-collection`,
    queryClient,
    queryKey: [`todos`],
    queryFn: async (): Promise<Array<Todo>> => {
      const todos = await todoApi.getAll()
      // Convert Date objects from API to ISO strings for SQLite storage
      return todos.map((todo) => ({
        ...todo,
        createdAt: todo.createdAt.toISOString(),
        updatedAt: todo.updatedAt.toISOString(),
      }))
    },
    getKey: (item) => item.id,
    refetchInterval: 3000,
  })

  // Wrap query options with SQLite persistence — gives us both:
  // 1. Server sync via polling (from queryCollectionOptions)
  // 2. Local SQLite persistence (from persistedCollectionOptions)
  const collection = createCollection<Todo, string>(
    persistedCollectionOptions<Todo, string>({
      ...queryOpts,
      persistence,
      schemaVersion: 1,
    }),
  )

  // Sync function to push mutations to the backend
  async function syncTodos({
    transaction,
    idempotencyKey,
  }: {
    transaction: { mutations: Array<PendingMutation> }
    idempotencyKey: string
  }) {
    const mutations = transaction.mutations

    console.log(
      `[Sync] Processing ${mutations.length} mutations`,
      idempotencyKey,
    )

    for (const mutation of mutations) {
      try {
        switch (mutation.type) {
          case `insert`: {
            const todoData = mutation.modified as Todo
            await todoApi.create({
              id: todoData.id,
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

    // Refresh the collection after sync to pull latest server state
    await collection.utils.refetch()
  }

  const executor = startOfflineExecutor({
    collections: { todos: collection },
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

  return {
    collection,
    executor,
    close: () => {
      executor.dispose()
      database.close()
    },
  }
}

// Helper functions to create offline actions
export function createTodoActions(
  executor: TodosHandle[`executor`],
  collection: Collection<Todo, string>,
) {
  const addTodoAction = executor.createOfflineAction({
    mutationFnName: `syncTodos`,
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

  const toggleTodoAction = executor.createOfflineAction({
    mutationFnName: `syncTodos`,
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

  const deleteTodoAction = executor.createOfflineAction({
    mutationFnName: `syncTodos`,
    onMutate: (id: string) => {
      const todo = collection.get(id)
      if (todo) {
        collection.delete(id)
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
