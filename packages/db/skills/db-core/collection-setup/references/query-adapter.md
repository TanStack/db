# Query Adapter Reference

## Install

```bash
pnpm add @tanstack/query-db-collection @tanstack/query-core @tanstack/db
```

## Required Config

```typescript
import { QueryClient } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const queryClient = new QueryClient()
const collection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then((r) => r.json()),
    queryClient,
    getKey: (item) => item.id,
  }),
)
```

- `queryKey` -- TanStack Query cache key
- `queryFn` -- fetches data; must be provided (throws `QueryFnRequiredError` if missing)
- `queryClient` -- `QueryClient` instance
- `getKey` -- extracts unique key from each item

## Optional Config (with defaults)

| Option            | Default      | Description                                     |
| ----------------- | ------------ | ----------------------------------------------- |
| `id`              | (none)       | Unique collection identifier                    |
| `schema`          | (none)       | StandardSchema validator                        |
| `select`          | (none)       | Extracts array items when wrapped with metadata |
| `enabled`         | `true`       | Whether query runs automatically                |
| `refetchInterval` | `0`          | Polling interval in ms; 0 = disabled            |
| `retry`           | (TQ default) | Retry config for failed queries                 |
| `retryDelay`      | (TQ default) | Delay between retries                           |
| `staleTime`       | (TQ default) | How long data is considered fresh               |
| `meta`            | (none)       | Metadata passed to queryFn context              |
| `startSync`       | `true`       | Start syncing immediately                       |
| `syncMode`        | (none)       | Set `"on-demand"` for predicate push-down       |

### Persistence Handlers

```typescript
onInsert: async ({ transaction }) => {
  await api.createTodos(transaction.mutations.map((m) => m.modified))
  // return nothing or { refetch: true } to trigger refetch
  // return { refetch: false } to skip refetch
},
onUpdate: async ({ transaction }) => {
  await api.updateTodos(transaction.mutations.map((m) => ({ id: m.key, changes: m.changes })))
},
onDelete: async ({ transaction }) => {
  await api.deleteTodos(transaction.mutations.map((m) => m.key))
},
```

## Utility Methods (`collection.utils`)

- `refetch(opts?)` -- manual refetch; `opts.throwOnError` (default `false`); bypasses `enabled: false`
- `writeInsert(data)` -- insert directly to synced store (bypasses optimistic system)
- `writeUpdate(data)` -- update directly in synced store
- `writeDelete(keys)` -- delete directly from synced store
- `writeUpsert(data)` -- insert or update directly
- `writeBatch(callback)` -- multiple write ops atomically

Direct writes bypass optimistic updates, do NOT trigger refetches, and update TQ cache immediately.

```typescript
collection.utils.writeBatch(() => {
  collection.utils.writeInsert({ id: '1', text: 'Buy milk' })
  collection.utils.writeUpdate({ id: '2', completed: true })
  collection.utils.writeDelete('3')
})
```

## Predicate Push-Down (syncMode: "on-demand")

Query predicates (where, orderBy, limit, offset) passed to `queryFn` via `ctx.meta.loadSubsetOptions`.

```typescript
import { parseLoadSubsetOptions } from '@tanstack/query-db-collection'

queryFn: async (ctx) => {
  const { filters, sorts, limit, offset } = parseLoadSubsetOptions(
    ctx.meta?.loadSubsetOptions,
  )
  // filters: [{ field: ['category'], operator: 'eq', value: 'electronics' }]
  // sorts: [{ field: ['price'], direction: 'asc', nulls: 'last' }]
}
```

### Expression Helpers (from `@tanstack/db`)

- `parseLoadSubsetOptions(opts)` -- returns `{ filters, sorts, limit, offset }`
- `parseWhereExpression(expr, { handlers })` -- custom handlers per operator
- `parseOrderByExpression(expr)` -- returns `[{ field, direction, nulls }]`
- `extractSimpleComparisons(expr)` -- flat AND-ed comparisons only

Supported operators: `eq`, `gt`, `gte`, `lt`, `lte`, `and`, `or`, `in`

## Dynamic queryKey

```typescript
queryKey: (opts) => {
  const parsed = parseLoadSubsetOptions(opts)
  const key = ["products"]
  parsed.filters.forEach((f) => key.push(`${f.field.join(".")}-${f.operator}-${f.value}`))
  if (parsed.limit) key.push(`limit-${parsed.limit}`)
  return key
},
```

## Complete Example

```typescript
import { QueryClient } from '@tanstack/query-core'
import { createCollection } from '@tanstack/react-db'
import {
  queryCollectionOptions,
  parseLoadSubsetOptions,
} from '@tanstack/query-db-collection'

const queryClient = new QueryClient()

const productsCollection = createCollection(
  queryCollectionOptions({
    id: 'products',
    queryKey: ['products'],
    queryClient,
    getKey: (item) => item.id,
    syncMode: 'on-demand',
    queryFn: async (ctx) => {
      const { filters, sorts, limit } = parseLoadSubsetOptions(
        ctx.meta?.loadSubsetOptions,
      )
      const params = new URLSearchParams()
      filters.forEach(({ field, operator, value }) => {
        params.set(`${field.join('.')}_${operator}`, String(value))
      })
      if (sorts.length > 0) {
        params.set(
          'sort',
          sorts.map((s) => `${s.field.join('.')}:${s.direction}`).join(','),
        )
      }
      if (limit) params.set('limit', String(limit))
      return fetch(`/api/products?${params}`).then((r) => r.json())
    },
    onInsert: async ({ transaction }) => {
      const serverItems = await api.createProducts(
        transaction.mutations.map((m) => m.modified),
      )
      productsCollection.utils.writeBatch(() => {
        serverItems.forEach((item) =>
          productsCollection.utils.writeInsert(item),
        )
      })
      return { refetch: false }
    },
    onUpdate: async ({ transaction }) => {
      await api.updateProducts(
        transaction.mutations.map((m) => ({ id: m.key, changes: m.changes })),
      )
    },
    onDelete: async ({ transaction }) => {
      await api.deleteProducts(transaction.mutations.map((m) => m.key))
    },
  }),
)
```

## Key Behaviors

- `queryFn` result is treated as **complete state** -- missing items are deleted
- Empty array from `queryFn` deletes all items
- Direct writes update TQ cache but are overridden by subsequent `queryFn` results
