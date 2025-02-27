import React, { useState, FormEvent, useRef } from "react"
import { useCollection } from "../../src/useCollection"
import { createElectricSync } from "../../src/lib/electric"
import { DevTools } from "./DevTools"
import {
  InsertTodo,
  insertTodoSchema,
  insertConfigSchema,
  InsertConfig,
} from "./db/validation"

interface Todo {
  text: string
  completed: boolean
}

export default function App() {
  const [newTodo, setNewTodo] = useState(``)

  const electricSync = useRef(
    createElectricSync({
      url: `http://localhost:3000/v1/shape`,
      params: {
        table: `todos`,
      },
    })
  )

  const configSync = useRef(
    createElectricSync({
      url: `http://localhost:3000/v1/shape`,
      params: {
        table: `config`,
      },
    })
  )

  const {
    data: todos,
    insert,
    update,
    delete: deleteTodo,
  } = useCollection<InsertTodo>({
    id: `todos`,
    sync: electricSync.current,
    schema: insertTodoSchema,
    mutationFn: {
      persist: async ({ transaction, collection }) => {
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
        collection.transactionManager.setMetadata(transaction.id, {
          txid: result.txid,
        })
      },
      awaitSync: async ({ transaction }) => {
        // Start waiting for the txid
        await electricSync.current.awaitTxid(
          transaction.metadata?.txid as number
        )
      },
    },
  })

  const {
    data: configData,
    update: updateConfig,
    insert: insertConfig,
  } = useCollection<InsertConfig>({
    id: `config`,
    sync: configSync.current,
    schema: insertConfigSchema,
    mutationFn: {
      persist: async ({ transaction, collection }) => {
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
        collection.transactionManager.setMetadata(transaction.id, {
          txid: result.txid,
        })
      },
      awaitSync: async ({ transaction }) => {
        // Start waiting for the txid
        await configSync.current.awaitTxid(transaction.metadata?.txid as number)
      },
    },
  })

  // Define a more robust type-safe helper function to get config values
  const getConfigValue = (key: string): string => {
    // eslint-disable-next-line
    for (const [_, config] of configData) {
      if (config.key === key) {
        return config.value
      }
    }
    return ``
  }

  // Define a helper function to update config values
  const setConfigValue = (key: string, value: string): void => {
    for (const [entryKey, config] of configData.entries()) {
      if (config.key === key) {
        updateConfig({
          key: entryKey,
          data: { value },
        })
        return
      }
    }
    // If the config doesn't exist yet, create it
    insertConfig({
      key: Date.now().toString(),
      data: { key, value },
    })
  }

  const backgroundColor = getConfigValue(`backgroundColor`)

  const handleColorChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value
    setConfigValue(`backgroundColor`, newColor)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!newTodo.trim()) return

    await insert({
      key: Date.now().toString(),
      data: { text: newTodo, completed: false },
    })
    setNewTodo(``)
  }

  const toggleTodo = async (key: string, todo: Todo) => {
    await update({
      key,
      data: { completed: !todo.completed },
    })
  }

  const activeTodos = Array.from(todos).filter(([, todo]) => !todo.completed)
  const completedTodos = Array.from(todos).filter(([, todo]) => todo.completed)

  return (
    <>
      <div
        className="min-h-screen flex items-start justify-center overflow-auto py-8"
        style={{ backgroundColor }}
      >
        <div style={{ width: 550 }} className="mx-auto relative">
          <h1 className="text-[100px] text-[rgba(175,47,47,0.15)] font-thin text-center mb-8">
            todos
          </h1>

          <div className="mb-4 flex justify-end">
            <div className="flex items-center">
              <label
                htmlFor="colorPicker"
                className="mr-2 text-sm text-gray-700"
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
              {todos.size > 0 && (
                <button
                  type="button"
                  className="absolute left-0 w-12 h-full text-[30px] text-[#e6e6e6] hover:text-[#4d4d4d]"
                  onClick={async () => {
                    const allCompleted = completedTodos.length === todos.size
                    for (const [key, todo] of todos) {
                      await update({
                        key,
                        data: { ...todo, completed: !allCompleted },
                      })
                    }
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

            {todos.size > 0 && (
              <>
                <ul className="my-0 mx-0 p-0 list-none">
                  {Array.from(todos).map(([key, todo]) => (
                    <li
                      key={key}
                      className="relative border-b border-[#ededed] last:border-none group"
                    >
                      <div className="flex items-center h-[58px] pl-[60px]">
                        <input
                          type="checkbox"
                          checked={todo.completed}
                          onChange={() => toggleTodo(key, todo)}
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
                          onClick={() => deleteTodo({ key })}
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
                        for (const [key] of completedTodos) {
                          await deleteTodo({ key })
                        }
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
