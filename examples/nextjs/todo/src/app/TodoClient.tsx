"use client"

import React, { useEffect, useState } from "react"
import {
  useConfigCollection,
  useTodosCollection,
} from "../lib/useCollectionQuery"
import { useTodos } from "../hooks/useTodos"
import { useConfig } from "../hooks/useConfig"
import { getComplementaryColor } from "../lib/utils"
import type { UpdateTodo } from "../db/validation"
import type { FormEvent } from "react"

export default function TodoClient() {
  const [newTodo, setNewTodo] = useState(``)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const { data: todos, collection: todoCollection } = useTodosCollection()
  const { data: configData, collection: configCollection } =
    useConfigCollection()

  const { addTodo, updateTodo, deleteTodo } = useTodos(todoCollection)
  const { getConfigValue, setConfigValue } = useConfig(
    configData,
    configCollection
  )

  const backgroundColor = getConfigValue(`backgroundColor`)
  const titleColor = getComplementaryColor(backgroundColor)

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value
    setConfigValue(`backgroundColor`, newColor)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!newTodo.trim()) return

    addTodo.mutate(() =>
      todoCollection.insert({
        text: newTodo,
        completed: false,
        id: Math.round(Math.random() * 1000000),
      })
    )
    setNewTodo(``)
  }

  const toggleTodo = (todo: UpdateTodo) => {
    updateTodo.mutate(() =>
      todoCollection.update(
        Array.from(todoCollection.state.values()).find(
          (t: any) => t.id === todo.id
        )!,
        (draft: any) => {
          draft.completed = !draft.completed
        }
      )
    )
  }

  const toggleAllTodos = () => {
    const allCompleted = completedTodos.length === todos.length
    const todosToToggle = allCompleted ? completedTodos : activeTodos
    const togglingIds = new Set()
    todosToToggle.forEach((t) => togglingIds.add(t.id))
    updateTodo.mutate(() =>
      todoCollection.update(
        Array.from(todoCollection.state.values()).filter((t: any) =>
          togglingIds.has(t.id)
        ),
        (drafts: any) => {
          drafts.forEach((draft: any) => (draft.completed = !allCompleted))
        }
      )
    )
  }

  const clearCompleted = () => {
    deleteTodo.mutate(() =>
      todoCollection.delete(
        Array.from(todoCollection.state.values()).filter((t: any) =>
          completedTodos.some((ct) => ct.id === t.id)
        )
      )
    )
  }

  const activeTodos = todos.filter((todo) => !todo.completed)
  const completedTodos = todos.filter((todo) => todo.completed)

  return (
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
                onClick={toggleAllTodos}
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
                        onClick={() => {
                          deleteTodo.mutate(() =>
                            todoCollection.delete(
                              Array.from(todoCollection.state.values()).find(
                                (t: any) => t.id === todo.id
                              )!
                            )
                          )
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
                    onClick={clearCompleted}
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
  )
}
