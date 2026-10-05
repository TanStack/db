import { TodoApp } from '@/features/todos/TodoApp'

export function App() {
  return (
    <main className="app-shell">
      <h1>TanStack DB: Enforce Actions for Mutations</h1>
      <p className="subtitle">
        Feature code reads collections directly and writes through actions.
        ESLint checks the mutation boundary.
      </p>
      <TodoApp />
    </main>
  )
}
