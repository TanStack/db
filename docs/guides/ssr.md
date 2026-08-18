---
title: SSR and Hydration
id: ssr
---

# SSR and Hydration

TanStack DB SSR transports the smallest useful snapshot for the work the server
performed:

- Explicitly preloaded collections dehydrate as normalized collection rows.
- Preloaded or render-discovered live queries dehydrate as ordered query-result
  snapshots, without serializing all of their source collections.

The browser renders either snapshot immediately, starts its normal collection
sync and live-query pipeline, then atomically replaces a live-query snapshot
when the browser result becomes authoritative.

## High-level Summary

The SSR-friendly API adds six concepts:

- `DbClient` owns materialized collection instances for one request, browser app,
  test, or script.
- `collectionOptions(...)` creates a stable collection descriptor. Reusable
  descriptors create fresh adapter config for each `DbClient`.
- `dbClient.dehydrate()`, `dbClient.hydrate(state)`, and
  `dbClient.applyCollectionChunk(chunk)` move explicit collection state across
  the server/client boundary.
- `dbClient.preloadLiveQuery(options)` captures only the ordered result of a
  live query for hydration or streaming.
- React and Svelte apps use `DbProvider` so hooks can resolve collection
  descriptors against the current client.
- `@tanstack/react-router-with-db` streams live queries discovered by Suspense
  during a TanStack Start server render.

Existing apps continue to work. `createCollection(...)` and direct collection
instances still exist. The migration is required when you want SSR-safe request
isolation, hydration, incremental chunks, Suspense streaming, or the 1.0-ready
React hook shape.

The old dependency-array form now warns:

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
| Define a collection | `createCollection(options)` | `collectionOptions(id, factory)` |
| Materialize a collection | module-level singleton | `dbClient.collection(todoCollection)` |
| Scope collection state | module lifetime | `new DbClient()` per request/browser/test |
| Provide React context | none | `<DbProvider client={dbClient}>` |
| Query from React | direct collection instance | descriptor in `from`, resolved by `DbProvider` |
| Mutate from React | import singleton collection | `useDbClient().collection(todoCollection)` |
| Server preload | ad hoc collection preload | `collection.preload()` or `dbClient.preloadLiveQuery(...)` |
| Serialize SSR state | none | `const state = dbClient.dehydrate()` |
| Hydrate in browser | none | `dbClient.hydrate(state)` before hooks read it |
| Apply rows incrementally | custom app state | `dbClient.applyCollectionChunk(chunk)` |
| Stream render-time results | none | `routerWithDbClient(router, dbClient)` |
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

const todoCollection = collectionOptions('todos', () => ({
  id: 'todos',
  getKey: (todo: Todo) => todo.id,
  sync: {
    sync: ({ markReady }) => {
      markReady()
    },
  },
}))

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

The factory matters when config contains mutable adapter state or closures.
Every `DbClient` gets a fresh config and collection instance. First-party
adapter option creators already attach an equivalent factory, so this is also
safe:

```tsx
const todoCollection = collectionOptions(
  localOnlyCollectionOptions<Todo>({
    id: 'todos',
    getKey: (todo) => todo.id,
  })
)
```

A descriptor created from an arbitrary concrete config can be materialized by
one `DbClient` only. Use the explicit factory form for custom adapters and
request-scoped dependencies.

## SSR Flow

The server and browser use the same descriptors, but different `DbClient`
instances.

```txt
server request
  -> new DbClient()
  -> preload an explicit collection or live-query result
  -> dbClient.dehydrate()
  -> send state through framework loader

browser
  -> new DbClient()
  -> dbClient.hydrate(loaderState)
  -> <DbProvider client={dbClient}>
  -> useLiveQuery({ query })
  -> start source sync
  -> atomically replace any query snapshot with the live result
```

During React hydration, descriptor-backed queries read either hydrated
collection rows or their matching query-result snapshot for the first browser
render. Adapter sync and queued on-demand loads start when React commits the
external-store subscription, so the initial markup still matches the server.
The snapshot remains visible while the source is loading. Once the browser live
query is ready, DB publishes one handoff from the snapshot to the live result.

### Server

Create a fresh `DbClient` for each request. Materialize descriptors through that
client, preload the data needed for the route, and dehydrate the client.

```tsx
import { DbClient, collectionOptions, eq } from '@tanstack/db'

export const todoCollection = collectionOptions('todos', () => ({
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
}))

export async function loadTodosForSsr() {
  const dbClient = new DbClient()
  const todos = dbClient.collection(todoCollection)
  await todos.preload()

  return dbClient.dehydrate()
}
```

This explicit collection preload dehydrates normalized source rows. Use it when
multiple browser queries need the same source data.

If the source is much larger than the rendered result, preload the query instead:

```tsx
const dbClient = new DbClient()

await dbClient.preloadLiveQuery({
  query: (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.status, 'open'))
      .select(({ todo }) => ({ id: todo.id, title: todo.title })),
})

const state = dbClient.dehydrate()
```

This payload contains the projected query result and no source collection rows
unless that collection was also materialized explicitly.

### Browser

Hydrate the browser client before rendering components that read from DB.

```tsx
import {
  DbClient,
  DbProvider,
  HydrationBoundary,
} from '@tanstack/react-db'

function App({ dehydratedDbState }: { dehydratedDbState: DehydratedDbState }) {
  const [dbClient] = React.useState(() => new DbClient())

  return (
    <DbProvider client={dbClient}>
      <HydrationBoundary state={dehydratedDbState}>
        <Routes />
      </HydrationBoundary>
    </DbProvider>
  )
}
```

Frameworks differ in how loader data reaches the client, but the DB handoff is
the same: `DbClient` on the server, `dehydrate()`, then `hydrate()` into the
browser client.

### Svelte

Svelte resolves descriptors from its own `DbProvider` and reads hydrated query
snapshots synchronously during server rendering:

```svelte
<script lang="ts">
  import { DbClient, DbProvider } from '@tanstack/svelte-db'
  import Todos from './Todos.svelte'

  const client = new DbClient()
  client.hydrate(dehydratedDbState)
</script>

<DbProvider {client}>
  <Todos />
</DbProvider>
```

Inside `Todos.svelte`, `useLiveQuery({ query })` can use collection descriptors
directly. The browser subscription starts source sync and performs the same
snapshot-to-live-result handoff as React.

Live demo: https://tanstack-db-ssr-demo.netlify.app/ssr-db

## Suspense Streaming with TanStack Start

`@tanstack/react-router-with-db` follows the same integration pattern as
`@tanstack/react-router-with-query`:

```tsx
import { DbClient } from '@tanstack/react-db'
import { createRouter } from '@tanstack/react-router'
import { routerWithDbClient } from '@tanstack/react-router-with-db'

export type RouterContext = {
  dbClient: DbClient
}

export function getRouter() {
  const dbClient = new DbClient()
  const router = createRouter({
    routeTree,
    context: { dbClient },
  })

  return routerWithDbClient(router, dbClient)
}
```

The adapter adds `dbClient` to router context, wraps the app in `DbProvider`,
dehydrates critical state, and opens a stream for query results discovered later
during rendering.

```tsx
function RouteComponent() {
  return (
    <Suspense fallback={<p>Loading todos</p>}>
      <TodoList />
    </Suspense>
  )
}

function TodoList() {
  const { data } = useLiveSuspenseQuery({
    query: (q) =>
      q
        .from({ todo: todoCollection })
        .where(({ todo }) => eq(todo.status, 'open')),
  })

  return data.map((todo) => <Todo key={todo.id} todo={todo} />)
}
```

When `TodoList` suspends on the server, the adapter streams the pending query
promise. That promise resolves to the ordered live-query result snapshot inside
the streamed `DehydratedDbState`. The source collections and D2 graph do not
cross the wire. The browser shows the snapshot, starts the source collections
and live query normally, then replaces the snapshot when the browser result is
ready.

The server and browser must derive the same live-query identity. Structured
queries do this automatically. An opaque query must provide a serializable
`queryKey`; render-time streaming throws if it cannot derive an identity.

## Suspense Streaming with Next.js

Next.js App Router can transport the same pending query promise through React
Server Components. Start the preload without awaiting it, dehydrate the pending
result, and pass that state to a client hydration boundary:

```tsx
export default function Page() {
  const dbClient = new DbClient()
  void dbClient.preloadLiveQuery(openTodosQuery)

  const state = dbClient.dehydrate({
    shouldDehydrateCollection: () => false,
    shouldDehydrateLiveQuery: () => true,
  })

  return (
    <DbHydration state={state}>
      <Suspense fallback={<p>Loading todos</p>}>
        <TodoList />
      </Suspense>
    </DbHydration>
  )
}
```

`DbHydration` is a client component that creates one browser `DbClient`, wraps
children in `DbProvider`, and passes `state` to `HydrationBoundary`. React streams
the promise result into that boundary. The full working integration is in
`examples/react/next-ssr-e2e`.

## Incremental Collection Hydration

Applications can also apply collection rows received through their own stream.
Incremental hydration uses the same collection chunk shape as holistic
dehydration:

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

`dbClient.dehydrate()` can emit two independent snapshot types.

Serialized:

- explicit collection snapshots: collection id, synced row keys and values, row
  metadata, and adapter sync metadata from `exportSyncMeta`
- live-query snapshots: query hash and ordered result rows; completed explicit
  preloads are included by default, while framework integrations opt pending
  promises into streaming

Not serialized:

- mutation handlers
- pending optimistic mutations
- pending subscriptions
- D2 graphs or compiled pipelines
- transaction stacks
- module-level runtime state
- source collection rows for a query-result snapshot, unless that collection was
  also explicitly materialized for dehydration

Choose the payload unit according to what the browser needs. Explicit collection
preloading preserves normalized rows for reuse across queries. Live-query
preloading avoids shipping a 50-100x larger source when the rendered projection
is small. Neither mode serializes executable query state.

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

Before adapter sync starts, current `DbClient` precedence from lowest to highest
is:

1. per-materialization `initialData`
2. persisted rows
3. hydrated rows

Fresh adapter sync is authoritative over all three. Hydrated and initial rows
are provisional base state, so the adapter's first insert for the same key is
reconciled as an update instead of raising a duplicate-key error.

Hydrated rows and `initialData` never mark adapter sync as ready by themselves.
The adapter still owns readiness through its sync lifecycle.

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

Before 1.0, DB warns when structured IR cannot be hashed and preserves the
legacy mount-stable identity. The query still works, but captured values inside
opaque logic are not reactive unless they are represented in `queryKey`. In 1.0,
an unhashable query without `queryKey` will throw.

DB also warns once in development if deriving identity becomes expensive enough
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

For collections that need SSR, replace module-level `createCollection(...)`
with a reusable `collectionOptions(...)` descriptor.

```tsx
// Before
export const todoCollection = createCollection({
  id: 'todos',
  getKey: (todo) => todo.id,
  sync: todoSync,
})

// After
export const todoCollection = collectionOptions('todos', () => ({
  id: 'todos',
  getKey: (todo: Todo) => todo.id,
  sync: createTodoSync(),
}))
```

Put mutable state and closures inside the factory. First-party adapter option
creators can also be passed directly because they provide a fresh config
factory. Collections that never participate in SSR can keep using
`createCollection`.

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

Preload a collection when the browser should receive normalized source rows:

```tsx
const dbClient = new DbClient()
const todos = dbClient.collection(todoCollection)
await todos.preload()

return {
  dbState: dbClient.dehydrate(),
}
```

Preload a live query when the browser only needs the rendered result:

```tsx
const dbClient = new DbClient()
await dbClient.preloadLiveQuery(openTodosQuery)

return {
  dbState: dbClient.dehydrate(),
}
```

### 7. Hydrate before client hooks read DB

```tsx
<DbProvider client={client}>
  <HydrationBoundary state={loaderData.dbState}>
    <App />
  </HydrationBoundary>
</DbProvider>
```

Imperative integrations can call `client.hydrate(loaderData.dbState)` before
rendering instead.

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
- Opaque query IR without `queryKey` warns in development and keeps legacy
  mount-stable identity until 1.0. In 1.0 it will throw.
- Expensive derived identity warns in development and suggests `queryKey`.

Required for SSR:

- stable explicit collection ids
- request-scoped server `DbClient`
- browser-scoped client `DbClient`
- `DbProvider` for descriptor resolution in React
- `dehydrate()` on the server and `hydrate()` in the browser

Required for render-time Suspense streaming:

- `routerWithDbClient(router, dbClient)`
- `useLiveSuspenseQuery(...)` inside a Suspense boundary
- a stable derived query identity or explicit serializable `queryKey`

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
- `dbClient.subscribe(listener)`
- `dbClient.createTransaction(config)`
- `dbClient.cleanup()`
- React `DbProvider`
- React `useDbClient()`
- React `useOptionalDbClient()`
- React `HydrationBoundary`
- React descriptor resolution inside live query builders
- React derived structured query identity
- React `queryKey` escape hatch for opaque or hot-path queries
- React per-query `client` override
- SSR-capable `useSyncExternalStore` server snapshot support
- `dbClient.preloadLiveQuery(...)`
- Svelte `DbProvider`, `useDbClient()`, descriptor resolution, and synchronous
  server snapshot support
- TanStack Start and Next.js Playwright SSR E2E coverage
- `@tanstack/react-router-with-db`
- render-time `useLiveSuspenseQuery` promise streaming

### Changed

- React `useLiveQuery({ query })` can use collection descriptors directly in
  `from`, `join`, `leftJoin`, and `unionAll` sources when a `DbProvider` is
  present.
- React live query identity is derived from normalized structured IR when no
  explicit `queryKey` or legacy dependency array is supplied.
- Explicit collection preloading serializes normalized collection rows.
- Live-query preloading and render-time discovery serialize ordered result
  snapshots without implicitly serializing source collections.
- Browser observers keep the hydrated result visible while normal source sync
  starts, then publish one authoritative handoff.
- Hydration applies rows as committed synced state without invoking mutation
  handlers or creating optimistic state.
- Hydration and adapter sync begin in a deterministic order: pending rows and
  sync metadata are imported before sync starts.
- `DbClient` owns collection instances and ambient transaction scope; cleanup
  releases both.
- Incremental chunks use the same collection payload shape as full dehydration.
- Streamed live-query promises resolve to live-query result snapshots.

### Deprecated

- React dependency arrays for `useLiveQuery` and wrappers that delegate to it.
  They still work and warn in development. They are planned for removal in 1.0.

### Not Changed

- `createCollection(...)` remains available.
- Direct collection runtime APIs remain available.
- Vue, Solid, and Angular keep their existing dependency/reactivity model until
  they get their own SSR/client-provider work. Svelte is covered by this change.
- Query collection `queryKey` is still TanStack Query's cache key. It is
  separate from React live query identity.

## Validation

The SSR strategy is covered by:

- core `DbClient` tests for hydration, streaming chunks, sync metadata,
  initial data precedence, explicit ids, and no optimistic serialization
- React tests for `DbProvider`, descriptor resolution, derived query identity,
  `queryKey`, deprecation warnings, SSR result snapshots, and atomic handoff
- Svelte tests for provider ownership, server snapshot rendering, and browser
  handoff
- query adapter tests to ensure Query cache behavior still holds
- persistence core tests to ensure persisted row behavior remains intact
- TanStack Start and Next.js Playwright E2Es that verify a Suspense fallback,
  streamed query result, omitted source-only data, clean hydration, and atomic
  replacement by browser sync
