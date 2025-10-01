import React, { useEffect, useMemo, useState } from "react"
import { useLiveQuery } from "@tanstack/react-db"
import { createTodoActions, todoCollection } from "~/db/todos"

interface TodoDemoProps {
  title: string
  description: string
  storageType: `indexeddb` | `localstorage`
  offline: any
}

export function TodoDemo({
  title,
  description,
  storageType,
  offline,
}: TodoDemoProps) {
  const [newTodoText, setNewTodoText] = useState(``)
  const [error, setError] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)

  // Create actions based on offline executor
  const actions = useMemo(() => createTodoActions(offline), [offline])

  // Use live query to get todos
  const { data: todoList = [], isLoading } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .orderBy(({ todo }) => todo.createdAt, `desc`)
  )

  // Monitor online status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      if (offline) {
        offline.notifyOnline()
      }
    }
    const handleOffline = () => setIsOnline(false)

    window.addEventListener(`online`, handleOnline)
    window.addEventListener(`offline`, handleOffline)

    return () => {
      window.removeEventListener(`online`, handleOnline)
      window.removeEventListener(`offline`, handleOffline)
    }
  }, [offline])

  // Monitor pending transactions
  useEffect(() => {
    if (!offline) return

    const interval = setInterval(() => {
      setPendingCount(offline.getPendingCount())
    }, 100)

    return () => clearInterval(interval)
  }, [offline])

  const handleAddTodo = async () => {
    if (!newTodoText.trim()) return

    try {
      setError(null)
      if (typeof actions.addTodo === `function`) {
        await actions.addTodo(newTodoText)
      } else {
        actions.addTodo(newTodoText)
      }
      setNewTodoText(``)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to add todo`)
    }
  }

  const handleToggleTodo = async (id: string) => {
    try {
      setError(null)
      if (typeof actions.toggleTodo === `function`) {
        await actions.toggleTodo(id)
      } else {
        actions.toggleTodo(id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to toggle todo`)
    }
  }

  const handleDeleteTodo = async (id: string) => {
    try {
      setError(null)
      if (typeof actions.deleteTodo === `function`) {
        await actions.deleteTodo(id)
      } else {
        actions.deleteTodo(id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to delete todo`)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === `Enter`) {
      handleAddTodo()
    }
  }

  const getStorageIcon = () => {
    switch (storageType) {
      case `indexeddb`:
        return `🗄️`
      case `localstorage`:
        return `💾`
      default:
        return `💿`
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">{getStorageIcon()}</span>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
            <p className="text-gray-600">{description}</p>
          </div>
        </div>

        {/* Status indicators */}
        <div className="flex flex-wrap gap-4 mb-6 text-sm">
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full ${
              isOnline
                ? `bg-green-100 text-green-800`
                : `bg-red-100 text-red-800`
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                isOnline ? `bg-green-500` : `bg-red-500`
              }`}
            />
            {isOnline ? `Online` : `Offline`}
          </div>

          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full ${
              offline?.isOfflineEnabled
                ? `bg-blue-100 text-blue-800`
                : `bg-gray-100 text-gray-800`
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                offline?.isOfflineEnabled ? `bg-blue-500` : `bg-gray-500`
              }`}
            />
            {offline?.isOfflineEnabled ? `Offline Mode Enabled` : `Online Only`}
          </div>

          {pendingCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-100 text-yellow-800">
              <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
              {pendingCount} pending sync{pendingCount !== 1 ? `s` : ``}
            </div>
          )}
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
            disabled={isLoading}
          />
          <button
            onClick={handleAddTodo}
            disabled={isLoading || !newTodoText.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>

        {/* Todo list */}
        <div className="space-y-2">
          {isLoading && todoList.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
              Loading todos...
            </div>
          ) : todoList.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No todos yet. Add one above to get started!
              <br />
              <span className="text-xs">
                Try going offline to see how it works
              </span>
            </div>
          ) : (
            todoList.map((todo) => {
              return (
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
              )
            })
          )}
        </div>

        {/* Instructions */}
        <div className="mt-6 p-4 bg-gray-50 rounded-md">
          <h3 className="font-medium text-gray-900 mb-2">Try this:</h3>
          <ol className="text-sm text-gray-600 space-y-1">
            <li>1. Add some todos while online</li>
            <li>2. Open DevTools → Network → Set to "Offline"</li>
            <li>3. Add more todos (they'll be stored locally)</li>
            <li>4. Go back online to see them sync</li>
            <li>
              5. Open this page in another tab to test multi-tab coordination
            </li>
          </ol>
        </div>
      </div>
    </div>
  )
}
