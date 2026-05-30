import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { DbClient, DbProvider, eq, useLiveQuery } from '@tanstack/react-db'
import {
  applyStreamedTodo,
  createDehydratedSsrTodoState,
  ssrTodoCollection,
} from '../lib/ssr-fixture'

export const Route = createFileRoute(`/ssr-db`)({
  loader: async () => {
    return {
      dbState: await createDehydratedSsrTodoState(),
    }
  },
  component: SsrDbRoute,
})

function SsrDbRoute() {
  const { dbState } = Route.useLoaderData()
  const [dbClient] = React.useState(() => {
    const client = new DbClient()
    client.hydrate(dbState)
    return client
  })

  return (
    <DbProvider client={dbClient}>
      <SsrDbTodos dbClient={dbClient} />
    </DbProvider>
  )
}

function SsrDbTodos({ dbClient }: { dbClient: DbClient }) {
  const [hydrated, setHydrated] = React.useState(false)
  const [streamed, setStreamed] = React.useState(false)
  const { data: todos, isReady } = useLiveQuery({
    query: (q) =>
      q
        .from({ todo: ssrTodoCollection })
        .where(({ todo }) => eq(todo.status, `open`))
        .orderBy(({ todo }) => todo.id, `asc`),
  })

  React.useEffect(() => {
    setHydrated(true)
  }, [])

  return (
    <main
      data-testid="ssr-db-page"
      style={{
        background: `#f8fafc`,
        minHeight: `100vh`,
        padding: 32,
      }}
    >
      <section
        style={{
          background: `white`,
          border: `1px solid #e5e7eb`,
          borderRadius: 8,
          margin: `0 auto`,
          maxWidth: 720,
          padding: 24,
        }}
      >
        <h1>TanStack DB SSR</h1>

        <div style={{ display: `flex`, gap: 16, marginBottom: 16 }}>
          <span data-testid="hydration-state">
            {hydrated ? `hydrated` : `ssr`}
          </span>
          <span data-testid="ready-state">{isReady ? `ready` : `loading`}</span>
          <span data-testid="streamed-status">
            {streamed ? `streamed` : `waiting`}
          </span>
          <span>
            rows: <strong data-testid="ssr-row-count">{todos.length}</strong>
          </span>
        </div>

        <ul data-testid="ssr-todo-list">
          {todos.map((todo) => (
            <li data-testid={`ssr-todo-${todo.id}`} key={todo.id}>
              {todo.text} <small>({todo.source})</small>
            </li>
          ))}
        </ul>

        <button
          data-testid="apply-stream-chunk"
          onClick={() => {
            applyStreamedTodo(dbClient)
            setStreamed(true)
          }}
          style={{
            background: `#15803d`,
            border: 0,
            borderRadius: 6,
            color: `white`,
            cursor: `pointer`,
            marginTop: 16,
            padding: `10px 14px`,
          }}
          type="button"
        >
          Apply streamed chunk
        </button>
      </section>
    </main>
  )
}
