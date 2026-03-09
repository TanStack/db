import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { createTodoActions } from '../db/todos'
import { todoApi } from '../utils/api'
import type { createTodos } from '../db/todos'

interface TodoListProps {
  collection: ReturnType<typeof createTodos>['collection']
  executor: ReturnType<typeof createTodos>['executor']
}

export function TodoList({ collection, executor }: TodoListProps) {
  const [inputText, setInputText] = useState('')
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [actions] = useState(() => createTodoActions(executor))

  // Monitor network status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      executor.notifyOnline()
    }
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [executor])

  // Poll pending mutation count
  useEffect(() => {
    const interval = setInterval(() => {
      setPendingCount(executor.getPendingCount())
    }, 100)
    return () => clearInterval(interval)
  }, [executor])

  // Query all todos sorted by creation date
  const { data: todos = [], isLoading } = useLiveQuery((query) =>
    query
      .from({ todo: collection })
      .orderBy(({ todo }) => todo.createdAt, 'desc'),
  )

  const handleAddTodo = useCallback(() => {
    const text = inputText.trim()
    if (!text) return
    try {
      setError(null)
      actions.addTodo(text)
      setInputText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add todo')
    }
  }, [inputText, actions])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleAddTodo()
    },
    [handleAddTodo],
  )

  if (isLoading) {
    return (
      <div className="container">
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div className="container">
      <h1>TanStack DB – Electron Offline-First</h1>

      <div className="status-bar">
        <span className={`badge ${isOnline ? 'badge-online' : 'badge-offline'}`}>
          {isOnline ? 'Online' : 'Offline'}
        </span>
        <span className={`badge ${executor.isOfflineEnabled ? 'badge-offline-enabled' : 'badge-offline-disabled'}`}>
          {executor.isOfflineEnabled ? 'Offline Mode' : 'Online Only'}
        </span>
        {pendingCount > 0 && (
          <span className="badge badge-pending">
            {pendingCount} pending
          </span>
        )}
        <span className="badge badge-count">
          {todos.length} todo{todos.length !== 1 ? 's' : ''}
        </span>
        <button
          className="reset-btn"
          onClick={async () => {
            if (!confirm('Reset everything? This clears all todos and local data.')) return
            try {
              await todoApi.deleteAll()
            } catch {
              // server may be offline — continue with local reset
            }
            await window.electronAPI.resetDatabase()
            window.location.reload()
          }}
        >
          Reset
        </button>
      </div>

      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="input-row">
        <input
          type="text"
          className="todo-input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What needs to be done?"
        />
        <button className="add-btn" onClick={handleAddTodo} disabled={!inputText.trim()}>
          Add
        </button>
      </div>

      <ul className="todo-list">
        {todos.map((todo) => (
          <li key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''}`}>
            <button
              className="toggle-btn"
              onClick={() => actions.toggleTodo(todo.id)}
            >
              {todo.completed ? '✓' : '○'}
            </button>
            <span className="todo-text">{todo.text}</span>
            <button
              className="delete-btn"
              onClick={() => actions.deleteTodo(todo.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {todos.length === 0 && (
        <p className="empty-message">No todos yet. Add one above!</p>
      )}

      <div className="instructions">
        <h3>Try it out</h3>
        <ul>
          <li><strong>Persistence:</strong> Add todos, quit the app, reopen — data is still there</li>
          <li><strong>Multiple windows:</strong> Press Cmd+N (or File → New Window) to open a second window — each window syncs independently with the server</li>
          <li><strong>Offline mode:</strong> Stop the server (<code>pnpm dev:server</code>), add todos, restart — they sync automatically</li>
        </ul>
      </div>
    </div>
  )
}
