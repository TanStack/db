import { useEffect, useRef, useState } from 'react'
import { createTodos } from './db/todos'
import { TodoList } from './components/TodoList'
import './App.css'

type TodosState = ReturnType<typeof createTodos>

export function App() {
  const [todosState, setTodosState] = useState<TodosState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const initRef = useRef(false)

  useEffect(() => {
    // Prevent double-initialization from React StrictMode.
    // The offline executor acquires a Web Lock for leadership — disposing
    // and re-creating it in the StrictMode mount→cleanup→mount cycle
    // leaves a ghost lock that blocks the second executor from becoming leader.
    if (initRef.current) return
    initRef.current = true

    try {
      const state = createTodos()
      setTodosState(state)
    } catch (err) {
      console.error('Failed to initialize:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  if (error) {
    return (
      <div className="container">
        <h1>Initialization Error</h1>
        <p style={{ color: '#ef4444' }}>{error}</p>
      </div>
    )
  }

  if (!todosState) {
    return (
      <div className="container">
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <TodoList
      collection={todosState.collection}
      executor={todosState.executor}
    />
  )
}
