---
title: SSR and Hydration
id: ssr
---

# SSR and Hydration

TanStack DB SSR is based on collection-row hydration. The server loads rows into
request-scoped collections, serializes those collection rows, and the browser
hydrates them into a client-scoped `DbClient`. Live queries then read from the
hydrated collections exactly like they read from synced data.

This keeps the SSR model aligned with why you use DB in the first place:
normalized data lives in collections, and live queries are views over those
collections.

## High-level Summary

The SSR-friendly API adds four concepts:

- `DbClient` owns materialized collection instances for one request, browser app,
  test, or script.
- `collectionOptions(...)` creates a stable collection descriptor that can be
  materialized by any `DbClient`.
- `dbClient.dehydrate()`, `dbClient.hydrate(state)`, and
  `dbClient.applyCollectionChunk(chunk)` move collection rows across the
  server/client boundary.
- React apps use `<DbProvider client={dbClient}>` so hooks can resolve
  collection descriptors against the current client.

Existing apps continue to work. `createCollection(...)` and direct collection
instances still exist. The migration is required when you want SSR-safe request
isolation, hydration, streaming chunks, or the 1.0-ready React hook shape.

The one React API that now warns is the dependency-array form:

```tsx
useLiveQuery((q) => q.from({ todos }).where(...), [status])
```

It still works, but warns in development and will be removed in 1.0. Prefer:

```tsx
useLiveQuery({
  query: (q) => q.from({ todos: todoCollection }).where(...),
})
```

React derives live query identity from structured query IR by default. Add
`queryKey` only for opaque functional query logic or for a hot render path where
you want to skip derived identity work.

## Cheat Sheet

| Task | Before | SSR-friendly |
| --- | --- | --- |
| Define a collection | `createCollection(options)` | `collectionOptions(options)` |
| Materialize a collection | module-level singleton | `dbClient.collection(todoCollection)` |
| Scope collection state | module lifetime | `new DbClient()` per request/browser/test |
| Provide React context | none | `<DbProvider client={dbClient}>` |
| Query from React | direct collection instance | descriptor in `from`, resolved by `DbProvider` |
| Mutate from React | import singleton collection | `useDbClient().collection(todoCollection)` |
| Server preload | ad hoc collection preload | preload client-bound collection or live query |
| Serialize SSR state | none | `const state = dbClient.dehydrate()` |
| Hydrate in browser | none | `dbClient.hydrate(state)` before hooks read it |
| Stream rows later | custom app state | `dbClient.applyCollectionChunk(chunk)` |
| React query identity | dependency array | derived IR, or `queryKey` when needed |

### Minimal React Pattern

```tsx
import {
  DbClient,
  DbProvider,
  collectionOptions,
  eq,
  useDbClient,
  useLiveQuery,
} from '@tanstack/react-db'

const todoCollection = collectionOptions({
  id: 'todos',
  getKey: (todo: Todo) => todo.id,
  sync: {
    sync: ({ markReady }) => {
      markReady()
    },
  },
})

function useTodoCollection() {
  return useDbClient().collection(todoCollection)
}

function Todos({ status }: { status: string }) {
  const todos = useTodoCollection()

  const { data } = useLiveQuery({
    query: (q) =>
      q
        .from({ todo: todoCollection })
        .where(({ todo }) => eq(todo.status, status)),
  })

  return (
    <ul>
      {data.map((todo) => (
        <li
          key={todo.id}
          onClick={() => todos.update(todo.id, (draft) => {
            draft.done = true
          })}
        >
          {todo.title}
        </li>
      ))}
    </ul>
  )
}

const dbClient = new DbClient()

root.render(
  <DbProvider client={dbClient}>
    <Todos status="open" />
  </DbProvider>
)
```

## SSR Flow

The server and browser use the same descriptors, but different `DbClient`
instances.

```txt
server request
  -> new DbClient()
  -> dbClient.collection(todoCollection)
  -> preload collections or live queries
  -> dbClient.dehydrate()
  -> send state through framework loader

browser
  -> new DbClient()
  -> dbClient.hydrate(loaderState)
  -> <DbProvider client={dbClient}>
  -> useLiveQuery({ query })
```

### Server

Create a fresh `DbClient` for each request. Materialize descriptors through that
client, preload the data needed for the route, and dehydrate the client.

```tsx
import {
  DbClient,
  collectionOptions,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'

export const todoCollection = collectionOptions({
  id: 'todos',
  getKey: (todo: Todo) => todo.id,
  syncMode: 'on-demand',
  sync: {
    sync: ({ markReady, begin, write, commit }) => {
      markReady()

      return {
        loadSubset: async () => {
          const todos = await api.todos.list()
          begin({ immediate: true })
          for (const todo of todos) {
            write({ type: 'insert', value: todo })
          }
          commit()
          return true
        },
      }
    },
  },
})

export async function loadTodosForSsr() {
  const dbClient = new DbClient()
  const todos = dbClient.collection(todoCollection)

  const openTodos = createLiveQueryCollection({
    query: (q) =>
      q
        .from({ todo: todos })
        .where(({ todo }) => eq(todo.status, 'open')),
  })

  await openTodos.preload()

  return dbClient.dehydrate()
}
```

Preloading a live query loads the source collection rows required by that query.
The dehydrated payload contains collection rows, not a live-query result
snapshot.

### Browser

Hydrate the browser client before rendering components that read from DB.

```tsx
import { DbClient, DbProvider } from '@tanstack/react-db'

function App({ dehydratedDbState }: { dehydratedDbState: DehydratedDbState }) {
  const [dbClient] = React.useState(() => {
    const client = new DbClient()
    client.hydrate(dehydratedDbState)
    return client
  })

  return (
    <DbProvider client={dbClient}>
      <Routes />
    </DbProvider>
  )
}
```

Frameworks differ in how loader data reaches the client, but the DB handoff is
the same: `DbClient` on the server, `dehydrate()`, then `hydrate()` into the
browser client.

Live demo: https://tanstack-db-ssr-demo.netlify.app/ssr-db

## Streaming and Incremental Hydration

Streaming uses the same collection chunk shape as holistic dehydration:

```ts
dbClient.applyCollectionChunk({
  collectionId: 'todos',
  rows: [
    {
      key: 'todo-1',
      value: {
        id: 'todo-1',
        title: 'Streamed row',
        status: 'open',
      },
      metadata: { source: 'stream' },
    },
  ],
  syncMeta: { version: 1, cursor: 'abc' },
})
```

If the target collection is already materialized, the rows apply immediately and
existing live queries react from collection state. If the collection is not
materialized yet, the chunk is stored and applied when that `collectionId`
materializes.

## What Gets Serialized

`dbClient.dehydrate()` serializes only collection state that can safely cross the
server/client boundary.

Serialized:

- collection ids
- synced row keys and values
- row metadata
- adapter sync metadata from `exportSyncMeta`

Not serialized:

- mutation handlers
- pending optimistic mutations
- pending subscriptions
- live query result objects
- D2 graphs or compiled pipelines
- transaction stacks
- module-level runtime state

The rule is: if the client can reconstruct it from collection state or adapter
sync, it does not belong in the payload. If the row data cannot be reconstructed
without another round trip, it belongs in the payload.

## Sync Metadata

Adapters can participate in resumable sync with three optional hooks:

```ts
type SyncConfig = {
  exportSyncMeta?: () => unknown
  importSyncMeta?: (meta: unknown) => void
  mergeSyncMeta?: (current: unknown, incoming: unknown) => unknown
}
```

The metadata shape is adapter-owned. Version it inside the adapter payload. If an
adapter cannot understand incoming metadata, it should ignore it and restart
sync from a safe point.

During hydration, DB imports `syncMeta` into the materialized collection. If the
collection already has current metadata, DB calls `mergeSyncMeta(current,
incoming)` when provided and imports the merged result.

If an adapter does not implement sync metadata hooks, row snapshots still hydrate
and the adapter can restart sync normally.

## Initial Data

`initialData` is a startup seed, not a sync-ready signal.

Current `DbClient` precedence, from lowest to highest, is:

1. descriptor `initialData`
2. per-materialization `initialData`
3. hydrated rows

Hydrated rows win because they came from the server payload for this render.
Per-materialization `initialData` wins over descriptor `initialData` because it
is the more local caller choice.

`initialData` never marks adapter sync as ready by itself. The adapter still
owns readiness through its sync lifecycle.

## React Query Identity

React hooks derive live query identity from structured query IR by default:

```tsx
function Todos({ status }: { status: string }) {
  return useLiveQuery({
    query: (q) =>
      q
        .from({ todo: todoCollection })
        .where(({ todo }) => eq(todo.status, status)),
  })
}
```

The captured `status` value is represented in the structured IR, so no
dependency array or `queryKey` is required.

Use `queryKey` when the query contains opaque runtime logic that DB cannot
stably represent:

```tsx
function SearchTodos({ search }: { search: string }) {
  return useLiveQuery({
    queryKey: [todoCollection.id, 'search', search],
    query: (q) =>
      q
        .from({ todo: todoCollection })
        .fn.where(({ todo }) =>
          todo.title.toLowerCase().includes(search.toLowerCase())
        ),
  })
}
```

Common reasons to add `queryKey`:

- `.fn.where(...)`
- `.fn.select(...)`
- `.fn.having(...)`
- function values, symbols, class instances, or circular objects captured inside
  the structured query
- a render path where derived identity becomes measurably expensive

In development, DB throws when structured IR cannot be hashed and points at the
unhashable path. It also warns once if deriving identity becomes expensive enough
that an explicit `queryKey` would be better.

Dependency arrays are accepted for backwards compatibility:

```tsx
useLiveQuery((q) => q.from({ todo: todoCollection }), [status])
```

They warn in development and will be removed in 1.0. Migrate to the config
object form:

```tsx
useLiveQuery({
  query: (q) => q.from({ todo: todoCollection }),
})
```

Add `queryKey` only if the query uses opaque logic or trips the performance
warning.

## Migration Guide

### 1. Create descriptors instead of SSR singletons

For collections that need SSR, replace module-level `createCollection(...)` with
`collectionOptions(...)`.

```tsx
// Before
export const todoCollection = createCollection({
  id: 'todos',
  getKey: (todo) => todo.id,
  sync: todoSync,
})

// After
export const todoCollection = collectionOptions({
  id: 'todos',
  getKey: (todo) => todo.id,
  sync: todoSync,
})
```

Collections that never participate in SSR can keep using `createCollection`.

### 2. Add a `DbClient`

Use a new client for every server request and a stable client for each browser
app instance.

```tsx
const dbClient = new DbClient()
```

In tests, create a new client per test unless the test is explicitly covering
shared state.

### 3. Wrap React with `DbProvider`

```tsx
root.render(
  <DbProvider client={dbClient}>
    <App />
  </DbProvider>
)
```

Hooks that resolve collection descriptors need this provider. Without it, DB
throws instead of falling back to hidden global state.

### 4. Use collection hooks for imperative operations

Use descriptors directly in live query sources, and materialize only when you
need collection methods:

```tsx
function useTodoCollection() {
  return useDbClient().collection(todoCollection)
}

function TodoActions({ id }: { id: string }) {
  const todos = useTodoCollection()

  return (
    <button onClick={() => todos.delete(id)}>
      Delete
    </button>
  )
}
```

This keeps request/client scoping in one place and avoids reintroducing
module-level collections.

### 5. Replace dependency arrays

Most queries can drop the dependency array entirely:

```tsx
// Before
useLiveQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.status, status)),
  [status],
)

// After
useLiveQuery({
  query: (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.status, status)),
})
```

If the query uses opaque functional variants, add `queryKey`:

```tsx
useLiveQuery({
  queryKey: [todoCollection.id, 'status-fn', status],
  query: (q) =>
    q
      .from({ todo: todoCollection })
      .fn.where(({ todo }) => todo.status === status),
})
```

### 6. Preload and dehydrate on the server

Preload the route's collections or live queries, then serialize:

```tsx
const dbClient = new DbClient()
const todos = dbClient.collection(todoCollection)

const openTodos = createLiveQueryCollection({
  query: (q) => q.from({ todo: todos }).where(({ todo }) => eq(todo.status, 'open')),
})

await openTodos.preload()

return {
  dbState: dbClient.dehydrate(),
}
```

### 7. Hydrate before client hooks read DB

```tsx
const client = new DbClient()
client.hydrate(loaderData.dbState)
```

Then provide it with `DbProvider`.

## Compatibility

No existing public API is removed by this change.

Still supported:

- `createCollection(...)`
- passing collection instances to `useLiveQuery(...)`
- `useLiveQuery(queryFn, deps)`
- `useLiveSuspenseQuery(queryFn, deps)`
- mutation APIs such as `insert`, `update`, `delete`, `subscribe`, and
  optimistic mutation helpers

Warnings:

- React dependency arrays warn in development and will be removed in 1.0.
- Opaque query IR without `queryKey` throws in development because DB cannot
  derive stable identity safely.
- Expensive derived identity warns in development and suggests `queryKey`.

Required for SSR:

- stable explicit collection ids
- request-scoped server `DbClient`
- browser-scoped client `DbClient`
- `DbProvider` for descriptor resolution in React
- `dehydrate()` on the server and `hydrate()` in the browser

## Detailed Changelog

### Added

- `DbClient`
- `collectionOptions(...)`
- `CollectionOptions` descriptor type
- `CollectionMaterializeOptions`
- `DehydratedDbState`
- `DehydratedCollectionChunk`
- `DehydratedCollectionRow`
- `dbClient.collection(descriptor, options?)`
- `dbClient.dehydrate()`
- `dbClient.hydrate(state)`
- `dbClient.applyCollectionChunk(chunk)`
- React `DbProvider`
- React `useDbClient()`
- React `useOptionalDbClient()`
- React descriptor resolution inside live query builders
- React derived structured query identity
- React `queryKey` escape hatch for opaque or hot-path queries
- SSR-capable `useSyncExternalStore` server snapshot support
- TanStack Start + Playwright SSR E2E coverage

### Changed

- React `useLiveQuery({ query })` can use collection descriptors directly in
  `from`, `join`, `leftJoin`, and `unionAll` sources when a `DbProvider` is
  present.
- React live query identity is derived from normalized structured IR when no
  explicit `queryKey` or legacy dependency array is supplied.
- Live query preloading for SSR serializes source collection rows by default,
  not live query result snapshots.
- Hydration applies rows as committed synced state without invoking mutation
  handlers or creating optimistic state.
- Streaming chunks use the same payload shape as full dehydration.

### Deprecated

- React dependency arrays for `useLiveQuery` and wrappers that delegate to it.
  They still work and warn in development. They are planned for removal in 1.0.

### Not Changed

- `createCollection(...)` remains available.
- Direct collection runtime APIs remain available.
- Non-React adapters keep their existing dependency/reactivity model until they
  get their own SSR/client-provider work.
- Query collection `queryKey` is still TanStack Query's cache key. It is
  separate from React live query identity.

## Validation

The SSR strategy is covered by:

- core `DbClient` tests for hydration, streaming chunks, sync metadata,
  initial data precedence, explicit ids, and no optimistic serialization
- React tests for `DbProvider`, descriptor resolution, derived query identity,
  `queryKey`, deprecation warnings, and SSR hydration
- query adapter tests to ensure Query cache behavior still holds
- persistence core tests to ensure persisted row behavior remains intact
- a TanStack Start + Playwright E2E that verifies server HTML contains hydrated
  DB rows, browser hydration succeeds, and an incremental collection chunk
  updates an existing live query
