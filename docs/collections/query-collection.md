---
title: Query Collection
---

Query collections provide seamless integration between TanStack DB and TanStack Query, enabling automatic synchronization between your local database and remote data sources.

## Overview

The `@tanstack/query-db-collection` package allows you to create collections that:

- Automatically fetch remote data via TanStack Query
- Support optimistic updates with automatic rollback on errors
- Handle persistence through customizable mutation handlers
- Provide direct write capabilities for directly writing to the sync store

## Installation

```bash
npm install @tanstack/query-db-collection @tanstack/query-core @tanstack/db
```

## Basic Usage

```typescript
import { QueryClient } from "@tanstack/query-core"
import { DbClient, collectionOptions } from "@tanstack/db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"

const queryClient = new QueryClient()
const db = new DbClient({ queryClient })

const todosCollection = collectionOptions("todos", (client) =>
  queryCollectionOptions({
    id: "todos",
    queryKey: ["todos"],
    queryFn: async () => {
      const response = await fetch("/api/todos")
      return response.json()
    },
    queryClient: client.requireDependency<QueryClient>("queryClient"),
    getKey: (item) => item.id,
  })
)

const todos = db.collection(todosCollection)
```

## Configuration Options

The `queryCollectionOptions` function accepts the following options:

### Required Options

- `queryKey`: The query key for TanStack Query. Can be a static array or a function that receives `LoadSubsetOptions` and returns a key. When using a function, all returned keys must share the base key (`queryKey({})`) as a prefix — see [Query Key Prefix Convention](#query-key-prefix-convention).
- `queryFn`: Function that fetches data from the server
- `queryClient`: TanStack Query client instance
- `getKey`: Function to extract the unique key from an item

### Request-scoped QueryClient

`queryCollectionOptions` needs a `queryClient`. In SSR, TanStack Start, tests,
or multi-tenant apps, that client is request-local rather than module-global.
Put it on `DbClient`, then resolve it inside the collection descriptor factory:

```typescript
import { QueryClient } from "@tanstack/query-core"
import { DbClient, collectionOptions } from "@tanstack/db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"

interface Todo {
  id: string
  title: string
}

export const todoCollection = collectionOptions("todos", (client) =>
  queryCollectionOptions<Todo>({
    id: "todos",
    queryKey: ["todos"],
    queryFn: async () => {
      const response = await fetch("/api/todos")
      return response.json() as Promise<Array<Todo>>
    },
    queryClient: client.requireDependency<QueryClient>("queryClient"),
    getKey: (todo) => todo.id,
  })
)

export function createRequestClients() {
  const queryClient = new QueryClient()
  const dbClient = new DbClient({ queryClient })
  return { queryClient, dbClient }
}
```

`dbClient.collection(todoCollection)` memoizes one collection instance for that
descriptor and client. A second `DbClient` materializes fresh adapter state and
uses its own `QueryClient`.

Passing `queryClient` directly to `queryCollectionOptions` remains supported for
`createCollection(...)` and existing apps. When a descriptor is materialized,
an explicit `DbClient` dependency takes precedence; the configured
`queryClient` is the backwards-compatible fallback.

### Business-Scoped Collection Factories

A tenant, project, account, or route parameter can define a **business scope**:
the server resource that a collection represents. Include the scope in the
descriptor id, Query key, and `queryFn`. This extends the
[request-scoped QueryClient pattern](#request-scoped-queryclient) with an
explicit scope parameter:

```typescript
interface Todo {
  id: string
  title: string
  projectId: string
}

async function fetchProjectTodos(projectId: string): Promise<Array<Todo>> {
  const response = await fetch(`/api/projects/${projectId}/todos`)
  return response.json()
}

function createProjectTodosDescriptor(
  projectId: string,
) {
  return collectionOptions(`project:${projectId}:todos`, (client) =>
    queryCollectionOptions<Todo>({
      id: `project:${projectId}:todos`,
      queryKey: ["projects", projectId, "todos"],
      queryFn: () => fetchProjectTodos(projectId),
      queryClient: client.requireDependency<QueryClient>("queryClient"),
      getKey: (todo) => todo.id,
    })
  )
}
```

The scope is part of the descriptor identity. `DbClient` resolves separately
created descriptors with the same id to the same collection, so a React hook
can create the descriptor from its current parameters:

```typescript
export function useProjectTodos(projectId: string) {
  return useDbClient().collection(createProjectTodosDescriptor(projectId))
}
```

Only the first descriptor for an id is materialized. Include every scope value
that changes the collection in both its descriptor id and Query key. Call
`await dbClient.cleanup()` when the client scope ends.

A business scope is separate from a **relational subset** requested by a live query. With `syncMode: "on-demand"`, `LoadSubsetOptions` describes predicates, ordering, limits, and offsets within one business-scoped collection. These options reach `queryFn` through `ctx.meta.loadSubsetOptions` and determine the subset Query keys. See [QueryFn and Predicate Push-Down](#queryfn-and-predicate-push-down).

Do not create a collection for each `where`, `orderBy`, or `limit`. Reuse the business-scoped collection and let on-demand loading represent those subsets. Create separate collections only for distinct server resources.

### Query Options

Query Collections use TanStack Query internally and expose supported Query observer options as top-level `queryCollectionOptions` fields.

The following top-level Query Collection options are forwarded to the underlying Query observer:

- `select`: Function that extracts the row array TanStack DB materializes from a wrapped Query response
- `enabled`: Whether the query should automatically run (default: `true`)
- `refetchInterval`: Refetch interval in milliseconds
- `retry`: Retry configuration for failed queries
- `retryDelay`: Delay between retries
- `staleTime`: How long data is considered fresh
- `gcTime`: How long unused query data stays in the Query cache
- `refetchOnWindowFocus`: Whether to refetch when the window regains focus
- `refetchOnReconnect`: Whether to refetch when the network reconnects
- `refetchOnMount`: Whether to refetch when the observer mounts
- `networkMode`: Query network mode
- `initialData`: Initial Query response for eager collections
- `initialDataUpdatedAt`: Timestamp used by TanStack Query to determine initial data freshness
- `meta`: Metadata passed to the query function context. Query Collections may add `loadSubsetOptions` for on-demand queries.

```ts
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: fetchTodos,
    queryClient,
    getKey: (todo) => todo.id,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: "always",
    networkMode: "online",
  })
)
```

Top-level `meta` is always merged by Query Collection so it can add on-demand `loadSubsetOptions`. Other supported top-level Query options are only passed to TanStack Query when you define them. If you omit them, `QueryClient.defaultOptions` can still apply.

Some fields are owned or reinterpreted by the collection adapter rather than treated as ordinary Query option pass-through:

- `queryKey`: Identifies the Query cache entry and, in on-demand mode, may be built from load-subset options.
- `queryFn`: Fetches the complete collection state or the requested on-demand subset.
- `select`: Extracts array rows from wrapped responses before they are stored in the collection. This is not the same contract as TanStack Query's `select` option.
- `queryClient`: Supplies the Query client instance used by the collection.
- `syncMode`: Controls whether the collection syncs eagerly or on demand.
- `getKey`: Extracts each row's stable TanStack DB key.
- Mutation handlers such as `onInsert`, `onUpdate`, and `onDelete`.

Some TanStack Query fields are owned or reinterpreted by Query Collection and are intentionally not exposed as ordinary Query observer options:

- `queryKey`, `queryFn`, and `queryClient`
- `select` (Query Collection uses this for row extraction, not TanStack Query's observer-level `select` contract)
- `meta` (merged by Query Collection so on-demand `loadSubsetOptions` can be included)
- `subscribed` (Query Collection owns the observer subscription lifecycle)
- `structuralSharing` and `notifyOnChangeProps` (managed by Query Collection synchronization)

`placeholderData` is intentionally unsupported. TanStack Query treats placeholder data as observer-local presentation state rather than cached Query data. Materializing it would expose temporary UI data as collection-wide normalized rows. Render placeholders in the consuming UI instead.

### Request Cancellation with `QueryFunctionContext.signal`

TanStack Query passes an `AbortSignal` to `queryFn` through the query function
context. Forward `ctx.signal` to `fetch` or another abortable client to make the
request cancellable:

```typescript
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: async (ctx) => {
      const response = await fetch("/api/todos", {
        signal: ctx.signal,
      })

      if (!response.ok) {
        throw new Error("Failed to fetch todos")
      }

      return response.json() as Promise<Array<Todo>>
    },
    queryClient,
    getKey: (todo) => todo.id,
  }),
)
```

Explicit collection cleanup cancels each exact Query key the collection is
currently tracking before removing it from the Query cache:

```typescript
await todosCollection.cleanup()
```

The underlying request is aborted only when its client consumes `ctx.signal`.
A client that ignores the signal may continue its request even though the
collection has been cleaned up.

An unloaded on-demand subset is no longer tracked. A later explicit collection
cleanup does not revisit its Query key.

Query cache entries are shared within a `QueryClient`. Explicit cleanup can
affect other consumers using the same exact Query keys.

On-demand subset unloading does not explicitly call
`queryClient.cancelQueries()`. It removes the subset's Query observer. If this
was the final observer and the query function consumed `ctx.signal`, TanStack
Query aborts the request. If the signal was ignored, or another observer still
uses the same exact Query key, the request may finish and remain cached until
`gcTime`.

### Using with `queryOptions(...)`

If your app already uses TanStack Query's `queryOptions` helper (e.g. from `@tanstack/react-query`), you can spread compatible top-level options into `queryCollectionOptions`. Note that `queryFn` must be explicitly provided since query collections require it both in types and at runtime, and Query Collection's `select` option is for row extraction rather than TanStack Query observer-level selection:

```typescript
import { QueryClient } from "@tanstack/query-core"
import { DbClient, collectionOptions } from "@tanstack/db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { queryOptions } from "@tanstack/react-query"

const queryClient = new QueryClient()
const db = new DbClient({ queryClient })

const listOptions = queryOptions({
  queryKey: ["todos"],
  queryFn: async () => {
    const response = await fetch("/api/todos")
    return response.json() as Promise<Array<{ id: string; title: string }>>
  },
})

const todosCollection = collectionOptions("todos", (client) =>
  queryCollectionOptions({
    id: "todos",
    ...listOptions,
    queryFn: (context) => listOptions.queryFn!(context),
    queryClient: client.requireDependency<QueryClient>("queryClient"),
    getKey: (item) => item.id,
  }),
)

const todos = db.collection(todosCollection)
```

If `queryFn` is missing at runtime, `queryCollectionOptions` throws `QueryFnRequiredError`.

### Initial Data

Eager Query Collections support TanStack Query's `initialData` and
`initialDataUpdatedAt` options. Initial data has the original Query response
shape, is stored in the Query cache, and is immediately materialized as
normalized collection rows. TanStack Query uses `initialDataUpdatedAt` together
with `staleTime` to decide whether to fetch.

```typescript
const serverRenderedAt = Date.now()
const initialTodos = [
  { id: "1", title: "Write documentation" },
  { id: "2", title: "Ship initial data support" },
]

const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: fetchTodos,
    queryClient,
    getKey: (todo) => todo.id,
    initialData: initialTodos,
    initialDataUpdatedAt: serverRenderedAt,
    staleTime: 60_000,
  }),
)
```

An existing cached or hydrated Query response takes precedence over
`initialData`. Query keys remain the cache identity: two collections using the
same QueryClient and exact Query key observe one shared Query document, and a
later collection's initializer does not replace it. Use distinct Query keys for
independent documents.

Initial data is supported only for eager collections. A collection-wide value
cannot establish row membership for arbitrary on-demand predicates, ordering,
limits, and offsets. For `syncMode: "on-demand"`, seed or hydrate the exact
derived Query cache entries instead.

If a stale initial response triggers a fetch, the initial rows remain available
while it is in flight. A successful response reconciles them through the normal
row ownership pipeline; an error retains the initial rows. Direct writes patch
the eager Query cache in place. On-demand direct writes revalidate scoped
entries as described below.

### Selecting Rows from Wrapped Responses

Many APIs return rows inside a response envelope that also contains metadata such as pagination cursors, totals, or request information. Use `select` to extract the row array that TanStack DB should materialize:

```typescript
interface TodosResponse {
  items: Array<{ id: string; title: string }>
  nextCursor?: string
  total: number
}

const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: async (): Promise<TodosResponse> => {
      const response = await fetch("/api/todos")
      return response.json()
    },
    initialData: {
      items: [{ id: "1", title: "Initial todo" }],
      nextCursor: undefined,
      total: 1,
    },
    select: (response) => response.items,
    queryClient,
    getKey: (item) => item.id,
  }),
)
```

`select` is a query-db-collection row extraction hook. It tells TanStack DB which rows to materialize while the TanStack Query cache keeps the original query response shape. In the example above, `queryClient.getQueryData(["todos"])` still returns the full `TodosResponse`, including `nextCursor` and `total`.

The same projection applies to `initialData`: provide the complete response
envelope, and Query Collection materializes the rows returned by `select` while
preserving the envelope in the Query cache.

This differs from TanStack Query's observer-level `select`: query-db-collection uses this option to bridge Query's response object into DB's normalized row store.

In eager mode, direct write utilities such as `writeInsert`, `writeUpdate`, and `writeDelete` make a best-effort attempt to update the matching row array inside wrapped Query cache entries while preserving wrapper metadata. In on-demand mode, they revalidate active scoped queries and remove inactive or disabled cache entries instead of patching them with the full collection snapshot.

This works automatically for simple wrappers such as:

- `{ data: [...] }`
- `{ items: [...] }`
- `{ results: [...] }`

Derived projections, such as `select: (response) => response.edges.map((edge) => edge.node)`, are read-side row extraction only. query-db-collection cannot generally reconstruct the original response envelope from updated rows. Refetch or invalidate the query if the wrapped cache must exactly reflect direct writes for a derived projection.

### Collection Options

- `id`: Unique identifier for the collection
- `schema`: Schema for validating items
- `sync`: Custom sync configuration
- `startSync`: Whether to start syncing immediately (default: `true`)

### Persistence Handlers

- `onInsert`: Handler called before insert operations
- `onUpdate`: Handler called before update operations
- `onDelete`: Handler called before delete operations

## Extending Meta with Custom Properties

The `meta` option allows you to pass additional metadata to your query function. By default, Query Collections automatically include `loadSubsetOptions` in the meta object, which contains filtering, sorting, and pagination options for on-demand queries.

Treat `ctx.meta.loadSubsetOptions` and its nested request data as read-only.
Do not edit expression nodes, ordering options, Dates, byte arrays, or membership
arrays. Build separate API parameters instead. Core retains request data without
cloning it; changing submitted data can make the request disagree with its cache
key. To change a query constant, supply a new value rather than mutating the old
one. Cancellation through the request's `AbortSignal` remains supported.

### Type-Safe Meta Access

The `ctx.meta.loadSubsetOptions` property is automatically typed as `LoadSubsetOptions` without requiring any additional imports or type assertions:

```typescript
import { parseLoadSubsetOptions } from "@tanstack/query-db-collection"

const collection = createCollection(
  queryCollectionOptions({
    queryKey: ["products"],
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      // ✅ Type-safe access - no @ts-ignore needed!
      const options = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions)

      // Use the parsed options to fetch only what you need
      return api.getProducts(options)
    },
    queryClient,
    getKey: (item) => item.id,
  })
)
```

### Adding Custom Meta Properties

You can extend the meta type to include your own custom properties using TypeScript's module augmentation:

```typescript
// In a global type definition file (e.g., types.d.ts or global.d.ts)
declare module "@tanstack/query-db-collection" {
  interface QueryCollectionMeta {
    // Add your custom properties here
    userId?: string
    includeDeleted?: boolean
    cacheTTL?: number
  }
}
```

Once you've extended the interface, your custom properties are fully typed throughout your application:

```typescript
const collection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: async (ctx) => {
      // ✅ Both loadSubsetOptions and custom properties are typed
      const { loadSubsetOptions, userId, includeDeleted } = ctx.meta

      return api.getTodos({
        ...parseLoadSubsetOptions(loadSubsetOptions),
        userId,
        includeDeleted,
      })
    },
    queryClient,
    getKey: (item) => item.id,
    // Pass custom meta alongside Query Collection defaults
    meta: {
      userId: "user-123",
      includeDeleted: false,
    },
  })
)
```

### Important Notes

- The module augmentation pattern follows TanStack Query's official approach for typing meta
- `QueryCollectionMeta` is an interface (not a type alias), enabling proper TypeScript declaration merging
- Your custom properties are merged with the base `loadSubsetOptions` property
- All meta properties must be compatible with `Record<string, unknown>`
- The augmentation should be done in a file that's included in your TypeScript compilation

### Example: API Request Context

A common use case is passing request context to your query function:

```typescript
// types.d.ts
declare module "@tanstack/query-db-collection" {
  interface QueryCollectionMeta {
    authToken?: string
    locale?: string
    version?: string
  }
}

// collections.ts
const productsCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["products"],
    queryFn: async (ctx) => {
      const { loadSubsetOptions, authToken, locale, version } = ctx.meta

      return api.getProducts({
        ...parseLoadSubsetOptions(loadSubsetOptions),
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Accept-Language": locale,
          "API-Version": version,
        },
      })
    },
    queryClient,
    getKey: (item) => item.id,
    meta: {
      authToken: session.token,
      locale: "en-US",
      version: "v1",
    },
  })
)
```

## Persistence Handlers

You can define handlers that are called when mutations occur. These handlers persist changes to your backend:

```typescript
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: fetchTodos,
    queryClient,
    getKey: (item) => item.id,

    onInsert: async ({ transaction }) => {
      const newItems = transaction.mutations.map((m) => m.modified)
      await api.createTodos(newItems)
      // Auto-refetch happens after handler completes (pre-1.0 behavior)
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
  })
)
```

> **Note**: QueryCollection currently auto-refetches after handlers complete. See [Controlling Refetch Behavior](#controlling-refetch-behavior) for details on this transitional behavior.

### Controlling Refetch Behavior

> **⚠️ Transitional API**: QueryCollection currently auto-refetches after handlers complete. This behavior is deprecated and will be removed in v1.0. See the migration notes below.

#### Current Behavior (Pre-1.0)

By default, QueryCollection automatically refetches after each handler completes. To **skip** auto-refetch, return `{ refetch: false }`:

```typescript
onInsert: async ({ transaction }) => {
  await api.createTodos(transaction.mutations.map((m) => m.modified))

  // Skip auto-refetch - use this when server doesn't modify the data
  return { refetch: false }
}
```

If you don't return `{ refetch: false }`, auto-refetch happens automatically.

#### v1.0 Behavior (Future)

In v1.0, auto-refetch will be **removed**. Handlers will need to explicitly call `collection.utils.refetch()` when refetching is needed:

```typescript
onInsert: async ({ transaction, collection }) => {
  await api.createTodos(transaction.mutations.map((m) => m.modified))

  // Explicitly trigger refetch when you need server state
  await collection.utils.refetch()
}
```

Outside a mutation handler, the `refetch()` promise resolves after every
accepted result from that call has been applied to Collection rows. This is also
the application barrier when the result has no row diff and therefore emits no
change event. Rejection is fail-fast: with several tracked Queries, one failure
may reject the call while independent work remains pending.

Inside the Collection's own mutation handler, application is queued behind that
same transaction. To avoid a circular wait, `refetch()` on the `collection`
parameter passed to the handler resolves at the Query fetch boundary. This is a
scoped Collection view: an external `refetch()` still waits for application,
even when it overlaps the handler. Code that starts the mutation can await the
mutation's `isPersisted.promise` when it needs the complete transaction and its
queued Collection application. Utilities that refetch through the scoped view,
including `clearError()`, inherit the same fetch boundary.

Outside a mutation handler, `throwOnError` applies to both Query fetch errors and
errors applying an accepted result to Collection rows. With `throwOnError: true`,
application failure or cancellation rejects the call; cancellation uses an
`AbortError`. With `throwOnError: false` (the default), `refetch()` returns its
Query results instead. On the scoped Collection passed to a mutation handler,
`throwOnError` applies only to the Query fetch because application happens after
that call's fetch boundary. A later application failure is recorded by the
Collection's error utilities.

To skip refetch in v1.0, simply don't call `refetch()`:

```typescript
onInsert: async ({ transaction }) => {
  await api.createTodos(transaction.mutations.map((m) => m.modified))

  // No refetch call = no refetch (v1.0 behavior)
}
```

#### When to Skip Refetch

Skip refetching when:

- You're confident the server state exactly matches what you sent (no server-side processing)
- You're handling state updates through other mechanisms (like WebSockets or direct writes)
- You want to optimize for fewer network requests

## Utility Methods

The collection provides these utility methods via `collection.utils`:

- `refetch(opts?)`: Refetch every tracked Query and await application of each accepted result
  - `opts.throwOnError`: Whether Query fetch or Collection application errors reject an external call (default: `false`); handler-scoped calls cover fetch errors only
  - Bypasses `enabled: false` to support imperative/manual refetching patterns (similar to hook `refetch()` behavior)
  - Returns the tracked Queries' `QueryObserverResult` values in tracked-key order
  - Preserves an `undefined` slot if a tracked Query is removed while the refetch starts
- `clearError()`: Clear recorded Query error state and refetch with errors enabled
  - Uses the same application boundary as `refetch()` outside handlers and the same fetch boundary on a handler-scoped Collection

## Direct Writes

Direct writes are intended for scenarios where the normal query/mutation flow doesn't fit your needs. They write directly to the synced data store and bypass the optimistic update system. Their Query cache behavior depends on the collection's sync mode.

### Understanding the Data Stores

Query Collections maintain two data stores:

1. **Synced Data Store** - The authoritative state synchronized with the server via `queryFn`
2. **Optimistic Mutations Store** - Temporary changes that are applied optimistically before server confirmation

Normal collection operations (insert, update, delete) create optimistic mutations that are:

- Applied immediately to the UI
- Sent to the server via persistence handlers
- Rolled back automatically if the server request fails
- Replaced with server data when the query refetches

Direct writes bypass this system entirely and write directly to the synced data store, making them useful for handling real-time updates from alternative sources. Active on-demand queries still refetch so each scoped cache remains authoritative for its own request.

### When to Use Direct Writes

Direct writes should be used when:

- You need to sync real-time updates from WebSockets or server-sent events
- You're dealing with large datasets where refetching everything is too expensive
- You receive incremental updates or server-computed field updates
- You need to implement complex pagination or partial data loading scenarios

### Individual Write Operations

```typescript
// Insert a new item directly to the synced data store
todosCollection.utils.writeInsert({
  id: "1",
  text: "Buy milk",
  completed: false,
})

// Update an existing item in the synced data store
todosCollection.utils.writeUpdate({ id: "1", completed: true })

// Delete an item from the synced data store
todosCollection.utils.writeDelete("1")

// Upsert (insert or update) in the synced data store
todosCollection.utils.writeUpsert({
  id: "1",
  text: "Buy milk",
  completed: false,
})
```

These operations:

- Write directly to the synced data store
- Do NOT create optimistic mutations
- Are immediately visible in the UI
- In eager mode, update the full-result TanStack Query cache in place without refetching
- In on-demand mode, refetch active enabled queries and remove inactive or disabled cache entries

### Batch Operations

The `writeBatch` method allows you to perform multiple operations atomically. Any write operations called within the callback will be collected and executed as a single transaction:

```typescript
todosCollection.utils.writeBatch(() => {
  todosCollection.utils.writeInsert({ id: "1", text: "Buy milk" })
  todosCollection.utils.writeInsert({ id: "2", text: "Walk dog" })
  todosCollection.utils.writeUpdate({ id: "3", completed: true })
  todosCollection.utils.writeDelete("4")
})
```

### Real-World Example: WebSocket Integration

```typescript
// Handle real-time updates from WebSocket without triggering full refetches
ws.on("todos:update", (changes) => {
  todosCollection.utils.writeBatch(() => {
    changes.forEach((change) => {
      switch (change.type) {
        case "insert":
          todosCollection.utils.writeInsert(change.data)
          break
        case "update":
          todosCollection.utils.writeUpdate(change.data)
          break
        case "delete":
          todosCollection.utils.writeDelete(change.id)
          break
      }
    })
  })
})
```

### Example: Incremental Updates

When the server returns computed fields (like server-generated IDs or timestamps), you can use direct writes to sync the server response without triggering a full refetch:

```typescript
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: fetchTodos,
    queryClient,
    getKey: (item) => item.id,

    onInsert: async ({ transaction, collection }) => {
      const newItems = transaction.mutations.map((m) => m.modified)

      // Send to server and get back items with server-computed fields
      const serverItems = await api.createTodos(newItems)

      // Sync server-computed fields (like server-generated IDs, timestamps, etc.)
      // to the collection's synced data store using direct writes
      collection.utils.writeBatch(() => {
        serverItems.forEach((serverItem) => {
          collection.utils.writeInsert(serverItem)
        })
      })

      // No need to refetch - we've already synced the server response via direct writes
      // (optimistic state is automatically replaced when handler completes)
      return { refetch: false } // Transitional pre-1.0 opt-out
    },

    onUpdate: async ({ transaction, collection }) => {
      const updates = transaction.mutations.map((m) => ({
        id: m.key,
        changes: m.changes,
      }))
      const serverItems = await api.updateTodos(updates)

      // Sync server-computed fields from the update response
      collection.utils.writeBatch(() => {
        serverItems.forEach((serverItem) => {
          collection.utils.writeUpdate(serverItem)
        })
      })

      // No refetch needed since we used direct writes
      return { refetch: false } // Transitional pre-1.0 opt-out
    },
  })
)

// Usage is just like a regular collection
todosCollection.insert({ text: "Buy milk", completed: false })
```

### Server pagination with live queries

`useLiveInfiniteQuery` in React, Vue, and Svelte grows a local ordered query
window. It does not run TanStack Query's `InfiniteQueryObserver`. Query
Collections use `QueryObserver`, so `queryFn` receives
`meta.loadSubsetOptions`, not `pageParam`.

The previously ignored `getNextPageParam` option has been removed. Delete it
from your hook config; passing it at runtime now throws a clear error.
`initialPageParam` labels result pages only. It does not set a remote offset
or server cursor.

For server loading, use `syncMode: 'on-demand'` and make `queryFn` fulfill the
requested filter, order, offset, and limit. Use a deterministic total order
(for example, a timestamp followed by a unique ID). The loader may request a
prefix, a suffix, a tie group, or the full filtered source. A request is not
necessarily one UI page: the hook fetches an extra row to determine
`hasNextPage`. Returning one capped endpoint page can incorrectly make the
query appear exhausted even when the server has more rows.

#### Endpoints with fixed-size pages

If your endpoint uses page numbers, drain enough server pages to fulfill each
request. This example assumes a zero-based page API with a fixed size of 50.
The endpoint must apply the supplied filters and sorts **before** pagination,
keep a consistent ordered result while its pages are read, and return
`nextPage: null` only when it has authoritatively exhausted that result.
This example uses offset-based pagination. `api.listPosts` translates the full
`where` expression and `orderBy` options into the endpoint's syntax, and rejects
unsupported expressions. The separate `cursor` hints are deliberately unused;
cursor-based adapters must handle those hints alongside `where`, not treat them
as already included in it. See [QueryFn and Predicate Push-Down](#queryfn-and-predicate-push-down)
for translation helpers. Do not drop predicates or filter after paginating:
either changes the requested window.

```typescript
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

type Post = { id: number; createdAt: number; title: string }
const serverPageSize = 50

const postsCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['posts'],
    queryClient,
    syncMode: 'on-demand',
    getKey: (post: Post) => post.id,
    queryFn: async (ctx): Promise<Array<Post>> => {
      const { where, orderBy, offset = 0, limit } = ctx.meta?.loadSubsetOptions ?? {}
      const skip = offset % serverPageSize
      let page: number | null = Math.floor(offset / serverPageSize)
      const gathered: Array<Post> = []

      while (page !== null && (limit === undefined || gathered.length < skip + limit)) {
        ctx.signal.throwIfAborted()
        const response: { rows: Array<Post>; nextPage: number | null } =
          await api.listPosts({
            page,
            pageSize: serverPageSize,
            where,
            orderBy,
            signal: ctx.signal,
          })
        gathered.push(...response.rows)
        page = response.nextPage
      }

      return gathered.slice(skip, limit === undefined ? undefined : skip + limit)
    },
  }),
)

// React example; the collection protocol is the same for Vue and Svelte.
const { data, fetchNextPage, hasNextPage } = useLiveInfiniteQuery(
  (q) => q.from({ post: postsCollection })
    .orderBy(({ post }) => post.createdAt)
    .orderBy(({ post }) => post.id),
  { pageSize: 20 },
)
```

Reject failed requests instead of returning partial rows as success. An
unlimited request must drain until the endpoint reports exhaustion. For an
endpoint with opaque cursors, use `createCursorPager` as shown below. The hook
does not maintain remote cursor history on its own.

Manually appending rows with `writeUpsert` is a separate, lower-level loading
strategy. It does not make an eager `queryFn` incremental: a later successful
refetch still replaces its complete state and can remove appended rows.
`staleTime: Infinity` does not prevent explicit refetch or invalidation.

#### Endpoints with opaque cursors

Query Collections ask for arbitrary windows, such as rows 40–59. An
opaque-cursor API cannot jump to row 40. It can only fetch the first page, then
follow the continuation token returned with each page.

`createCursorPager` bridges those two protocols. It stores complete backend
pages in your existing QueryClient and follows their cursors until it has enough
rows for the requested `offset` and `limit`. A later request can reuse that
fresh run of pages and fetch only the missing suffix. The hook still requests
an extra row to decide `hasNextPage`; the pager just fulfills the resulting
window.

```typescript
import { createCollection } from '@tanstack/db'
import { createCursorPager, queryCollectionOptions } from '@tanstack/query-db-collection'

type Post = { id: number; createdAt: number; title: string }

const postsCollection = createCollection(
  queryCollectionOptions({
    queryClient,
    queryKey: ['posts', 'rows'],
    syncMode: 'on-demand',
    getKey: (post: Post) => post.id,
    queryFn: async (ctx) => {
      const { where, orderBy, offset = 0, limit } = ctx.meta?.loadSubsetOptions ?? {}

      // Translate every filter and sort, or reject unsupported expressions.
      // This stable, serializable value identifies one ordered result sequence.
      const request = api.translatePostQuery({ where, orderBy })

      const pager = createCursorPager<Post>({
        queryClient,
        queryKey: ['posts', 'cursor-pages', request],
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        fetchPage: async (cursor, signal) => {
          const response = await api.listPosts({ ...request, cursor, signal })

          // Only null means that the source is exhausted.
          return { rows: response.items, nextCursor: response.nextCursor ?? null }
        },
      })

      return pager.read({ offset, limit }, ctx.signal)
    },
  }),
)
```

##### Give each result sequence its own key

The pager's query key identifies one ordered backend result, not one requested
window. Leave `offset` and `limit` out of the key so wider reads can extend the
same cached prefix. Include everything that changes the result—such as the
tenant, source, filters, and order.

Keep row data and cursor pages under sibling keys:

```text
['posts', 'rows']                         QueryCollection row array
['posts', 'cursor-pages', request]        backend pages and cursors
```

They cannot share a key because the two cache entries have different shapes.
Do not put cursor pages beneath the row key either: manual collection writes
target entries under the row prefix. A shared resource prefix such as
`['posts']` still lets you cancel or invalidate both kinds of data together.

The example creates a small pager object for each `queryFn` call. Those objects
still share cached pages and in-flight fetches through QueryClient. Each pager
serializes its own reads. Retain one pager per result sequence only if calls
must also share that queue or you need to call `pager.reset()` later.

##### What happens when the collection asks for rows

For fresh data, the pager uses every cached page it can and fetches only the
missing suffix. `nextCursor: null` is the sole exhaustion signal: a short or
empty page with another cursor does not end the sequence. An omitted `limit`
drains the source; a zero limit performs no fetch. Repeated continuation tokens
throw instead of looping forever.

Query owns freshness, garbage collection, retries, and invalidation. Pass
`staleTime` and `gcTime` to the pager or let it inherit QueryClient defaults.
Configure retries through QueryClient defaults for the page-key prefix;
imperative Query fetches do not retry by default. The pager keeps every page in
its original form, so Query defaults for `maxPages` and `select` do not apply.

When cached pages are stale, the next read refetches every page loaded so far,
starting with the first. It does this even for a shallow window because old
continuation tokens belong to the old sequence. Staleness does not start a
background timer. The page query has no lasting observer, so its `gcTime` may
expire while the collection's published rows remain visible.

A failed read rejects rather than returning a partial window. Query keeps the
last successful pages, so a later read can retry. Treat their rows as immutable,
just like other Query data. `read()` returns references from the cached pages,
not detached copies, and does not promise the same array or object identity
across calls.

##### Refresh or cancel the sequence

After a mutation—or whenever you need a forced refresh—cancel the shared
resource prefix before invalidating it:

```typescript
await queryClient.cancelQueries({ queryKey: ['posts'] })
await queryClient.invalidateQueries({ queryKey: ['posts'] })
```

Cancelling first stops an old page append from completing after invalidation and
marking the old sequence fresh again. It rejects readers waiting on that fetch
with an `AbortError` and prevents a late result from entering the cache. The
backend must honor the signal if you also want to stop its network work.

Aborting the signal passed to `read()` rejects only that reader; it does not
cancel a page fetch shared with another reader. A cancelling Query refetch moves
waiting readers to the replacement fetch. `collection.utils.refetch()` refreshes
the row queries but may reuse fresh cursor pages. `pager.reset()` removes one
pager's exact page key and cancels its queued reads, but does not refresh the
collection's row query.

##### Backend contract

The helper handles cursor traversal only. Your adapter must:

- translate every requested `where` and `orderBy`, or reject unsupported
  expressions;
- apply filters and ordering before pagination;
- use a deterministic total order, including a unique tie-breaker;
- keep that ordered result consistent while its cursor sequence is read; and
- return `nextCursor: null` only when the result is authoritatively exhausted.

`LoadSubsetOptions.cursor` contains query-expression hints, not the backend's
opaque token. `createCursorPager` therefore addresses the cursor sequence by
offset and deliberately does not consume those hints. No client-side pager can
make a stable snapshot from an endpoint whose ordering changes between pages;
the endpoint must define its own consistency and cursor-expiry rules.

## Important Behaviors

### Full State Sync

The query collection treats the `queryFn` result as the **complete state** of the collection. This means:

- Items present in the collection but not in the query result will be deleted
- Items in the query result but not in the collection will be inserted
- Items present in both will be updated if they differ

This is important when the same entity type can be loaded from multiple REST
endpoints. For example, do not point the same Query Collection at
`/api/documents/preview` for one load and `/api/documents/deleted` for another
unless each result represents the complete state for that collection
scope. A narrower endpoint can otherwise remove rows that were loaded from a
different endpoint.

For multiple endpoint or subset-loading use cases, choose the pattern that
matches your API semantics:

- Use `syncMode: 'on-demand'` when one logical collection can serve different
  subsets of data. In this mode, query predicates (`where`, `orderBy`, `limit`,
  and `offset`) are passed to your `queryFn` via `ctx.meta.loadSubsetOptions`,
  letting you translate them into API parameters.
- Use separate Query Collections when endpoints represent distinct server scopes
  whose results should not replace each other. Use `unionAll` to combine them
  into a single query when you need a unified view across endpoints.
- Use direct writes such as `writeUpsert`/`writeBatch` for lower-level
  incremental loading when you intentionally want to merge server responses into
  the synced store yourself.

### Empty Array Behavior

When `queryFn` returns an empty array, **all items in the collection will be deleted**. This is because the collection interprets an empty array as "the server has no items".

```typescript
// This will delete all items in the collection
queryFn: async () => []
```

### Handling Partial/Incremental Fetches

Since the query collection expects `queryFn` to return the complete state, you can handle partial fetches by merging new data with existing data:

```typescript
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: async ({ queryKey }) => {
      // Get existing data from cache
      const existingData = queryClient.getQueryData(queryKey) || []

      // Fetch only new/updated items (e.g., changes since last sync)
      const lastSyncTime = localStorage.getItem("todos-last-sync")
      const newData = await fetch(`/api/todos?since=${lastSyncTime}`).then(
        (r) => r.json()
      )

      // Merge new data with existing data
      const existingMap = new Map(existingData.map((item) => [item.id, item]))

      // Apply updates and additions
      newData.forEach((item) => {
        existingMap.set(item.id, item)
      })

      // Handle deletions if your API provides them
      if (newData.deletions) {
        newData.deletions.forEach((id) => existingMap.delete(id))
      }

      // Update sync time
      localStorage.setItem("todos-last-sync", new Date().toISOString())

      // Return the complete merged state
      return Array.from(existingMap.values())
    },
    queryClient,
    getKey: (item) => item.id,
  })
)
```

This pattern allows you to:

- Fetch only incremental changes from your API
- Merge those changes with existing data
- Return the complete state that the collection expects
- Avoid the performance overhead of fetching all data every time

### Direct Writes and Query Sync

Direct writes update the collection immediately. In eager mode, they also patch the full-result TanStack Query cache in place.

In on-demand mode, each Query cache entry may represent a different predicate, order, limit, or offset. A full collection snapshot cannot safely replace those scoped results. Direct writes therefore refetch active enabled queries and remove inactive or disabled entries. A successful `queryFn` result remains authoritative and may reconcile or replace a direct write.

To handle this properly:

1. Use `{ refetch: false }` in persistence handlers to avoid the handler's additional refetch after a direct write. On-demand cache revalidation still runs.
2. Make sure an on-demand `queryFn` returns the current server result for its pushed-down predicate, order, limit, and offset.
3. Use eager mode when direct writes must update one complete cached result without a network request.

## Complete Direct Write API Reference

All direct write methods are available on `collection.utils`:

- `writeInsert(data)`: Insert one or more items directly
- `writeUpdate(data)`: Update one or more items directly
- `writeDelete(keys)`: Delete one or more items directly
- `writeUpsert(data)`: Insert or update one or more items directly
- `writeBatch(callback)`: Perform multiple operations atomically
- `refetch(opts?)`: Trigger a refetch of the query

## QueryFn and Predicate Push-Down

When using `syncMode: 'on-demand'`, the collection automatically pushes down query predicates (where clauses, orderBy, limit, and offset) to your `queryFn`. This allows you to fetch only the data needed for each specific query, rather than fetching the entire dataset.

### How LoadSubsetOptions Are Passed

LoadSubsetOptions are passed to your `queryFn` via the query context's `meta` property:

```typescript
queryFn: async (ctx) => {
  // Extract LoadSubsetOptions from the context
  const { limit, offset, where, orderBy } = ctx.meta.loadSubsetOptions

  // Use these to fetch only the data you need
  // - where: filter expression (AST)
  // - orderBy: sort expression (AST)
  // - limit: maximum number of rows
  // - offset: number of rows to skip (for pagination)
  // ...
}
```

The `where` and `orderBy` fields are expression trees (AST - Abstract Syntax Tree) that need to be parsed. TanStack DB provides helper functions to make this easy.

### Expression Helpers

```typescript
import {
  parseWhereExpression,
  parseOrderByExpression,
  extractSimpleComparisons,
  parseLoadSubsetOptions,
} from '@tanstack/db'
// Or from '@tanstack/query-db-collection' (re-exported for convenience)
```

These helpers allow you to parse expression trees without manually traversing complex AST structures.

### Quick Start: Simple REST API

```typescript
import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { parseLoadSubsetOptions } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'

const queryClient = new QueryClient()

const productsCollection = createCollection(
  queryCollectionOptions({
    id: 'products',
    queryKey: ['products'],
    queryClient,
    getKey: (item) => item.id,
    syncMode: 'on-demand', // Enable predicate push-down

    queryFn: async (ctx) => {
      const { limit, offset, where, orderBy } = ctx.meta.loadSubsetOptions

      // Parse the expressions into simple format
      const parsed = parseLoadSubsetOptions({ where, orderBy, limit })

      // Build query parameters from parsed filters
      const params = new URLSearchParams()

      // Add filters
      parsed.filters.forEach(({ field, operator, value }) => {
        const fieldName = field.join('.')
        if (operator === 'eq') {
          params.set(fieldName, String(value))
        } else if (operator === 'lt') {
          params.set(`${fieldName}_lt`, String(value))
        } else if (operator === 'gt') {
          params.set(`${fieldName}_gt`, String(value))
        }
      })

      // Add sorting
      if (parsed.sorts.length > 0) {
        const sortParam = parsed.sorts
          .map(s => `${s.field.join('.')}:${s.direction}`)
          .join(',')
        params.set('sort', sortParam)
      }

      // Add limit
      if (parsed.limit) {
        params.set('limit', String(parsed.limit))
      }

      // Add offset for pagination
      if (offset) {
        params.set('offset', String(offset))
      }

      const response = await fetch(`/api/products?${params}`)
      return response.json()
    },
  })
)

// Usage with live queries
import { createLiveQueryCollection } from '@tanstack/react-db'
import { eq, lt, and } from '@tanstack/db'

const affordableElectronics = createLiveQueryCollection({
  query: (q) =>
    q.from({ product: productsCollection })
     .where(({ product }) => and(
       eq(product.category, 'electronics'),
       lt(product.price, 100)
     ))
     .orderBy(({ product }) => product.price, 'asc')
     .limit(10)
     .select(({ product }) => product)
})

// This triggers a queryFn call with:
// GET /api/products?category=electronics&price_lt=100&sort=price:asc&limit=10
// When paginating, offset is included: &offset=20
```

### Custom Handlers for Complex APIs

For APIs with specific formats, use custom handlers:

```typescript
queryFn: async (ctx) => {
  const { where, orderBy, limit } = ctx.meta.loadSubsetOptions

  // Use custom handlers to match your API's format
  const filters = parseWhereExpression(where, {
    handlers: {
      eq: (field, value) => ({
        field: field.join('.'),
        op: 'equals',
        value
      }),
      lt: (field, value) => ({
        field: field.join('.'),
        op: 'lessThan',
        value
      }),
      and: (...conditions) => ({
        operator: 'AND',
        conditions
      }),
      or: (...conditions) => ({
        operator: 'OR',
        conditions
      }),
    }
  })

  const sorts = parseOrderByExpression(orderBy)

  return api.query({
    filters,
    sort: sorts.map(s => ({
      field: s.field.join('.'),
      order: s.direction.toUpperCase()
    })),
    limit
  })
}
```

### GraphQL Example

```typescript
queryFn: async (ctx) => {
  const { where, orderBy, limit } = ctx.meta.loadSubsetOptions

  // Convert to a GraphQL where clause format
  const whereClause = parseWhereExpression(where, {
    handlers: {
      eq: (field, value) => ({
        [field.join('_')]: { _eq: value }
      }),
      lt: (field, value) => ({
        [field.join('_')]: { _lt: value }
      }),
      and: (...conditions) => ({ _and: conditions }),
      or: (...conditions) => ({ _or: conditions }),
    }
  })

  // Convert to a GraphQL order_by format
  const sorts = parseOrderByExpression(orderBy)
  const orderByClause = sorts.map(s => ({
    [s.field.join('_')]: s.direction
  }))

  const { data } = await graphqlClient.query({
    query: gql`
      query GetProducts($where: product_bool_exp, $orderBy: [product_order_by!], $limit: Int) {
        product(where: $where, order_by: $orderBy, limit: $limit) {
          id
          name
          category
          price
        }
      }
    `,
    variables: {
      where: whereClause,
      orderBy: orderByClause,
      limit
    }
  })

  return data.product
}
```

### Expression Helper API Reference

#### `parseLoadSubsetOptions(options)`

Convenience function that parses all LoadSubsetOptions at once. Good for simple use cases.

```typescript
const { filters, sorts, limit, offset } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions)
// filters: [{ field: ['category'], operator: 'eq', value: 'electronics' }]
// sorts: [{ field: ['price'], direction: 'asc', nulls: 'last' }]
// limit: 10
// offset: 20 (for pagination)
```

#### `parseWhereExpression(expr, options)`

Parses a WHERE expression using custom handlers for each operator. Use this for complete control over the output format.

```typescript
const filters = parseWhereExpression(where, {
  handlers: {
    eq: (field, value) => ({ [field.join('.')]: value }),
    lt: (field, value) => ({ [`${field.join('.')}_lt`]: value }),
    and: (...filters) => Object.assign({}, ...filters)
  },
  onUnknownOperator: (operator, args) => {
    console.warn(`Unsupported operator: ${operator}`)
    return null
  }
})
```

#### `parseOrderByExpression(orderBy)`

Parses an ORDER BY expression into a simple array.

```typescript
const sorts = parseOrderByExpression(orderBy)
// Returns: [{ field: ['price'], direction: 'asc', nulls: 'last' }]
```

#### `extractSimpleComparisons(expr)`

Extracts simple AND-ed comparisons from a WHERE expression. Note: Only works for simple AND conditions.

```typescript
const comparisons = extractSimpleComparisons(where)
// Returns: [
//   { field: ['category'], operator: 'eq', value: 'electronics' },
//   { field: ['price'], operator: 'lt', value: 100 }
// ]
```

### Supported Operators

- `eq` - Equality (=)
- `gt` - Greater than (>)
- `gte` - Greater than or equal (>=)
- `lt` - Less than (<)
- `lte` - Less than or equal (<=)
- `and` - Logical AND
- `or` - Logical OR
- `in` - IN clause

### Using Query Key Builders

Create different cache entries for different filter combinations:

```typescript
const productsCollection = createCollection(
  queryCollectionOptions({
    id: 'products',
    // Dynamic query key based on filters
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts)
      const cacheKey = ['products']

      parsed.filters.forEach(f => {
        cacheKey.push(`${f.field.join('.')}-${f.operator}-${f.value}`)
      })

      if (parsed.limit) {
        cacheKey.push(`limit-${parsed.limit}`)
      }

      return cacheKey
    },
    queryClient,
    getKey: (item) => item.id,
    syncMode: 'on-demand',
    queryFn: async (ctx) => { /* ... */ },
  })
)
```

#### Query Key Prefix Convention

When using a function-based `queryKey`, all derived keys **must extend the base key as a prefix**. The base key is what your function returns when called with no options (`queryKey({})`).

TanStack Query uses prefix matching for cache operations internally. The query collection relies on this to find all cache entries belonging to a collection — including stale entries from destroyed query observers that are still held in cache due to `gcTime`. If derived keys don't share the base prefix, cache updates may silently miss entries, leading to stale data.

```typescript
// ✅ Correct: base key ['products'] is a prefix of all derived keys
queryKey: (opts) => {
  if (opts.where) {
    return ['products', JSON.stringify(opts.where)]
  }
  return ['products']
}

// ❌ Wrong: base key ['products-all'] is NOT a prefix of ['products-filtered', ...]
queryKey: (opts) => {
  if (opts.where) {
    return ['products-filtered', JSON.stringify(opts.where)]
  }
  return ['products-all']
}
```

### Tips

1. **Start with `parseLoadSubsetOptions`** for simple use cases
2. **Use custom handlers** via `parseWhereExpression` for APIs with specific formats
3. **Handle unsupported operators** with the `onUnknownOperator` callback
4. **Log parsed results** during development to verify correctness
