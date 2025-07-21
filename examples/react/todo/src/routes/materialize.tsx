import { createFileRoute } from "@tanstack/react-router"
import { useLiveQuery } from "@tanstack/react-db"
import {
  materializeConfigCollection,
  materializeTodoCollection,
} from "../lib/collections"
import { TodoApp } from "../components/TodoApp"

export const Route = createFileRoute(`/materialize`)({
  component: MaterializePage,
  ssr: false,
  loader: async () => {
    await Promise.all([
      materializeTodoCollection.preload(),
      materializeConfigCollection.preload(),
    ])

    return null
  },
})

function MaterializePage() {
  // Get data using live queries with Materialize collections
  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todo: materializeTodoCollection })
      .orderBy(({ todo }) => todo.created_at, `asc`)
  )

  const { data: configData } = useLiveQuery((q) =>
    q.from({ config: materializeConfigCollection })
  )

  return (
    <TodoApp
      todos={todos}
      configData={configData}
      todoCollection={materializeTodoCollection}
      configCollection={materializeConfigCollection}
      title="todos (materialize)"
    />
  )
}
