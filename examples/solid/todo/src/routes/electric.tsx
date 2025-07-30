import { createFileRoute } from "@tanstack/solid-router"
import { useLiveQuery } from "@tanstack/solid-db"
import {
  electricConfigCollection,
  electricTodoCollection,
} from "../lib/collections"
import { TodoApp } from "../components/TodoApp"

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
  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todo: electricTodoCollection })
      .orderBy(({ todo }) => todo.created_at, `asc`)
  )

  const { data: configData } = useLiveQuery((q) =>
    q.from({ config: electricConfigCollection })
  )

  return (
    <TodoApp
      todos={todos}
      configData={configData}
      todoCollection={electricTodoCollection}
      configCollection={electricConfigCollection}
      title="todos (electric)"
    />
  )
}
