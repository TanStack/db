import React, { useState } from "react"
import { Link } from "@tanstack/react-router"
import type { FormEvent } from "react"
import type { Collection } from "@tanstack/react-db"

import type { SelectConfig, SelectTodo } from "@/db/validation"
import { getComplementaryColor } from "@/lib/color"

interface TodoAppProps {
  todos: Array<SelectTodo>
  configData: Array<SelectConfig>
  todoCollection: Collection<SelectTodo>
  configCollection: Collection<SelectConfig>
  title: string
}

export function TodoApp({
  todos,
  configData,
  todoCollection,
  configCollection,
  title,
}: TodoAppProps) {
  const [newTodo, setNewTodo] = useState(``)

  // Define a type-safe helper function to get config values
  const getConfigValue = (key: string): string | undefined => {
    for (const config of configData) {
      if (config.key === key) {
        return config.value
      }
    }
    return undefined
  }

  // Define a helper function to update config values
  const setConfigValue = (key: string, value: string): void => {
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
  const titleColor = getComplementaryColor(backgroundColor)

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value
    setConfigValue(`backgroundColor`, newColor)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const todo = newTodo.trim()
    setNewTodo(``)

    if (todo) {
      todoCollection.insert({
        text: todo,
        completed: false,
        id: Math.round(Math.random() * 1000000),
        created_at: new Date(),
        updated_at: new Date(),
      })
    }
  }

  const activeTodos = todos.filter((todo) => !todo.completed)
  const completedTodos = todos.filter((todo) => todo.completed)

  return (
    <main
      className="h-dvh flex justify-center overflow-auto py-8"
      style={{ backgroundColor }}
    >
      <div className="w-[550px]">
        <h1
          className="text-center text-[70px] font-bold mb-4"
          style={{ color: titleColor }}
        >
          {title}
        </h1>

        <Navigation />

        <div className="py-4 flex justify-end">
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
            <button
              type="button"
              className="absolute w-12 h-full text-[30px] text-[#e6e6e6] hover:text-[#4d4d4d]"
              disabled={todos.length === 0}
              onClick={() => {
                const todosToToggle =
                  activeTodos.length > 0 ? activeTodos : completedTodos

                todoCollection.update(
                  todosToToggle.map((todo) => todo.id),
                  (drafts) =>
                    drafts.forEach(
                      (draft) => (draft.completed = !draft.completed)
                    )
                )
              }}
            >
              ❯
            </button>
            <input
              type="text"
              value={newTodo}
              onChange={(e) => setNewTodo(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full h-[64px] pl-[60px] pr-4 text-2xl font-light border-none shadow-[inset_0_-2px_1px_rgba(0,0,0,0.03)] box-border"
            />
          </form>

          <ul className="list-none">
            {todos.map((todo) => (
              <li
                key={`todo-${todo.id}`}
                className="relative border-b border-[#ededed] last:border-none group"
              >
                <div className="flex items-center h-[58px] pl-[60px] gap-1.2">
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={() =>
                      todoCollection.update(todo.id, (draft) => {
                        draft.completed = !draft.completed
                      })
                    }
                    className="absolute left-[12px] size-[40px] cursor-pointer"
                  />
                  <label
                    className={`block p-[15px] text-2xl transition-colors ${todo.completed ? `text-[#d9d9d9] line-through` : ``}`}
                  >
                    {todo.text}
                  </label>
                  <button
                    onClick={() => todoCollection.delete(todo.id)}
                    className="hidden group-hover:block absolute right-[20px] text-[30px] text-[#cc9a9a] hover:text-[#af5b5e] transition-colors"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <footer className="text-[14px] text-[#777] px-[15px] h-[40px] border-t border-[#e6e6e6] flex justify-between items-center">
            <span>
              {`${activeTodos.length} ${activeTodos.length === 1 ? `item` : `items`} left`}
            </span>

            {completedTodos.length > 0 && (
              <button
                onClick={() =>
                  todoCollection.delete(completedTodos.map((todo) => todo.id))
                }
                className="hover:underline"
              >
                Clear completed
              </button>
            )}
          </footer>
        </div>
      </div>
    </main>
  )
}

function Navigation() {
  const style = `px-4 py-2 text-white rounded transition-colors`
  const links = [
    [`/query`, `Query`, `bg-green-700 hover:bg-green-800`],
    [`/electric`, `Electric`, `bg-blue-500 hover:bg-blue-600`],
    [`/trailbase`, `TrailBase`, `bg-purple-600 hover:bg-purple-700`],
  ]

  return (
    <nav className="flex justify-center gap-4 mb-4">
      <Link to="/" className={`${style} bg-gray-500 hover:bg-gray-600`}>
        ← Home
      </Link>

      {links.map(([href, name, cls]) => (
        <Link key={href} to={href} className={`${style} ${cls}`}>
          {name}
        </Link>
      ))}
    </nav>
  )
}
