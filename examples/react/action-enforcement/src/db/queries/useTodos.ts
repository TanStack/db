import { useLiveQuery } from '@tanstack/react-db'
import { todoCollection } from '@/db/collections/todoCollection'

export function useTodos() {
  return useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .orderBy(({ todo }) => todo.createdAt, 'desc'),
  )
}
