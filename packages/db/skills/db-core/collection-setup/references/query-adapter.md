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
    queryFn: async (ctx) =>
      fetch('/api/todos', { signal: ctx.signal }).then((r) => r.json()),
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

| Option                 | Default      | Description                                     |
| ---------------------- | ------------ | ----------------------------------------------- |
| `id`                   | (none)       | Unique collection identifier                    |
| `schema`               | (none)       | StandardSchema validator                        |
| `select`               | (none)       | Extracts rows from the original response shape  |
| `enabled`              | `true`       | Whether query runs automatically                |
| `refetchInterval`      | (TQ default) | Polling interval                                |
| `retry` / `retryDelay` | (TQ default) | Retry policy                                    |
| `staleTime` / `gcTime` | (TQ default) | Freshness and unused-cache retention            |
| `refetchOnWindowFocus` | (TQ default) | Refetch when the window regains focus           |
| `refetchOnReconnect`   | (TQ default) | Refetch after reconnecting                      |
| `refetchOnMount`       | (TQ default) | Refetch when the observer mounts                |
| `networkMode`          | (TQ default) | TanStack Query network mode                     |
| `initialData`          | (none)       | Initial response for eager collections          |
| `initialDataUpdatedAt` | (none)       | Timestamp used to judge initial-data freshness  |
| `meta`                 | (none)       | Metadata merged into the query function context |
| `startSync`            | `true`       | Start syncing immediately                       |
| `syncMode`             | `eager`      | Set `"on-demand"` for predicate push-down       |

Query Client defaults apply when these pass-through fields are omitted.
`placeholderData` is intentionally unsupported: it is observer-local UI state,
not cache data, so it must not become collection-wide rows.

### Persistence Handlers

```typescript
onInsert: async ({ transaction }) => {
  await api.createTodos(transaction.mutations.map((m) => m.modified))
  // Query Collection automatically refetches and awaits the result.
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

## Response Shape, Initial Data, and Query Options

`select` is a Query Collection row-extraction hook, not TanStack Query's
observer-level projection. The Query cache keeps the original response while
the collection materializes the returned row array:

```typescript
const collection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: fetchTodosResponse,
    initialData: {
      items: [{ id: '1', title: 'Initial todo' }],
      total: 1,
    },
    initialDataUpdatedAt: Date.now(),
    staleTime: 60_000,
    select: (response) => response.items,
    queryClient,
    getKey: (todo) => todo.id,
  }),
)
```

The same `select` applies to fetched and initial responses. Cached or hydrated
data for the same exact Query key takes precedence over a later `initialData`
value. `initialData` is supported only in eager mode; seed the exact derived
Query cache entries for on-demand subsets.

Passing either `initialData` or `initialDataUpdatedAt` in on-demand mode throws
`InitialDataInOnDemandModeError`. When stale initial data triggers a fetch, the
rows remain visible while it runs. A failed fetch retains them; a successful
fetch reconciles them normally.

Direct writes can preserve simple wrappers such as `{ data: [...] }`,
`{ items: [...] }`, or `{ results: [...] }`. For a derived projection such as
`response.edges.map((edge) => edge.node)`, refetch or invalidate when the
wrapped cache must reflect the write exactly.

You may spread compatible `queryOptions(...)` output into
`queryCollectionOptions`, but provide `queryFn` explicitly. Do not pass a
TanStack Query observer-level `select`; Query Collection gives that name the
row-extraction contract above.

## Runtime QueryClient and Business Scopes

When a `QueryClient` is request-, router-, tenant-, or test-scoped, put shared
options in a factory and create one stable collection per client and business
scope:

```typescript
function createProjectTodosCollection(
  queryClient: QueryClient,
  projectId: string,
) {
  return createCollection(
    queryCollectionOptions({
      queryKey: ['projects', projectId, 'todos'],
      queryFn: () => fetchProjectTodos(projectId),
      queryClient,
      getKey: (todo) => todo.id,
    }),
  )
}

type ProjectTodosCollection = ReturnType<typeof createProjectTodosCollection>

const projectCollections = new WeakMap<
  QueryClient,
  Map<string, ProjectTodosCollection>
>()

export function getProjectTodosCollection(
  queryClient: QueryClient,
  projectId: string,
): ProjectTodosCollection {
  let collectionsByProject = projectCollections.get(queryClient)
  if (!collectionsByProject) {
    collectionsByProject = new Map()
    projectCollections.set(queryClient, collectionsByProject)
  }

  let collection = collectionsByProject.get(projectId)
  if (!collection) {
    collection = createProjectTodosCollection(queryClient, projectId)
    collectionsByProject.set(projectId, collection)
  }

  return collection
}

export async function removeProjectTodosCollection(
  queryClient: QueryClient,
  projectId: string,
): Promise<void> {
  const collectionsByProject = projectCollections.get(queryClient)
  if (!collectionsByProject) return

  const collection = collectionsByProject.get(projectId)
  if (!collection) return

  collectionsByProject.delete(projectId)
  if (collectionsByProject.size === 0) {
    projectCollections.delete(queryClient)
  }
  await collection.cleanup()
}
```

Memoize by `QueryClient` and every scope value. Do not create the collection
during every render or in each consumer. Clean up and remove unused entries
from long-lived scope maps when your application owns their lifecycle.

A business scope names a distinct server resource. A relational subset
(`where`, `orderBy`, `limit`, or `offset`) stays within that collection and, in
on-demand mode, reaches `queryFn` as `ctx.meta.loadSubsetOptions`. Do not create
a collection for each relational subset.

## Request Cancellation and Cleanup

TanStack Query passes an `AbortSignal` through the query function context.
Forward it to `fetch` or another abortable client:

```typescript
queryFn: async (ctx) => {
  const response = await fetch('/api/todos', { signal: ctx.signal })
  return response.json()
},
```

Explicit `collection.cleanup()` cancels each exact Query key the collection is
currently tracking, then removes it from the Query cache. The underlying client
stops work only when it consumes `ctx.signal`.

An unloaded on-demand subset is no longer tracked, so later collection cleanup
does not revisit its Query key. Unloading does not explicitly call
`queryClient.cancelQueries()`: it removes the subset's Query observer. If that
was the final observer and the query function consumed `ctx.signal`, Query Core
aborts the request. If the signal was ignored, or another observer still uses
the same exact key, the request may finish and remain cached until `gcTime`.

Query cache entries are shared within a `QueryClient`. Explicit cleanup can
cancel or remove entries used by another collection or Query consumer with the
same exact key.

## Query Invalidation

Exact-key and prefix invalidation refetch active eager and on-demand queries,
then rematerialize their results. Overlapping subsets keep rows that another
active subset still owns. A failed refetch retains current rows and records the
error in `collection.utils.lastError`. Cleaned-up or otherwise inactive queries
do not rematerialize.

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
      return fetch(`/api/products?${params}`, {
        signal: ctx.signal,
      }).then((r) => r.json())
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

## Common Mistakes

### HIGH Function-based queryKey without shared prefix

Wrong:

```ts
queryCollectionOptions({
  queryKey: (opts) => {
    if (opts.where) {
      return ['products-filtered', JSON.stringify(opts.where)]
    }
    return ['products-all']
  },
})
```

Correct:

```ts
queryCollectionOptions({
  queryKey: (opts) => {
    if (opts.where) {
      return ['products', JSON.stringify(opts.where)]
    }
    return ['products']
  },
})
```

When using a function-based `queryKey`, all derived keys must share the base key (`queryKey({})`) as a prefix. TanStack Query uses prefix matching for cache operations; if derived keys don't share the base prefix, cache updates silently miss entries, leading to stale data.

## Key Behaviors

- In eager mode, each `queryFn` result is complete collection state
- In on-demand mode, it is complete state for that exact subset/Query key
- An empty subset removes that subset's ownership; overlapping subsets can keep
  the same rows materialized
- Direct writes update TQ cache but are overridden by subsequent `queryFn` results
- Persistence handlers automatically refetch unless they return `{ refetch: false }`
- On-demand `collection.preload()` is a no-op; preload the live query instead
