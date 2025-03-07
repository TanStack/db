import React, { useState, FormEvent } from "react"
import { useCollection } from "../../src/useCollection"
import { Collection } from "../../src/collection"
import { createElectricSync } from "../../src/lib/electric"
import { DevTools } from "./DevTools"
import { UpdateTodo, UpdateConfig } from "./db/validation"
import { updateConfigSchema, updateTodoSchema } from "./db/validation"

export default function App() {
  const [newTodo, setNewTodo] = useState(``)

  const {
    data: todos,
    insert,
    update,
    delete: deleteTodo,
  } = useCollection<UpdateTodo>({
    id: `todos`,
    sync: createElectricSync(
      {
        url: `http://localhost:3000/v1/shape`,
        params: {
          table: `todos`,
        },
        parser: {
          // Parse timestamp columns into JavaScript Date objects
          timestamptz: (date: string) => new Date(date),
        },
      },
      { primaryKey: [`id`] }
    ),
    schema: updateTodoSchema,
    mutationFn: {
      persist: async ({ transaction }) => {
        const response = await fetch(`http://localhost:3001/api/mutations`, {
          method: `POST`,
          headers: {
            "Content-Type": `application/json`,
          },
          body: JSON.stringify(transaction.mutations),
        })
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`)
        }

        const result = await response.json()
        return {
          txid: result.txid,
        }
      },
      awaitSync: async ({
        persistResult,
        collection,
      }: {
        persistResult: { txid: number }
        collection: Collection
      }) => {
        // Start waiting for the txid
        await collection.config.sync.awaitTxid(persistResult.txid)
      },
    },
  })

  const {
    data: configData,
    update: updateConfig,
    insert: insertConfig,
  } = useCollection<UpdateConfig>({
    id: `config`,
    sync: createElectricSync(
      {
        url: `http://localhost:3000/v1/shape`,
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
      { primaryKey: [`id`] }
    ),
    schema: updateConfigSchema,
    mutationFn: {
      persist: async ({ transaction }) => {
        const response = await fetch(`http://localhost:3001/api/mutations`, {
          method: `POST`,
          headers: {
            "Content-Type": `application/json`,
          },
          body: JSON.stringify(transaction.mutations),
        })
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`)
        }

        const result = await response.json()
        return {
          txid: result.txid,
        }
      },
      awaitSync: async ({
        persistResult,
        collection,
      }: {
        persistResult: { txid: number }
        collection: Collection
      }) => {
        // Start waiting for the txid
        await collection.config.sync.awaitTxid(persistResult.txid)
      },
    },
  })

  // Define a more robust type-safe helper function to get config values
  const getConfigValue = (key: string): string => {
    for (const config of configData) {
      if (config.key === key) {
        return config.value!
      }
    }
    return ``
  }

  // Define a helper function to update config values
  const setConfigValue = (key: string, value: string): void => {
    for (const config of configData) {
      if (config.key === key) {
        updateConfig(config, (draft) => {
          draft.value = value
        })

        return
      }
    }

    // If the config doesn't exist yet, create it
    insertConfig({
      key,
      value,
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

  const handleColorChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value
    setConfigValue(`backgroundColor`, newColor)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!newTodo.trim()) return

    insert({
      text: newTodo,
      completed: false,
    })
    setNewTodo(``)
  }

  const toggleTodo = (todo: UpdateTodo) => {
    update(todo, (draft) => {
      draft.completed = !draft.completed
    })
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
                  onClick={async () => {
                    const allCompleted = completedTodos.length === todos.length
                    update(
                      allCompleted ? completedTodos : activeTodos,
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
                          onChange={() => toggleTodo(todo)}
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
                          onClick={() => deleteTodo(todo)}
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
                      onClick={async () => {
                        deleteTodo(completedTodos)
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
      <DevTools />
    </>
  )
}
