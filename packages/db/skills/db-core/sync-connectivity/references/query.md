# TanStack Query Adapter Reference

Package: `@tanstack/query-db-collection`

## Setup

```typescript
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { QueryClient } from '@tanstack/react-query'

const queryClient = new QueryClient()

const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => {
      const res = await fetch('/api/todos')
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      return res.json()
    },
    queryClient,
    getKey: (todo) => todo.id,
    onInsert: async ({ transaction }) => {
      const item = transaction.mutations[0].modified
      await fetch('/api/todos', {
        method: 'POST',
        body: JSON.stringify(item),
      })
      await todosCollection.utils.refetch()
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      await fetch(`/api/todos/${original.id}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
      await todosCollection.utils.refetch()
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      await fetch(`/api/todos/${original.id}`, { method: 'DELETE' })
      await todosCollection.utils.refetch()
    },
  }),
)
```

## Configuration

```typescript
queryCollectionOptions({
  // Required
  queryKey: QueryKey | ((opts: LoadSubsetOptions) => QueryKey),
  queryFn: (context: QueryFunctionContext) => Promise<Array<T>>,
  queryClient: QueryClient,
  getKey: (item: T) => string | number,

  // Optional — TanStack Query options
  select: (data: TQueryData) => Array<T>,
  enabled: boolean,
  refetchInterval: number,
  retry: boolean | number,
  retryDelay: number | ((attempt: number) => number),
  staleTime: number,
  meta: Record<string, unknown>,

  // Optional — collection options
  id: string,
  schema: StandardSchemaV1,
  syncMode: 'eager' | 'on-demand',

  // Handlers
  onInsert: (params) => Promise<void | { refetch: false }>,
  onUpdate: (params) => Promise<void | { refetch: false }>,
  onDelete: (params) => Promise<void | { refetch: false }>,
})
```

Handlers can return `{ refetch: false }` to skip automatic refetch after
the mutation.

## Utils — Refetch

```typescript
// Refetch all query observers
await collection.utils.refetch()
await collection.utils.refetch({ throwOnError: true })
```

Always await `refetch()` in handlers to prevent the optimistic state flash
(optimistic state drops when the handler resolves — if server state hasn't
arrived yet, data briefly disappears).

## Utils — Direct Writes

Update the collection without a full refetch. Useful for WebSocket-driven
updates or when the server response contains the updated item:

```typescript
collection.utils.writeInsert(item)
collection.utils.writeInsert([item1, item2])

collection.utils.writeUpdate({ id: '1', title: 'Updated' })
collection.utils.writeUpdate([partial1, partial2])

collection.utils.writeDelete('item-id')
collection.utils.writeDelete(['id1', 'id2'])

collection.utils.writeUpsert(item)  // insert or update by key
collection.utils.writeUpsert([item1, item2])

// Batch multiple writes atomically
collection.utils.writeBatch(() => {
  collection.utils.writeInsert(newItem)
  collection.utils.writeDelete('old-id')
})
```

**Warning**: Direct writes are overwritten by the next `queryFn` execution.
The server must have the data before the next refetch, or coordinate with
`staleTime` to delay it.

## Utils — Query State

```typescript
collection.utils.isError       // boolean
collection.utils.errorCount    // number
collection.utils.lastError     // Error | undefined
collection.utils.isFetching    // boolean
collection.utils.isRefetching  // boolean
collection.utils.isLoading     // boolean
collection.utils.dataUpdatedAt // timestamp
collection.utils.fetchStatus   // 'fetching' | 'paused' | 'idle'

// Clear error and trigger refetch
await collection.utils.clearError()
```

## On-Demand Mode

For large datasets, use `syncMode: 'on-demand'` so the collection only
loads data that active queries request:

```typescript
queryCollectionOptions({
  queryKey: ['products'],
  queryFn: async (ctx) => {
    const opts = ctx.meta?.loadSubsetOptions
    const params = new URLSearchParams()
    if (opts?.where) params.set('filter', JSON.stringify(opts.where))
    if (opts?.limit) params.set('limit', String(opts.limit))
    return fetch(`/api/products?${params}`).then((r) => r.json())
  },
  syncMode: 'on-demand',
  queryClient,
  getKey: (p) => p.id,
})
```

The query builder's predicates are passed to `queryFn` via
`ctx.meta.loadSubsetOptions`, which contains `where`, `orderBy`, `limit`,
and `offset` from the active queries.

## Full State Sync

`queryFn` result is treated as the **complete** server state. Returning
`[]` means "server has zero items" and deletes everything. Returning
partial data deletes non-returned items. Always return the full set or
throw on errors.
