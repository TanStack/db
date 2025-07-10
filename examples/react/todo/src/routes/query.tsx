import { createFileRoute } from "@tanstack/react-router"
import { useLiveQuery } from "@tanstack/react-db"
import { queryConfigCollection, queryTodoCollection } from "../lib/collections"
import { TodoApp } from "../components/TodoApp"

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
  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todo: queryTodoCollection })
      .orderBy(({ todo }) => todo.created_at, `asc`)
  )

  const { data: configData } = useLiveQuery((q) =>
    q.from({ config: queryConfigCollection })
  )

  return (
    <TodoApp
      todos={todos}
      configData={configData}
      todoCollection={queryTodoCollection}
      configCollection={queryConfigCollection}
      title="todos (query)"
    />
  )
}
