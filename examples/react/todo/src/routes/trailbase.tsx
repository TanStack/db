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

  // Note: TrailBase collections use recordApi internally, which is not exposed
  // as a collection utility. For this example, we're not using serialized
  // transactions with TrailBase - the color picker will use naked collection
  // calls which invoke the collection's built-in handlers automatically.
  // In a real app, you could expose the recordApi via utils to enable
  // serialized transactions with TrailBase collections.

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
