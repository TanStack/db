import React, { useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import type { Collection } from '@tanstack/db'
import type { PersistedTodo } from '~/db/persisted-todos'

interface PersistedTodoDemoProps {
  collection: Collection<PersistedTodo, string>
}

export function PersistedTodoDemo({ collection }: PersistedTodoDemoProps) {
  const [newTodoText, setNewTodoText] = useState(``)
  const [error, setError] = useState<string | null>(null)

  const { data: todoList = [] } = useLiveQuery((q) =>
    q.from({ todo: collection }).orderBy(({ todo }) => todo.createdAt, `desc`),
  )

  const handleAddTodo = () => {
    if (!newTodoText.trim()) return

    try {
      setError(null)
      const now = new Date().toISOString()
      collection.insert({
        id: crypto.randomUUID(),
        text: newTodoText.trim(),
        completed: false,
        createdAt: now,
        updatedAt: now,
      })
      setNewTodoText(``)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to add todo`)
    }
  }

  const handleToggleTodo = (id: string) => {
    try {
      setError(null)
      collection.update(id, (draft) => {
        draft.completed = !draft.completed
        draft.updatedAt = new Date().toISOString()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to toggle todo`)
    }
  }

  const handleDeleteTodo = (id: string) => {
    try {
      setError(null)
      collection.delete(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to delete todo`)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === `Enter`) {
      handleAddTodo()
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">🗃️</span>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              wa-sqlite OPFS Persistence Demo
            </h2>
            <p className="text-gray-600">
              Collection data is persisted to SQLite via OPFS. Data survives
              page reloads without any server sync.
            </p>
          </div>
        </div>

        {/* Persistence indicator */}
        <div className="flex flex-wrap gap-4 mb-6 text-sm">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            SQLite OPFS Persistence Active
          </div>
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-600">
            {todoList.length} todo{todoList.length !== 1 ? `s` : ``}
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-md">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {/* Add new todo */}
        <div className="flex gap-2 mb-6">
          <input
            type="text"
            value={newTodoText}
            onChange={(e) => setNewTodoText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Add a new todo..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleAddTodo}
            disabled={!newTodoText.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>

        {/* Todo list */}
        <div className="space-y-2">
          {todoList.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No todos yet. Add one above to get started!
              <br />
              <span className="text-xs">
                Try adding todos, then refresh the page to see them persist
              </span>
            </div>
          ) : (
            todoList.map((todo) => (
              <div
                key={todo.id}
                className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50"
              >
                <button
                  onClick={() => handleToggleTodo(todo.id)}
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                    todo.completed
                      ? `bg-green-500 border-green-500 text-white`
                      : `border-gray-300 hover:border-green-400`
                  }`}
                >
                  {todo.completed && <span className="text-xs">✓</span>}
                </button>
                <span
                  className={`flex-1 ${
                    todo.completed
                      ? `line-through text-gray-500`
                      : `text-gray-900`
                  }`}
                >
                  {todo.text}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(todo.createdAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => handleDeleteTodo(todo.id)}
                  className="px-2 py-1 text-red-600 hover:bg-red-50 rounded text-sm"
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>

        {/* Instructions */}
        <div className="mt-6 p-4 bg-gray-50 rounded-md">
          <h3 className="font-medium text-gray-900 mb-2">Try this:</h3>
          <ol className="text-sm text-gray-600 space-y-1">
            <li>1. Add some todos</li>
            <li>2. Refresh the page (Ctrl+R / Cmd+R)</li>
            <li>
              3. Your todos are still here - persisted in SQLite via OPFS!
            </li>
            <li>4. This uses wa-sqlite with OPFSCoopSyncVFS in a Web Worker</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
