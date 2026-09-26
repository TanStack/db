import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { queryClient } from '@/db/queryClient'
import { listTodos } from '@/db/server/fakeTodoApi'

export const todoCollection = createCollection(
  queryCollectionOptions({
    id: 'todos',
    queryKey: ['todos'],
    queryClient,
    queryFn: listTodos,
    getKey: (item) => item.id,
  }),
)
