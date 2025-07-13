import { createCollection } from "@tanstack/react-db"
import { initializeDbDevtools } from "@tanstack/react-db-devtools"
import {
  electricCollectionOptions,
  queryCollectionOptions,
} from "@tanstack/db-collections"
import { QueryClient } from "@tanstack/query-core"
import { selectConfigSchema, selectTodoSchema } from "../db/validation"
import { api } from "./api"

// Create a query client for query collections
const queryClient = new QueryClient()

// Initialize DB devtools early (idempotent - safe to call multiple times)
console.log('🏗️ Collections.ts: Initializing devtools before creating collections...')
initializeDbDevtools()

// Electric Todo Collection
export const electricTodoCollection = createCollection(
  electricCollectionOptions({
    id: `todos`,
    shapeOptions: {
      url: `http://localhost:3003/v1/shape`,
      params: {
        table: `todos`,
      },
      parser: {
        timestamptz: (date: string) => new Date(date),
      },
    },
    getKey: (item) => item.id,
    schema: selectTodoSchema,
    onInsert: async ({ transaction }) => {
      const {
        id: _id,
        created_at: _f,
        updated_at: _ff,
        ...modified
      } = transaction.mutations[0].modified
      const response = await api.todos.create(modified)
      return { txid: response.txid }
    },
    onUpdate: async ({ transaction }) => {
      const txids = await Promise.all(
        transaction.mutations.map(async (mutation) => {
          const { original, changes } = mutation
          const response = await api.todos.update(original.id, changes)
          return response.txid
        })
      )
      return { txid: txids }
    },
    onDelete: async ({ transaction }) => {
      const txids = await Promise.all(
        transaction.mutations.map(async (mutation) => {
          const { original } = mutation
          const response = await api.todos.delete(original.id)
          return response.txid
        })
      )
      return { txid: txids }
    },
  })
)

// Query Todo Collection
export const queryTodoCollection = createCollection(
  queryCollectionOptions({
    id: `todos`,
    queryKey: [`todos`],
    refetchInterval: 3000,
    queryFn: async () => {
      const todos = await api.todos.getAll()
      return todos.map((todo) => ({
        ...todo,
        created_at: new Date(todo.created_at),
        updated_at: new Date(todo.updated_at),
      }))
    },
    getKey: (item) => item.id,
    schema: selectTodoSchema,
    queryClient,
    onInsert: async ({ transaction }) => {
      const {
        id: _id,
        created_at: _crea,
        updated_at: _up,
        ...modified
      } = transaction.mutations[0].modified
      return await api.todos.create(modified)
    },
    onUpdate: async ({ transaction }) => {
      return await Promise.all(
        transaction.mutations.map(async (mutation) => {
          const { original, changes } = mutation
          return await api.todos.update(original.id, changes)
        })
      )
    },
    onDelete: async ({ transaction }) => {
      return await Promise.all(
        transaction.mutations.map(async (mutation) => {
          const { original } = mutation
          await api.todos.delete(original.id)
        })
      )
    },
  })
)

// Electric Config Collection
export const electricConfigCollection = createCollection(
  electricCollectionOptions({
    id: `config`,
    shapeOptions: {
      url: `http://localhost:3003/v1/shape`,
      params: {
        table: `config`,
      },
      parser: {
        timestamptz: (date: string) => new Date(date),
      },
    },
    getKey: (item) => item.id,
    schema: selectConfigSchema,
    onInsert: async ({ transaction }) => {
      const modified = transaction.mutations[0].modified
      const response = await api.config.create(modified)
      return { txid: response.txid }
    },
    onUpdate: async ({ transaction }) => {
      const txids = await Promise.all(
        transaction.mutations.map(async (mutation) => {
          const { original, changes } = mutation
          const response = await api.config.update(original.id, changes)
          return response.txid
        })
      )
      return { txid: txids }
    },
  })
)

// Query Config Collection
export const queryConfigCollection = createCollection(
  queryCollectionOptions({
    id: `config`,
    queryKey: [`config`],
    refetchInterval: 3000,
    queryFn: async () => {
      const configs = await api.config.getAll()
      return configs.map((config) => ({
        ...config,
        created_at: new Date(config.created_at),
        updated_at: new Date(config.updated_at),
      }))
    },
    getKey: (item) => item.id,
    schema: selectConfigSchema,
    queryClient,
    onInsert: async ({ transaction }) => {
      const modified = transaction.mutations[0].modified
      const response = await api.config.create(modified)
      return { txid: response.txid }
    },
    onUpdate: async ({ transaction }) => {
      const txids = await Promise.all(
        transaction.mutations.map(async (mutation) => {
          const { original, changes } = mutation
          const response = await api.config.update(original.id, changes)
          return response.txid
        })
      )
      return { txid: txids }
    },
  })
)


