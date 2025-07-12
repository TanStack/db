import React, { useState } from "react"
import { createCollection, useLiveQuery } from "@tanstack/react-db"
import {
  electricCollectionOptions,
  queryCollectionOptions,
} from "@tanstack/db-collections"
import { ReactDbDevtools } from "@tanstack/react-db-devtools"
import { QueryClient } from "@tanstack/query-core"
import { selectConfigSchema, selectTodoSchema } from "./db/validation"
import type { Collection } from "@tanstack/react-db"
import type { SelectConfig, SelectTodo } from "./db/validation"
import type { FormEvent } from "react"

// API helper for todos and config
const API_BASE_URL = `/api`

const api = {
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

// Collection type enum
enum CollectionType {
  Electric = `electric`,
  Query = `query`,
}

// Create a query client for query collections
const queryClient = new QueryClient()

// Cache for collections and their utility functions
const collectionsCache = new Map()
// Function to create the appropriate todo collection based on type
const createTodoCollection = (type: CollectionType) => {
  if (collectionsCache.has(`todo`)) {
    return collectionsCache.get(`todo`) as Collection<SelectTodo>
  } else {
    let newCollection: Collection<SelectTodo>
    if (type === CollectionType.Electric) {
      newCollection = createCollection(
        electricCollectionOptions({
          id: `todos`,
          shapeOptions: {
            url: `http://localhost:3003/v1/shape`,
            params: {
              table: `todos`,
            },
            parser: {
              // Parse timestamp columns into JavaScript Date objects
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
    } else {
      // Query collection using our API helper
      newCollection = createCollection(
        queryCollectionOptions({
          id: `todos`,
          queryKey: [`todos`],
          refetchInterval: 3000,
          queryFn: async () => {
            const todos = await api.todos.getAll()
            // Turn date strings into Dates
            return todos.map((todo) => ({
              ...todo,
              created_at: new Date(todo.created_at),
              updated_at: new Date(todo.updated_at),
            }))
          },
          getKey: (item: SelectTodo) => item.id,
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
    }
    collectionsCache.set(`todo`, newCollection)
    return newCollection
  }
}

// Function to create the appropriate config collection based on type
const createConfigCollection = (type: CollectionType) => {
  if (collectionsCache.has(`config`)) {
    return collectionsCache.get(`config`) as Collection<SelectConfig>
  } else {
    let newCollection: Collection<SelectConfig>
    if (type === CollectionType.Electric) {
      newCollection = createCollection(
        electricCollectionOptions({
          id: `config`,
          shapeOptions: {
            url: `http://localhost:3003/v1/shape`,
            params: {
              table: `config`,
            },
            parser: {
              // Parse timestamp columns into JavaScript Date objects
              timestamptz: (date: string) => {
                return new Date(date)
              },
            },
          },
          getKey: (item: SelectConfig) => item.id,
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
    } else {
      // Query collection using our API helper
      newCollection = createCollection(
        queryCollectionOptions({
          id: `config`,
          queryKey: [`config`],
          refetchInterval: 3000,
          queryFn: async () => {
            const configs = await api.config.getAll()
            // Turn date strings into Dates
            return configs.map((config) => ({
              ...config,
              created_at: new Date(config.created_at),
              updated_at: new Date(config.updated_at),
            }))
          },
          getKey: (item: SelectConfig) => item.id,
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
    }
    collectionsCache.set(`config`, newCollection)
    return newCollection
  }
}

export default function App() {
  // Read collection type from URL param directly
  const getInitialCollectionType = (): CollectionType => {
    const params = new URLSearchParams(window.location.search)
    return params.get(`type`) === `electric`
      ? CollectionType.Electric
      : CollectionType.Query
  }

  const collectionType = getInitialCollectionType()
  const [newTodo, setNewTodo] = useState(``)

  // Create collections
  const todoCollection = createTodoCollection(collectionType)
  const configCollection = createConfigCollection(collectionType)

  // Always call useLiveQuery hooks
  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .orderBy(({ todo }) => todo.created_at, `asc`)
  )

  const { data: configData } = useLiveQuery((q) =>
    q.from({ config: configCollection })
  )

  // Handle collection type change directly
  const handleCollectionTypeChange = (type: CollectionType) => {
    if (type !== collectionType) {
      // Update URL and reload page
      const url = new URL(window.location.href)
      url.searchParams.set(`type`, type)
      window.location.href = url.toString()
    }
  }

  // Define a more robust type-safe helper function to get config values
  const getConfigValue = (key: string): string => {
    for (const config of configData) {
      if (config.key === key) {
        return config.value
      }
    }
    return ``
  }

  // Define a helper function to update config values
  const setConfigValue = (key: string, value: string): void => {
    console.log(`setConfigValue`, key, value)
    console.log(`configData`, configData)
    for (const config of configData) {
      if (config.key === key) {
        configCollection.update(config.id, (draft) => {
          draft.value = value
        })

        return
      }
    }

    // If the config doesn't exist yet, create it
    configCollection.insert({
      id: Math.round(Math.random() * 1000000),
      key,
      value,
      created_at: new Date(),
      updated_at: new Date(),
    })
  }

  const backgroundColor = getConfigValue(`backgroundColor`)

  // Function to generate a complementary color
  const getComplementaryColor = (hexColor: string): string => {
    // Default to a nice blue if no color is provided
    if (!hexColor) return `#3498db`

    // Remove the hash if it exists
    const color = hexColor.replace(`#`, ``)

    // Convert hex to RGB
    const r = parseInt(color.substr(0, 2), 16)
    const g = parseInt(color.substr(2, 2), 16)
    const b = parseInt(color.substr(4, 2), 16)

    // Calculate complementary color (inverting the RGB values)
    const compR = 255 - r
    const compG = 255 - g
    const compB = 255 - b

    // Convert back to hex
    const compHex =
      `#` +
      ((1 << 24) + (compR << 16) + (compG << 8) + compB).toString(16).slice(1)

    // Calculate brightness of the background
    const brightness = r * 0.299 + g * 0.587 + b * 0.114

    // If the complementary color doesn't have enough contrast, adjust it
    const compBrightness = compR * 0.299 + compG * 0.587 + compB * 0.114
    const brightnessDiff = Math.abs(brightness - compBrightness)

    if (brightnessDiff < 128) {
      // Not enough contrast, use a more vibrant alternative
      if (brightness > 128) {
        // Dark color for light background
        return `#8e44ad` // Purple
      } else {
        // Light color for dark background
        return `#f1c40f` // Yellow
      }
    }

    return compHex
  }

  const titleColor = getComplementaryColor(backgroundColor)

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value
    setConfigValue(`backgroundColor`, newColor)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!newTodo.trim()) return

    todoCollection.insert({
      text: newTodo,
      completed: false,
      id: Math.round(Math.random() * 1000000),
      created_at: new Date(),
      updated_at: new Date(),
    })
    setNewTodo(``)
  }

  const activeTodos = todos.filter((todo) => !todo.completed)
  const completedTodos = todos.filter((todo) => todo.completed)

  return (
    <>
      <div
        className="min-h-screen flex items-start justify-center overflow-auto py-8"
        style={{ backgroundColor }}
      >
        <div style={{ width: 550 }} className="mx-auto relative">
          <h1
            className="text-[100px] font-bold text-center mb-8"
            style={{ color: titleColor }}
          >
            todos
          </h1>

          {/* Collection Type Selector */}
          <div className="mb-6 flex justify-center">
            <div className="flex flex-col bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200">
              <div className="px-4 py-2 bg-gray-100 border-b border-gray-200 text-center">
                <span className="text-sm font-semibold text-gray-700">
                  Collection Type
                </span>
              </div>
              <div className="flex">
                <button
                  onClick={() =>
                    handleCollectionTypeChange(CollectionType.Query)
                  }
                  className={`relative px-6 py-3 text-sm font-medium transition-all duration-200 ${
                    collectionType === CollectionType.Query
                      ? `text-blue-600 bg-blue-50`
                      : `text-gray-600 hover:bg-gray-50`
                  }`}
                >
                  <span>Query</span>
                  {collectionType === CollectionType.Query && (
                    <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-600"></span>
                  )}
                </button>
                <button
                  onClick={() =>
                    handleCollectionTypeChange(CollectionType.Electric)
                  }
                  className={`relative px-6 py-3 text-sm font-medium transition-all duration-200 ${
                    collectionType === CollectionType.Electric
                      ? `text-blue-600 bg-blue-50`
                      : `text-gray-600 hover:bg-gray-50`
                  }`}
                >
                  <span>Electric</span>
                  {collectionType === CollectionType.Electric && (
                    <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-600"></span>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="mb-4 flex justify-end">
            <div className="flex items-center">
              <label
                htmlFor="colorPicker"
                className="mr-2 text-sm font-medium text-gray-700"
                style={{ color: titleColor }}
              >
                Background Color:
              </label>
              <input
                type="color"
                id="colorPicker"
                value={backgroundColor}
                onChange={handleColorChange}
                className="cursor-pointer border border-gray-300 rounded"
              />
            </div>
          </div>

          <div className="bg-white shadow-[0_2px_4px_0_rgba(0,0,0,0.2),0_25px_50px_0_rgba(0,0,0,0.1)] relative">
            <form onSubmit={handleSubmit} className="relative">
              {todos.length > 0 && (
                <button
                  type="button"
                  className="absolute left-0 w-12 h-full text-[30px] text-[#e6e6e6] hover:text-[#4d4d4d]"
                  onClick={() => {
                    const allCompleted = completedTodos.length === todos.length
                    const todosToToggle = allCompleted
                      ? completedTodos
                      : activeTodos
                    const togglingIds = new Set()
                    todosToToggle.forEach((t) => togglingIds.add(t.id))
                    todoCollection.update(
                      todosToToggle.map((todo) => todo.id),
                      (drafts) => {
                        drafts.forEach(
                          (draft) => (draft.completed = !allCompleted)
                        )
                      }
                    )
                  }}
                >
                  ❯
                </button>
              )}
              <input
                type="text"
                value={newTodo}
                onChange={(e) => setNewTodo(e.target.value)}
                placeholder="What needs to be done?"
                className="w-full py-4 pl-[60px] pr-4 text-2xl font-light border-none shadow-[inset_0_-2px_1px_rgba(0,0,0,0.03)] box-border"
                style={{
                  background: `rgba(0, 0, 0, 0.003)`,
                }}
              />
            </form>

            {todos.length > 0 && (
              <>
                <ul className="my-0 mx-0 p-0 list-none">
                  {todos.map((todo) => (
                    <li
                      key={`todo-${todo.id}`}
                      className="relative border-b border-[#ededed] last:border-none group"
                    >
                      <div className="flex items-center h-[58px] pl-[60px]">
                        <input
                          type="checkbox"
                          checked={todo.completed}
                          onChange={() =>
                            todoCollection.update(todo.id, (draft) => {
                              draft.completed = !draft.completed
                            })
                          }
                          className="absolute left-[12px] top-0 bottom-0 my-auto h-[40px] w-[40px] cursor-pointer"
                        />
                        <label
                          className={`block leading-[1.2] py-[15px] px-[15px] text-2xl transition-colors ${
                            todo.completed ? `text-[#d9d9d9] line-through` : ``
                          }`}
                        >
                          {todo.text}
                        </label>
                        <button
                          onClick={() => {
                            todoCollection.delete(todo.id)
                          }}
                          className="hidden group-hover:block absolute right-[10px] w-[40px] h-[40px] my-auto top-0 bottom-0 text-[30px] text-[#cc9a9a] hover:text-[#af5b5e] transition-colors"
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>

                <footer className="text-[14px] text-[#777] py-[10px] px-[15px] h-[40px] relative border-t border-[#e6e6e6] flex justify-between items-center">
                  <span className="text-[inherit]">
                    {activeTodos.length}
                    {` `}
                    {activeTodos.length === 1 ? `item` : `items`} left
                  </span>
                  {completedTodos.length > 0 && (
                    <button
                      onClick={() => {
                        todoCollection.delete(
                          completedTodos.map((todo) => todo.id)
                        )
                      }}
                      className="text-inherit hover:underline"
                    >
                      Clear completed
                    </button>
                  )}
                </footer>
              </>
            )}
          </div>
        </div>
      </div>
      <ReactDbDevtools />
    </>
  )
}
