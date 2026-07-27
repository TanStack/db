import {
  DbClient,
  collectionOptions,
  createLiveQueryCollection,
  eq,
} from '@tanstack/react-db'
import type { DehydratedDbState } from '@tanstack/react-db'

export type SsrTodo = {
  id: string
  text: string
  status: `open` | `done`
  source: `server` | `sync` | `stream`
}

export const ssrTodoCollectionId = `ssr-e2e-todos`

const serverTodos: Array<SsrTodo> = [
  {
    id: `server-1`,
    text: `Pay invoices`,
    status: `open`,
    source: `server`,
  },
  {
    id: `server-2`,
    text: `Review pull requests`,
    status: `open`,
    source: `server`,
  },
  {
    id: `server-3`,
    text: `Archived roadmap`,
    status: `done`,
    source: `server`,
  },
]

const browserTodos: Array<SsrTodo> = serverTodos.map((todo) =>
  todo.id === `server-1`
    ? {
        ...todo,
        text: `Pay invoices (reconciled from sync)`,
        source: `sync`,
      }
    : { ...todo, source: `sync` },
)

export const streamedTodo: SsrTodo = {
  id: `streamed-1`,
  text: `Streamed from collection chunk`,
  status: `open`,
  source: `stream`,
}

export const ssrTodoCollection = collectionOptions(ssrTodoCollectionId, () => ({
  id: ssrTodoCollectionId,
  getKey: (todo: SsrTodo) => todo.id,
  syncMode: `on-demand`,
  sync: {
    sync: ({ begin, write, commit, markReady }) => {
      markReady()

      return {
        loadSubset: () => {
          const todos =
            typeof window === `undefined` ? serverTodos : browserTodos

          begin({ immediate: true })
          for (const todo of todos) {
            write({
              type: `insert`,
              value: todo,
            })
          }
          commit()
          return true
        },
      }
    },
  },
}))

export async function createDehydratedSsrTodoState(): Promise<DehydratedDbState> {
  const dbClient = new DbClient()
  const todos = dbClient.collection(ssrTodoCollection)
  const openTodos = createLiveQueryCollection((q) =>
    q.from({ todo: todos }).where(({ todo }) => eq(todo.status, `open`)),
  )

  await openTodos.preload()

  return dbClient.dehydrate()
}

export function applyStreamedTodo(dbClient: DbClient): void {
  dbClient.applyCollectionChunk({
    collectionId: ssrTodoCollectionId,
    rows: [
      {
        key: streamedTodo.id,
        value: streamedTodo,
      },
    ],
  })
}
