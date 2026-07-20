---
title: Query Collection
---

# Query Collection

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
import { createCollection } from "@tanstack/db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"

const queryClient = new QueryClient()

const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: async () => {
      const response = await fetch("/api/todos")
      return response.json()
    },
    queryClient,
    getKey: (item) => item.id,
  })
)
```

## Configuration Options

The `queryCollectionOptions` function accepts the following options:

### Required Options

- `queryKey`: The query key for TanStack Query. Can be a static array or a function that receives `LoadSubsetOptions` and returns a key. When using a function, all returned keys must share the base key (`queryKey({})`) as a prefix — see [Query Key Prefix Convention](#query-key-prefix-convention).
- `queryFn`: Function that fetches data from the server
- `queryClient`: TanStack Query client instance
- `getKey`: Function to extract the unique key from an item

### Creating Collection Options from a Runtime QueryClient

`queryCollectionOptions` needs a `queryClient` when the collection options are created. In SSR, TanStack Start, tests, or multi-tenant apps, that `QueryClient` is often request-local or route-local rather than module-global.

Keep shared collection configuration in a factory function that accepts the runtime `QueryClient`:

```typescript
import { QueryClient } from "@tanstack/query-core"
import { createCollection } from "@tanstack/db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"

interface Todo {
  id: string
  title: string
}

export function todoCollectionOptions(queryClient: QueryClient) {
  return queryCollectionOptions<Todo>({
    queryKey: ["todos"],
    queryFn: async () => {
      const response = await fetch("/api/todos")
      return response.json() as Promise<Array<Todo>>
    },
    queryClient,
    getKey: (todo) => todo.id,
  })
}

function createTodosCollection(queryClient: QueryClient) {
  return createCollection(todoCollectionOptions(queryClient))
}
```

Create the collection once for each scoped `QueryClient` and parameter set, then reuse that `Collection` instance. Creating multiple collections with the same `QueryClient` and `queryKey` gives each collection its own materialized state, lifecycle, subscriptions, and optimistic mutations.

In request-scoped environments, store the collection in request or router context. For client-side scopes, memoize by `QueryClient`:

```typescript
type TodosCollection = ReturnType<typeof createTodosCollection>

const collectionsByClient = new WeakMap<QueryClient, TodosCollection>()

export function getTodosCollection(
  queryClient: QueryClient,
): TodosCollection {
  let collection = collectionsByClient.get(queryClient)

  if (!collection) {
    collection = createTodosCollection(queryClient)
    collectionsByClient.set(queryClient, collection)
  }

  return collection
}
```

Avoid calling `createCollection(todoCollectionOptions(queryClient))` independently during render or in each consumer. Share the stable collection instance for the lifetime of that `QueryClient` scope.

This keeps SSR and request-scoped code from sharing a global `QueryClient` while keeping each collection instance stable within its scope.

### Business-Scoped Collection Factories

A tenant, project, account, or route parameter can define a **business scope**: the server resource that a collection represents. Include the scope in both the Query key and `queryFn`. This extends the [runtime `QueryClient` factory pattern](#creating-collection-options-from-a-runtime-queryclient) with an explicit scope parameter:

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

export function createProjectTodosCollection(
  queryClient: QueryClient,
  projectId: string,
) {
  return createCollection(
    queryCollectionOptions<Todo>({
      queryKey: ["projects", projectId, "todos"],
      queryFn: () => fetchProjectTodos(projectId),
      queryClient,
      getKey: (todo) => todo.id,
    })
  )
}
```

The scope is part of the collection's identity. Memoize by both the `QueryClient` and a stable scope key so consumers of the same project share one collection:

```typescript
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
```

For multiple scope values, use nested maps or a collision-safe stable key that includes every value. Do not call the factory on each render. In a long-lived client, user-selected scopes can make the map grow without bound. Remove unused entries and call `await collection.cleanup()` when your application owns their lifecycle. Request-local maps can be discarded with the request.

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

Other semantic options, such as `initialData`, `placeholderData`, and TanStack Query observer-level `select`, are intentionally deferred until their Query Collection behavior is explicitly designed.

### Using with `queryOptions(...)`

If your app already uses TanStack Query's `queryOptions` helper (e.g. from `@tanstack/react-query`), you can spread compatible top-level options into `queryCollectionOptions`. Note that `queryFn` must be explicitly provided since query collections require it both in types and at runtime, and Query Collection's `select` option is for row extraction rather than TanStack Query observer-level selection:

```typescript
import { QueryClient } from "@tanstack/query-core"
import { createCollection } from "@tanstack/db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { queryOptions } from "@tanstack/react-query"

const queryClient = new QueryClient()

const listOptions = queryOptions({
  queryKey: ["todos"],
  queryFn: async () => {
    const response = await fetch("/api/todos")
    return response.json() as Promise<Array<{ id: string; title: string }>>
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

If `queryFn` is missing at runtime, `queryCollectionOptions` throws `QueryFnRequiredError`.

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
    select: (response) => response.items,
    queryClient,
    getKey: (item) => item.id,
  }),
)
```

`select` is a query-db-collection row extraction hook. It tells TanStack DB which rows to materialize while the TanStack Query cache keeps the original query response shape. In the example above, `queryClient.getQueryData(["todos"])` still returns the full `TodosResponse`, including `nextCursor` and `total`.

This differs from TanStack Query's observer-level `select`: query-db-collection uses this option to bridge Query's response object into DB's normalized row store.

Direct write utilities such as `writeInsert`, `writeUpdate`, and `writeDelete` make a best-effort attempt to update the matching row array inside wrapped Query cache entries while preserving wrapper metadata.

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

You can define handlers that are called when mutations occur. These handlers can persist changes to your backend and control whether the query should refetch after the operation:

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
      // Returning nothing or { refetch: true } will trigger a refetch
      // Return { refetch: false } to skip automatic refetch
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

### Controlling Refetch Behavior

By default, after any persistence handler (`onInsert`, `onUpdate`, or `onDelete`) completes successfully, the query will automatically refetch to ensure the local state matches the server state.

You can control this behavior by returning an object with a `refetch` property:

```typescript
onInsert: async ({ transaction }) => {
  await api.createTodos(transaction.mutations.map((m) => m.modified))

  // Skip the automatic refetch
  return { refetch: false }
}
```

This is useful when:

- You're confident the server state matches what you sent
- You want to avoid unnecessary network requests
- You're handling state updates through other mechanisms (like WebSockets)

## Utility Methods

The collection provides these utility methods via `collection.utils`:

- `refetch(opts?)`: Manually trigger a refetch of the query
  - `opts.throwOnError`: Whether to throw an error if the refetch fails (default: `false`)
  - Bypasses `enabled: false` to support imperative/manual refetching patterns (similar to hook `refetch()` behavior)
  - Returns `QueryObserverResult` for inspecting the result

## Direct Writes

Direct writes are intended for scenarios where the normal query/mutation flow doesn't fit your needs. They allow you to write directly to the synced data store, bypassing the optimistic update system and query refetch mechanism.

### Understanding the Data Stores

Query Collections maintain two data stores:

1. **Synced Data Store** - The authoritative state synchronized with the server via `queryFn`
2. **Optimistic Mutations Store** - Temporary changes that are applied optimistically before server confirmation

Normal collection operations (insert, update, delete) create optimistic mutations that are:

- Applied immediately to the UI
- Sent to the server via persistence handlers
- Rolled back automatically if the server request fails
- Replaced with server data when the query refetches

Direct writes bypass this system entirely and write directly to the synced data store, making them ideal for handling real-time updates from alternative sources.

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
- Do NOT trigger automatic query refetches
- Update the TanStack Query cache immediately
- Are immediately visible in the UI

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

When the server returns computed fields (like server-generated IDs or timestamps), you can use the `onInsert` handler with `{ refetch: false }` to avoid unnecessary refetches while still syncing the server response:

```typescript
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: fetchTodos,
    queryClient,
    getKey: (item) => item.id,

    onInsert: async ({ transaction }) => {
      const newItems = transaction.mutations.map((m) => m.modified)

      // Send to server and get back items with server-computed fields
      const serverItems = await api.createTodos(newItems)

      // Sync server-computed fields (like server-generated IDs, timestamps, etc.)
      // to the collection's synced data store
      todosCollection.utils.writeBatch(() => {
        serverItems.forEach((serverItem) => {
          todosCollection.utils.writeInsert(serverItem)
        })
      })

      // Skip automatic refetch since we've already synced the server response
      // (optimistic state is automatically replaced when handler completes)
      return { refetch: false }
    },

    onUpdate: async ({ transaction }) => {
      const updates = transaction.mutations.map((m) => ({
        id: m.key,
        changes: m.changes,
      }))
      const serverItems = await api.updateTodos(updates)

      // Sync server-computed fields from the update response
      todosCollection.utils.writeBatch(() => {
        serverItems.forEach((serverItem) => {
          todosCollection.utils.writeUpdate(serverItem)
        })
      })

      return { refetch: false }
    },
  })
)

// Usage is just like a regular collection
todosCollection.insert({ text: "Buy milk", completed: false })
```

### Example: Large Dataset Pagination

```typescript
// Load additional pages without refetching existing data
const loadMoreTodos = async (page) => {
  const newTodos = await api.getTodos({ page, limit: 50 })

  // Add new items without affecting existing ones
  todosCollection.utils.writeBatch(() => {
    newTodos.forEach((todo) => {
      todosCollection.utils.writeInsert(todo)
    })
  })
}
```

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

Direct writes update the collection immediately and also update the TanStack Query cache. However, they do not prevent the normal query sync behavior. If your `queryFn` returns data that conflicts with your direct writes, the query data will take precedence.

To handle this properly:

1. Use `{ refetch: false }` in your persistence handlers when using direct writes
2. Set appropriate `staleTime` to prevent unnecessary refetches
3. Design your `queryFn` to be aware of incremental updates (e.g., only fetch new data)

## Complete Direct Write API Reference

All direct write methods are available on `collection.utils`:

- `writeInsert(data)`: Insert one or more items directly
- `writeUpdate(data)`: Update one or more items directly
- `writeDelete(keys)`: Delete one or more items directly
- `writeUpsert(data)`: Insert or update one or more items directly
- `writeBatch(callback)`: Perform multiple operations atomically
- `refetch(opts?)`: Manually trigger a refetch of the query

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
