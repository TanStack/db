# TanStack Query Adapter Reference

Package: `@tanstack/query-db-collection`

## Setup

```typescript
import { QueryClient } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const queryClient = new QueryClient()

const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => {
      const response = await fetch('/api/todos')
      if (!response.ok) throw new Error(`Failed: ${response.status}`)
      return response.json()
    },
    queryClient,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const newItems = transaction.mutations.map((m) => m.modified)
      await api.createTodos(newItems)
    },
    onUpdate: async ({ transaction }) => {
      const updates = transaction.mutations.map((m) => ({
        id: m.key,
        changes: m.changes,
      }))
      await api.updateTodos(updates)
    },
    onDelete: async ({ transaction }) => {
      const ids = transaction.mutations.map((m) => m.key)
      await api.deleteTodos(ids)
    },
  }),
)
```

Source: docs/collections/query-collection.md — Basic Usage, Persistence Handlers

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

Source: packages/query-db-collection/src/query.ts:60-143

## Controlling Refetch Behavior

By default, after any handler completes, the query automatically
refetches. Return `{ refetch: false }` to skip it:

```typescript
onInsert: async ({ transaction }) => {
  const newItems = transaction.mutations.map((m) => m.modified)
  const serverItems = await api.createTodos(newItems)

  // Write server response directly instead of refetching
  todosCollection.utils.writeBatch(() => {
    serverItems.forEach((item) => {
      todosCollection.utils.writeInsert(item)
    })
  })

  return { refetch: false }
},
```

Source: docs/collections/query-collection.md — Controlling Refetch Behavior

## Utils — Refetch

```typescript
// Manually trigger a refetch
await collection.utils.refetch()
await collection.utils.refetch({ throwOnError: true })
```

Source: docs/collections/query-collection.md — Utility Methods

## Utils — Direct Writes

Update the collection without a full refetch. Useful for WebSocket-driven
updates or when the server response contains the updated item:

```typescript
collection.utils.writeInsert(item)
collection.utils.writeInsert([item1, item2])

collection.utils.writeUpdate({ id: '1', completed: true })
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

Direct writes:
- Write directly to the synced data store
- Do NOT create optimistic mutations
- Do NOT trigger automatic query refetches
- Update the TanStack Query cache immediately

**Warning**: Direct writes are overwritten by the next `queryFn`
execution. The server must have the data before the next refetch, or
use `staleTime` / `{ refetch: false }` to coordinate.

Source: docs/collections/query-collection.md — Direct Writes

## Utils — Query State

```typescript
collection.utils.isError       // boolean
collection.utils.errorCount    // number
collection.utils.lastError     // Error | undefined
collection.utils.isFetching    // boolean
collection.utils.isRefetching  // boolean
collection.utils.isLoading     // boolean
collection.utils.dataUpdatedAt // timestamp (milliseconds)
collection.utils.fetchStatus   // 'fetching' | 'paused' | 'idle'

// Clear error state and trigger refetch
await collection.utils.clearError()
```

Source: packages/query-db-collection/src/query.ts:167-206

## On-Demand Mode

For large datasets, use `syncMode: 'on-demand'` so the collection only
loads data that active queries request:

```typescript
import { parseLoadSubsetOptions } from '@tanstack/query-db-collection'

const productsCollection = createCollection(
  queryCollectionOptions({
    id: 'products',
    queryKey: ['products'],
    queryClient,
    getKey: (item) => item.id,
    syncMode: 'on-demand',
    queryFn: async (ctx) => {
      const { limit, offset, where, orderBy } = ctx.meta.loadSubsetOptions
      const parsed = parseLoadSubsetOptions({ where, orderBy, limit })

      const params = new URLSearchParams()
      parsed.filters.forEach(({ field, operator, value }) => {
        const fieldName = field.join('.')
        if (operator === 'eq') params.set(fieldName, String(value))
        else if (operator === 'lt') params.set(`${fieldName}_lt`, String(value))
        else if (operator === 'gt') params.set(`${fieldName}_gt`, String(value))
      })
      if (parsed.limit) params.set('limit', String(parsed.limit))
      if (offset) params.set('offset', String(offset))

      const response = await fetch(`/api/products?${params}`)
      return response.json()
    },
  }),
)
```

The query builder's predicates are passed to `queryFn` via
`ctx.meta.loadSubsetOptions`, containing `where`, `orderBy`, `limit`,
and `offset` from the active queries.

Source: docs/collections/query-collection.md — QueryFn and Predicate Push-Down

## Expression Helpers

```typescript
import {
  parseLoadSubsetOptions,
  parseWhereExpression,
  parseOrderByExpression,
  extractSimpleComparisons,
} from '@tanstack/query-db-collection'
```

- `parseLoadSubsetOptions(opts)` — parse all options at once
- `parseWhereExpression(expr, { handlers })` — custom operator handling
- `parseOrderByExpression(orderBy)` — parse ORDER BY to array
- `extractSimpleComparisons(expr)` — extract AND-ed comparisons

Source: packages/query-db-collection/src/index.ts:14-27

## Using with queryOptions()

Spread existing TanStack Query `queryOptions` into collection config.
`queryFn` must be explicitly provided:

```typescript
import { queryOptions } from '@tanstack/react-query'

const listOptions = queryOptions({
  queryKey: ['todos'],
  queryFn: async () => {
    const response = await fetch('/api/todos')
    return response.json()
  },
})

const todosCollection = createCollection(
  queryCollectionOptions({
    ...listOptions,
    queryFn: (context) => listOptions.queryFn!(context),
    queryClient,
    getKey: (item) => item.id,
  }),
)
```

If `queryFn` is missing at runtime, throws `QueryFnRequiredError`.

Source: docs/collections/query-collection.md — Using with queryOptions

## Full State Sync

`queryFn` result is treated as the **complete** server state. Returning
`[]` means "server has zero items" and deletes everything. Returning
partial data deletes non-returned items. Always return the full set or
throw on errors.

Source: docs/collections/query-collection.md — Full State Sync
