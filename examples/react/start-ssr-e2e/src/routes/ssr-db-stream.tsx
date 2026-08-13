import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  collectionOptions,
  eq,
  useLiveQuery,
  useLiveSuspenseQuery,
} from '@tanstack/react-db'
import { preloadSsrTodos, ssrTodoCollection } from '../lib/ssr-fixture'

type StreamedTodo = {
  id: string
  text: string
  status: `open` | `done`
}

const streamedTodos: Array<StreamedTodo> = [
  {
    id: `streamed-server-1`,
    text: `Streamed while rendering`,
    status: `open`,
  },
]

const streamedTodoCollection = collectionOptions(
  `ssr-suspense-stream-todos`,
  (client) => {
    const runtime = client.requireDependency<`server` | `browser`>(`runtime`)

    return {
      id: `ssr-suspense-stream-todos`,
      getKey: (todo: StreamedTodo) => todo.id,
      syncMode: `on-demand` as const,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()

          return {
            loadSubset: () => {
              if (runtime === `browser`) {
                return true
              }

              return new Promise<void>((resolve) => {
                setTimeout(() => {
                  begin({ immediate: true })
                  for (const todo of streamedTodos) {
                    write({ type: `insert`, value: todo })
                  }
                  commit()
                  resolve()
                }, 1000)
              })
            },
          }
        },
      },
    }
  },
)

export const Route = createFileRoute(`/ssr-db-stream`)({
  loader: async ({ context }) => {
    await preloadSsrTodos(context.dbClient)
  },
  component: SsrDbStreamRoute,
})

function SsrDbStreamRoute() {
  return (
    <main data-testid="ssr-db-stream-page">
      <h1>TanStack DB Suspense Streaming</h1>
      <CriticalTodoList />
      <React.Suspense
        fallback={<p data-testid="stream-fallback">Loading todos</p>}
      >
        <StreamedTodoList />
      </React.Suspense>
    </main>
  )
}

function CriticalTodoList() {
  const { data: todos } = useLiveQuery({
    query: (q) =>
      q
        .from({ todo: ssrTodoCollection })
        .where(({ todo }) => eq(todo.status, `open`)),
  })

  return (
    <ul data-testid="critical-todo-list">
      {todos.map((todo) => (
        <li data-testid={`critical-todo-${todo.id}`} key={todo.id}>
          {todo.text}
        </li>
      ))}
    </ul>
  )
}

function StreamedTodoList() {
  const { data: todos } = useLiveSuspenseQuery({
    query: (q) =>
      q
        .from({ todo: streamedTodoCollection })
        .where(({ todo }) => eq(todo.status, `open`)),
  })

  return (
    <ul data-testid="streamed-todo-list">
      {todos.map((todo) => (
        <li data-testid={`streamed-todo-${todo.id}`} key={todo.id}>
          {todo.text}
        </li>
      ))}
    </ul>
  )
}
