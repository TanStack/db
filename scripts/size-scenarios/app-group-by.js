// The typical app, plus a live query that groups and counts.
import { count } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { todos } from './app.js'

export * from './app.js'

export function TodosPerUser() {
  const { data } = useLiveQuery((q) =>
    q
      .from({ todo: todos })
      .groupBy(({ todo }) => todo.userId)
      .select(({ todo }) => ({ userId: todo.userId, total: count(todo.id) })),
  )
  return data
}
