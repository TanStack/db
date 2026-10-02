import { createFileRoute } from '@tanstack/solid-router'
import { useLiveQuery } from '@tanstack/solid-db'
import { Loading } from '@solidjs/web'
import { createMemo } from 'solid-js'
import {
  trailBaseConfigCollection,
  trailBaseTodoCollection,
} from '../lib/collections'
import { TodoApp } from '../components/TodoApp'

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
  const todos = useLiveQuery((q) =>
    q
      .from({ todo: trailBaseTodoCollection })
      .orderBy(({ todo }) => todo.created_at, `asc`),
  )

  const configData = useLiveQuery((q) =>
    q.from({ config: trailBaseConfigCollection }),
  )

  const gatedTodos = createMemo(() => {
    todos.readiness()
    return todos()
  })

  return (
    <Loading fallback="Loading...">
      <TodoApp
        todos={gatedTodos()}
        configData={configData()}
        todoCollection={trailBaseTodoCollection}
        configCollection={trailBaseConfigCollection}
        title="todos (TrailBase)"
      />
    </Loading>
  )
}
