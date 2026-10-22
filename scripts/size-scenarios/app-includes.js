// The typical app, plus a live query whose rows include a child query.
import { createCollection, eq, toArray } from '@tanstack/db'
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

export function UsersWithTodos() {
  const { data } = useLiveQuery((q) =>
    q.from({ user: users }).select(({ user }) => ({
      name: user.name,
      todos: toArray(
        q.from({ todo: todos }).where(({ todo }) => eq(todo.userId, user.id)),
      ),
    })),
  )
  return data
}
