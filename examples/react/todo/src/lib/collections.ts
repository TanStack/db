import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { trailBaseCollectionOptions } from "@tanstack/trailbase-db-collection"
import { QueryClient } from "@tanstack/query-core"
import { initClient } from "trailbase"
import { selectConfigSchema, selectTodoSchema } from "../db/validation"
import { api } from "./api"
import type { SelectConfig, SelectTodo } from "../db/validation"

// Create a query client for query collections
const queryClient = new QueryClient()

// Create a TrailBase client.
const trailBaseClient = initClient(`http://localhost:4000`)

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

type Todo = {
  id: number
  text: string
  completed: boolean
  created_at: number
  updated_at: number
}

// TrailBase Todo Collection
export const trailBaseTodoCollection = createCollection(
  trailBaseCollectionOptions<SelectTodo, Todo>({
    id: `todos`,
    getKey: (item) => item.id,
    schema: selectTodoSchema,
    recordApi: trailBaseClient.records(`todos`),
    // Re-using the example's drizzle-schema requires remapping the items.
    parse: {
      created_at: (ts) => new Date(ts * 1000),
      updated_at: (ts) => new Date(ts * 1000),
    },
    serialize: {
      created_at: (date) => Math.floor(date.valueOf() / 1000),
      updated_at: (date) => Math.floor(date.valueOf() / 1000),
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

type Config = {
  id: number
  key: string
  value: string
  created_at: number
  updated_at: number
}

// TrailBase Config Collection
export const trailBaseConfigCollection = createCollection(
  trailBaseCollectionOptions<SelectConfig, Config>({
    id: `config`,
    getKey: (item) => item.id,
    schema: selectConfigSchema,
    recordApi: trailBaseClient.records(`config`),
    // Re-using the example's drizzle-schema requires remapping the items.
    parse: {
      created_at: (ts) => new Date(ts * 1000),
      updated_at: (ts) => new Date(ts * 1000),
    },
    serialize: {
      created_at: (date) => Math.floor(date.valueOf() / 1000),
      updated_at: (date) => Math.floor(date.valueOf() / 1000),
    },
  })
)
