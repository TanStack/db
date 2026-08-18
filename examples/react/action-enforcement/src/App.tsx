import { TodoApp } from '@/features/todos/TodoApp'

export function App() {
  return (
    <main className="app-shell">
      <h1>TanStack DB: Enforce Actions for Mutations</h1>
      <p className="subtitle">
        This example only allows writes through actions. Feature code cannot
        import collections directly.
      </p>
      <TodoApp />
    </main>
  )
}
