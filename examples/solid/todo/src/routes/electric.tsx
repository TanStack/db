import { createFileRoute } from '@tanstack/solid-router'
import { useLiveQuery } from '@tanstack/solid-db'
import { Suspense } from 'solid-js'
import {
  electricConfigCollection,
  electricTodoCollection,
} from '../lib/collections'
import { TodoApp } from '../components/TodoApp'

export const Route = createFileRoute(`/electric`)({
  component: ElectricPage,
  ssr: false,
  loader: async () => {
    await Promise.all([
      electricTodoCollection.preload(),
      electricConfigCollection.preload(),
    ])

    return null
  },
})

function ElectricPage() {
  // Get data using live queries with Electric collections
  const todos = useLiveQuery((q) =>
    q
      .from({ todo: electricTodoCollection })
      .orderBy(({ todo }) => todo.created_at, `asc`),
  )

  const configData = useLiveQuery((q) =>
    q.from({ config: electricConfigCollection }),
  )

  return (
    <Suspense fallback="Loading...">
      <TodoApp
        todos={todos()}
        configData={configData()}
        todoCollection={electricTodoCollection}
        configCollection={electricConfigCollection}
        title="todos (electric)"
      />
    </Suspense>
  )
}
