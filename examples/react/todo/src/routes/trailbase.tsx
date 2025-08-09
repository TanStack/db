import { createFileRoute } from "@tanstack/react-router"
import { useLiveQuery } from "@tanstack/react-db"
import {
  trailBaseConfigCollection,
  trailBaseTodoCollection,
} from "../lib/collections"
import { TodoApp } from "../components/TodoApp"

export const Route = createFileRoute(`/trailbase`)({
  component: TrailBasePage,
  ssr: false,
  loader: async () => {
    await Promise.all([
      trailBaseTodoCollection.preload(),
      trailBaseConfigCollection.preload(),
    ])

    return null
  },
})

function TrailBasePage() {
  // Get data using live queries with TrailBase collections
  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todo: trailBaseTodoCollection })
      .orderBy(({ todo }) => todo.created_at, `asc`)
  )

  const { data: configData } = useLiveQuery((q) =>
    q.from({ config: trailBaseConfigCollection })
  )

  return (
    <TodoApp
      todos={todos}
      configData={configData}
      todoCollection={trailBaseTodoCollection}
      configCollection={trailBaseConfigCollection}
      title="todos (TrailBase)"
    />
  )
}
