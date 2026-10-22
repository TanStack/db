// The typical app, plus a live query that joins a second collection.
import { createCollection, eq, leftJoin } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { useLiveQuery } from '@tanstack/react-db'
import { queryClient, todos } from './app.js'

export * from './app.js'

const users = createCollection(
  queryCollectionOptions({
    queryKey: [`users`],
    queryFn: () => fetch(`/api/users`).then((response) => response.json()),
    queryClient,
    getKey: (user) => user.id,
  }),
)

export function AssignedTodos() {
  const { data } = useLiveQuery((q) =>
    q
      .from({ todo: todos })
      .join(
        leftJoin({ user: users }, ({ todo, user }) => eq(todo.userId, user.id)),
      )
      .select(({ todo, user }) => ({ title: todo.title, owner: user.name })),
  )
  return data
}
