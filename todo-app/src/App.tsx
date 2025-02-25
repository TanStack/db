import React, { useState, FormEvent } from "react"
import { useCollection } from "../../src/useCollection"
import mitt from "mitt"
import { DevTools } from "./DevTools"

interface Todo {
  text: string
  completed: boolean
}

const emitter = mitt()

export default function App() {
  const [newTodo, setNewTodo] = useState(``)
  const {
    data: todos,
    insert,
    update,
    delete: deleteTodo,
  } = useCollection({
    id: `todos`,
    sync: {
      id: `local`,
      sync: ({ begin, write, commit }) => {
        emitter.on(`*`, (type, { changes }) => {
          begin()
          changes.forEach((change) => write(change))
          commit()
        })
      },
    },
    mutationFn: {
      persist: async () => {
        console.log(`persisting...`)
      },
      awaitSync: async () => {},
    },
  })

  console.log({ todos })

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
      data: { ...todo, completed: !todo.completed },
    })
  }

  const activeTodos = Array.from(todos).filter(
    ([, todo]) => !(todo as Todo).completed
  )
  const completedTodos = Array.from(todos).filter(
    ([, todo]) => (todo as Todo).completed
  )

  return (
    <>
      <div className="h-[50vh] flex items-start justify-center overflow-auto py-8">
        <div style={{ width: 550 }} className="mx-auto relative">
          <h1 className="text-[100px] text-[rgba(175,47,47,0.15)] font-thin text-center mb-8">
            todos
          </h1>
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
                        data: { ...(todo as Todo), completed: !allCompleted },
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
                          checked={(todo as Todo).completed}
                          onChange={() => toggleTodo(key, todo as Todo)}
                          className="absolute left-[12px] top-0 bottom-0 my-auto h-[40px] w-[40px] cursor-pointer"
                        />
                        <label
                          className={`block leading-[1.2] py-[15px] px-[15px] text-2xl transition-colors ${
                            (todo as Todo).completed
                              ? `text-[#d9d9d9] line-through`
                              : ``
                          }`}
                        >
                          {(todo as Todo).text}
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
