import { collectionOptions, eq } from '@tanstack/db'
import type { InitialQueryBuilder } from '@tanstack/db'

export type StreamedTodo = {
  id: string
  text: string
  status: `open` | `done`
  sourcePayload: string
}

const serverTodo: StreamedTodo = {
  id: `next-server-1`,
  text: `Streamed from Next.js`,
  status: `open`,
  sourcePayload: `NEXT_SOURCE_ONLY_DO_NOT_TRANSPORT`,
}

const browserTodo: StreamedTodo = {
  id: `next-browser-1`,
  text: `Reconciled by Next.js browser sync`,
  status: `open`,
  sourcePayload: `NEXT_BROWSER_SOURCE_ONLY_DO_NOT_TRANSPORT`,
}

export const streamedTodoCollection = collectionOptions(
  `next-ssr-stream-todos`,
  (client) => {
    const runtime = client.requireDependency<`server` | `browser`>(`runtime`)

    return {
      id: `next-ssr-stream-todos`,
      getKey: (todo: StreamedTodo) => todo.id,
      syncMode: `on-demand` as const,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: () =>
              new Promise<void>((resolve) => {
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
              }),
          }
        },
      },
    }
  },
)

export const streamedTodoQuery = {
  query: (q: InitialQueryBuilder) =>
    q
      .from({ todo: streamedTodoCollection })
      .where(({ todo }) => eq(todo.status, `open`))
      .select(({ todo }) => ({
        id: todo.id,
        text: todo.text,
        status: todo.status,
      })),
}
