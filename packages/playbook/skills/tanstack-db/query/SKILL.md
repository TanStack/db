---
name: tanstack-db-query
description: |
  QueryCollection with TanStack Query integration.
  Use for REST API integration, sync modes, refetching, and predicate push-down.
---

# QueryCollection

QueryCollection integrates TanStack Query with TanStack DB, enabling REST API data to be queried with live queries. Data fetched via `queryFn` automatically syncs to the in-memory collection.

## Common Patterns

### Basic Setup

```tsx
import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { QueryClient } from '@tanstack/react-query'

const queryClient = new QueryClient()

const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => {
      const response = await fetch('/api/todos')
      return response.json()
    },
    getKey: (item) => item.id,
    queryClient,
  }),
)
```

### With Persistence Handlers

```tsx
const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => api.todos.getAll(),
    getKey: (item) => item.id,
    queryClient,

    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => api.todos.create(m.modified)),
      )
      // Refetch happens automatically after handler completes
    },

    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          api.todos.update(m.original.id, m.changes),
        ),
      )
    },

    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => api.todos.delete(m.original.id)),
      )
    },
  }),
)
```

### Skip Auto-Refetch

```tsx
onInsert: async ({ transaction }) => {
  await api.todos.create(transaction.mutations[0].modified)
  return { refetch: false } // Don't refetch after this handler
}
```

### With Schema Validation

```tsx
import { z } from 'zod'

const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  completed: z.boolean().default(false),
  created_at: z.coerce.date().default(() => new Date()),
})

const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => api.todos.getAll(),
    getKey: (item) => item.id,
    queryClient,
    schema: todoSchema, // Validates and transforms data
  }),
)
```

### Select from Wrapped Response

```tsx
// API returns { data: Todo[], total: number, page: number }
const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => api.todos.paginated({ page: 1 }),
    select: (response) => response.data, // Extract array from wrapper
    getKey: (item) => item.id,
    queryClient,
  }),
)
```

### Dynamic Query Key

```tsx
const todoCollection = createCollection(
  queryCollectionOptions({
    // Function-based queryKey for dynamic values
    queryKey: (opts) => ['todos', opts.where, opts.orderBy],
    queryFn: async (ctx) => {
      const opts = ctx.meta?.loadSubsetOptions
      return api.todos.query(opts)
    },
    getKey: (item) => item.id,
    queryClient,
    syncMode: 'on-demand',
  }),
)
```

## Sync Modes

| Mode          | Behavior                                   | Best For                                |
| ------------- | ------------------------------------------ | --------------------------------------- |
| `eager`       | Load entire collection upfront (default)   | <10k rows, mostly static data           |
| `on-demand`   | Load only what queries request             | >50k rows, search interfaces, catalogs  |
| `progressive` | Load query subset, sync full in background | Collaborative apps, instant first paint |

### On-Demand Mode

```tsx
import { parseLoadSubsetOptions } from '@tanstack/query-db-collection'

const productsCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => ['products', opts],
    queryFn: async (ctx) => {
      // Parse predicates from live query
      const { where, orderBy, limit } = parseLoadSubsetOptions(
        ctx.meta?.loadSubsetOptions,
      )
      return api.products.search({ where, orderBy, limit })
    },
    getKey: (item) => item.id,
    queryClient,
    syncMode: 'on-demand',
  }),
)

// Live queries drive which data loads
const results = useLiveQuery((db) =>
  db.products.where({ category: 'electronics' }).limit(20),
)
```

### Predicate Push-down

Extract and forward query predicates to your API:

```tsx
import {
  parseWhereExpression,
  parseOrderByExpression,
  extractSimpleComparisons,
} from '@tanstack/query-db-collection'

queryFn: async (ctx) => {
  const opts = ctx.meta?.loadSubsetOptions

  // Parse where clause into simple comparisons
  if (opts?.where) {
    const comparisons = extractSimpleComparisons(opts.where)
    // comparisons: [{ field: 'category', operator: 'eq', value: 'electronics' }]
  }

  // Parse order by
  if (opts?.orderBy) {
    const order = parseOrderByExpression(opts.orderBy)
    // order: [{ field: 'createdAt', direction: 'desc' }]
  }

  return api.search({ ...comparisons, orderBy: order })
}
```

## Utility Methods

```tsx
// Manual refetch
await todoCollection.utils.refetch()
await todoCollection.utils.refetch({ throwOnError: true })

// Direct writes (bypass queryFn, write directly to store)
todoCollection.utils.writeInsert({ id: '1', text: 'New' })
todoCollection.utils.writeUpdate({ id: '1', text: 'Updated' })
todoCollection.utils.writeDelete('1')
todoCollection.utils.writeUpsert({ id: '1', text: 'Upsert' })
todoCollection.utils.writeBatch(() => {
  todoCollection.utils.writeInsert(item1)
  todoCollection.utils.writeInsert(item2)
})

// Query state
todoCollection.utils.isLoading // First fetch in progress
todoCollection.utils.isFetching // Any fetch in progress
todoCollection.utils.isRefetching // Background refetch
todoCollection.utils.isError // Has error
todoCollection.utils.lastError // Error object
todoCollection.utils.errorCount // Consecutive failures
todoCollection.utils.dataUpdatedAt // Last successful update timestamp
todoCollection.utils.fetchStatus // 'fetching' | 'paused' | 'idle'

// Clear error and retry
await todoCollection.utils.clearError()
```

## Configuration Options

```tsx
queryCollectionOptions({
  // Required
  queryKey: QueryKey | ((opts: LoadSubsetOptions) => QueryKey),
  queryFn: (context: QueryFunctionContext) => Promise<T[]>,
  getKey: (item: T) => Key,
  queryClient: QueryClient,

  // Optional
  schema?: StandardSchema,        // Validation schema
  select?: (data: TQueryData) => T[], // Extract array from response
  syncMode?: 'eager' | 'on-demand', // Default: 'eager'

  // TanStack Query options
  enabled?: boolean,              // Auto-fetch (default: true)
  refetchInterval?: number,       // Poll interval in ms
  retry?: number | boolean,       // Retry count
  retryDelay?: number | ((attempt) => number),
  staleTime?: number,             // Cache freshness in ms
  meta?: Record<string, unknown>, // Custom metadata for queryFn

  // Persistence handlers
  onInsert?: MutationFn,
  onUpdate?: MutationFn,
  onDelete?: MutationFn,
})
```

## Common Patterns

### Polling

```tsx
const statsCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['stats'],
    queryFn: () => api.stats.current(),
    getKey: (item) => item.id,
    queryClient,
    refetchInterval: 30000, // Refetch every 30 seconds
  }),
)
```

### Conditional Fetching

```tsx
const userTodosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos', userId],
    queryFn: () => api.todos.forUser(userId),
    getKey: (item) => item.id,
    queryClient,
    enabled: !!userId, // Only fetch when userId exists
  }),
)
```

### Sharing QueryClient

```tsx
// Use your app's existing QueryClient
import { queryClient } from './queryClient'

const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: () => api.todos.getAll(),
    getKey: (item) => item.id,
    queryClient, // Shares cache with other queries
  }),
)
```

## Detailed References

| Reference                          | When to Use                                |
| ---------------------------------- | ------------------------------------------ |
| `references/sync-modes.md`         | Choosing between eager/on-demand modes     |
| `references/predicate-pushdown.md` | Forwarding query predicates to APIs        |
| `references/direct-writes.md`      | Using writeInsert/writeUpdate/writeDelete  |
| `references/query-state.md`        | Monitoring loading, error, and fetch state |
