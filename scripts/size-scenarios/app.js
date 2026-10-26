// The typical app: a TanStack Query collection with an update handler, and a
// filtered, ordered live query read through the React adapter. Every other
// scenario adds one feature to this app, so its delta is that feature's cost.
import { QueryClient } from '@tanstack/query-core'
import { createCollection, eq } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { useLiveQuery } from '@tanstack/react-db'

export const queryClient = new QueryClient()

export const todos = createCollection(
  queryCollectionOptions({
    queryKey: [`todos`],
    queryFn: () => fetch(`/api/todos`).then((response) => response.json()),
    queryClient,
    getKey: (todo) => todo.id,
    onUpdate: async ({ transaction }) => {
      await fetch(`/api/todos`, {
        method: `PATCH`,
        body: JSON.stringify(transaction.mutations.map((m) => m.modified)),
      })
    },
  }),
)

export function OpenTodos() {
  const { data } = useLiveQuery((q) =>
    q
      .from({ todo: todos })
      .where(({ todo }) => eq(todo.done, false))
      .orderBy(({ todo }) => todo.createdAt)
      .limit(20),
  )
  return data
}
