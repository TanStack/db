import { createFileRoute } from '@tanstack/solid-router'
import { useLiveQuery } from '@tanstack/solid-db'
import { Suspense } from 'solid-js'
import { queryConfigCollection, queryTodoCollection } from '../lib/collections'
import { TodoApp } from '../components/TodoApp'

export const Route = createFileRoute(`/query`)({
  component: QueryPage,
  ssr: false,
  loader: async () => {
    await Promise.all([
      queryTodoCollection.preload(),
      queryConfigCollection.preload(),
    ])

    return null
  },
})

function QueryPage() {
  // Get data using live queries with Query collections
  const todos = useLiveQuery((q) =>
    q
      .from({ todo: queryTodoCollection })
      .orderBy(({ todo }) => todo.created_at, `asc`),
  )

  const configData = useLiveQuery((q) =>
    q.from({ config: queryConfigCollection }),
  )

  return (
    <Suspense fallback="Loading...">
      <TodoApp
        todos={todos()}
        configData={configData()}
        todoCollection={queryTodoCollection}
        configCollection={queryConfigCollection}
        title="todos (query)"
      />
    </Suspense>
  )
}
