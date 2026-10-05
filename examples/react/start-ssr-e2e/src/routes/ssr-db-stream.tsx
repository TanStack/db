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
  sourcePayload: string
}

const serverTodo: StreamedTodo = {
  id: `streamed-server-1`,
  text: `Streamed while rendering`,
  status: `open`,
  sourcePayload: `SOURCE_ONLY_DO_NOT_TRANSPORT`,
}

const browserTodo: StreamedTodo = {
  id: `streamed-browser-1`,
  text: `Reconciled from browser sync`,
  status: `open`,
  sourcePayload: `BROWSER_SOURCE_ONLY_DO_NOT_TRANSPORT`,
}

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
              return new Promise<void>((resolve) => {
                setTimeout(
                  () => {
                    begin({ immediate: true })
                    write({
                      type: `insert`,
                      value: runtime === `server` ? serverTodo : browserTodo,
                    })
                    commit()
                    resolve()
                  },
                  runtime === `server` ? 1000 : 1500,
                )
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
        .where(({ todo }) => eq(todo.status, `open`))
        .select(({ todo }) => ({
          id: todo.id,
          text: todo.text,
          status: todo.status,
        })),
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
