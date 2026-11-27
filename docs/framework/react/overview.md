---
title: TanStack DB React Adapter
id: adapter
---

## Installation

```sh
npm install @tanstack/react-db
```

## React Hooks

See the [React Functions Reference](./reference/index.md) to see the full list of hooks available in the React Adapter.

For comprehensive documentation on writing queries (filtering, joins, aggregations, etc.), see the [Live Queries Guide](../../guides/live-queries).

## Basic Usage

Create a `DbClient` and provide it to your React tree:

```tsx
import { DbClient, DbProvider } from '@tanstack/react-db'

const dbClient = new DbClient()

root.render(
  <DbProvider client={dbClient}>
    <App />
  </DbProvider>
)
```

### useLiveQuery

The `useLiveQuery` hook creates a live query that automatically updates your component when data changes:

```tsx
import { and, eq, gt, useDbClient, useLiveQuery } from '@tanstack/react-db'

function TodoList() {
  const { data, isLoading } = useLiveQuery({
    query: (q) =>
      q.from({ todos: todoCollection })
       .where(({ todos }) => eq(todos.completed, false))
       .select(({ todos }) => ({ id: todos.id, text: todos.text })),
  })

  if (isLoading) return <div>Loading...</div>

  return (
    <ul>
      {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
    </ul>
  )
}
```

### Query Identity

React live query hooks derive the live query identity from structured query IR by default. The hook runs the query builder, normalizes the resulting IR, and uses that as the identity. A changed query plan creates a new live-query Collection. Changing only a finite outer limit or offset moves the existing Collection's window.

That means normal structured queries do not need a separate `queryKey`. Collection descriptors provide stable collection IDs, and captured values inside structured expressions become part of the derived identity:

```tsx
function FilteredTodos({ minPriority }: { minPriority: number }) {
  const { data } = useLiveQuery({
    query: (q) => q.from({ todos: todoCollection })
           .where(({ todos }) => gt(todos.priority, minPriority)),
  })

  return <div>{data.length} high-priority todos</div>
}
```

For queries without `queryKey` in one mounted hook and `DbClient` scope, a
source Collection ID must keep referring to the same Collection object. If a
render supplies a different source object with a previously used ID, the hook
throws `SourceCollectionIdReuseError` instead of returning rows from the old
source. To reuse an ID within that hook,
unmount it, clean up its source and client scope, then mount the replacement.
Separate hooks and independent client scopes can use the same ID.

A mounted binding keeps its Collection options until query identity changes.
Independent query inputs to `useLiveQuery` and `useLiveSuspenseQuery` receive
their own live-query Collections, even with equal query keys and options. Their
source Collections can be shared. Passing the same pre-created Collection to
both hooks explicitly shares that Collection. Changing only the outer finite
limit or offset retains each hook's Collection, including under `DbProvider`.
Cached `DbClient` results additionally reject conflicting `getKey` or `schema`
references under the same query identity; use distinct query keys for those
callers.

#### Collection Hooks

`useLiveQuery` resolves collection descriptors from `DbProvider` automatically. Create small collection hooks when components need imperative collection methods like `insert`, `update`, `delete`, or `preload`:

```tsx
function useTodoCollection() {
  return useDbClient().collection(todoCollection)
}
```

#### When to Use Query Keys

Use `queryKey` only when DB cannot derive identity from structured IR, or when you intentionally want to avoid deriving identity on a hot render path. The common case is a functional query variant such as `.fn.where`, `.fn.select`, or `.fn.having`:

```tsx
function SearchTodos({ search }: { search: string }) {
  const { data } = useLiveQuery({
    queryKey: [todoCollection.id, 'search', search],
    query: (q) => q.from({ todos: todoCollection })
           .fn.where(({ todos }) =>
             todos.text.toLowerCase().includes(search.toLowerCase())
           ),
  })

  return <div>{data.length} matching todos</div>
}
```

An explicit `queryKey` is the caller's identity contract. If its source object
changes, change the key too, even when the source ID stays the same. Use a
primitive scope token in the key; Collection objects cannot be hashed there.

Treat `queryKey` and its nested values as immutable. Fresh objects with equal
contents keep the authored query, including when record properties appear in a
different order. To change a nested value, replace that object and its parent
objects, as with React state. In-place mutation has no supported invalidation
behavior. This applies to both `useLiveQuery` and `useLiveSuspenseQuery`.

An unhashable query without `queryKey` throws `UnhashableQueryIRError`, so
represent the values that opaque logic captures in the key. An empty
`queryKey` counts as none, as it does for a `DbClient` preload. A dependency
array does not replace `queryKey` for such a query. If deriving identity becomes
expensive across renders, the hook warns once and suggests adding a `queryKey`
as a performance escape hatch.

#### What Happens When Identity Changes

When an identity change requires a new query plan, the hook replaces its
live-query Collection and renders the new result. While its initial result
loads, `useLiveSuspenseQuery` shows the Suspense fallback and `useLiveQuery`
reports loading. A finite outer limit or offset change retains the Collection
and moves its window after commit.

#### Best Practices

**Use structured expressions when possible:**

```tsx
// Good - DB can derive identity from this structured IR
const { data } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
         .where(({ todos }) => and(
           eq(todos.userId, userId),
           eq(todos.status, status)
         )),
})
```

**Add a query key for opaque runtime logic:**

```tsx
const { data } = useLiveQuery({
  queryKey: [todoCollection.id, 'by-user-fn', userId],
  query: (q) => q.from({ todos: todoCollection })
         .fn.where(({ todos }) => todos.userId === userId),
})
```

**Omit query keys for static structured queries:**

```tsx
const { data } = useLiveQuery({
  query: (q) => q.from({ todos: todoCollection }),
})
```

For SSR setup, collection hydration, and migration details, see the [SSR and Hydration guide](../../guides/ssr.md).

### useLiveInfiniteQuery

For paginated data with live updates, use `useLiveInfiniteQuery`:

```tsx
const { data, pages, fetchNextPage, hasNextPage } = useLiveInfiniteQuery(
  (q) => q
    .from({ posts: postsCollection })
    .where(({ posts }) => eq(posts.category, category))
    .orderBy(({ posts }) => posts.createdAt, 'desc'),
  {
    pageSize: 20,
  }
)
```

`fetchNextPage()` returns a promise that resolves after the page request settles. A failed page load does not reject the promise or change `status`; it appears as a request error in the returned `health` tree.

This hook widens an ordered live query; it is not TanStack Query's
`useInfiniteQuery`. `getNextPageParam` is not supported.
`initialPageParam` only labels the returned pages; it does not set a server cursor
or skip remote rows. For server pagination, use an on-demand Query Collection
whose `queryFn` fulfills `meta.loadSubsetOptions`. See the
[server pagination guide](../../collections/query-collection.md#server-pagination-with-live-queries).

React hook dependency arrays were removed in the first 1.0 RC. Use derived query identity or an explicit `queryKey`.

### useLiveSuspenseQuery

For React Suspense integration, use `useLiveSuspenseQuery`:

```tsx
function TodoList({ filter }: { filter: string }) {
  const { data } = useLiveSuspenseQuery({
    query: (q) => q.from({ todos: todoCollection })
           .where(({ todos }) => eq(todos.filter, filter)),
  })

  return (
    <ul>
      {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
    </ul>
  )
}

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TodoList filter="active" />
    </Suspense>
  )
}
```

When a changed query plan creates a new live-query Collection,
`useLiveSuspenseQuery` shows your Suspense fallback until its initial result
is ready. Finite outer-window moves retain the Collection and follow its
window publication policy.

### Animating live query results with View Transitions

Use React `<ViewTransition>` to animate rows entering, leaving, or moving in a
live query list. Pass the query's `data` to `useDeferredValue` and wrap each
rendered row in a `<ViewTransition>` with a stable, unique key. Use the result
row's `$key`, which also identifies individual rows in a join. If result keys
mix strings and numbers, include the type in the React key. For example,
`` `${typeof row.$key}:${row.$key}` `` keeps `1` and `'1'` distinct.
[Live query virtual properties](../../guides/live-queries.md#virtual-properties)

`<ViewTransition>` is stable in React 19.3 and uses the browser's View Transition API.
[React View Transitions documentation](https://react.dev/reference/react/ViewTransition)

`useLiveQuery` and `useLiveSuspenseQuery` subscribe through `useSyncExternalStore`.
React handles store updates synchronously, even when you call a collection
mutation inside `startTransition`. `useDeferredValue` lets React keep showing
the previous results and render the latest results in the background. React
can animate the change when that render commits. The same pattern works for
changes from local writes or incoming sync data.
[React external store caveats](https://react.dev/reference/react/useSyncExternalStore#caveats) · [React useDeferredValue documentation](https://react.dev/reference/react/useDeferredValue)

```tsx
import {
  collectionOptions,
  localOnlyCollectionOptions,
  useLiveQuery,
} from '@tanstack/react-db'
import { useDeferredValue, ViewTransition } from 'react'

const todoCollection = collectionOptions(
  localOnlyCollectionOptions({
    id: 'todos',
    getKey: (todo) => todo.id,
    initialData: [
      { id: 1, text: 'Write a note' },
      { id: 2, text: 'Water the plants' },
    ],
  }),
)

export function TodoList() {
  const { data, isLoading } = useLiveQuery({
    query: (q) =>
      q.from({ todo: todoCollection }).orderBy(({ todo }) => todo.text),
  })
  const visibleTodos = useDeferredValue(data)

  if (isLoading) return <p>Loading…</p>

  return (
    <ul>
      {visibleTodos.map((todo) => (
        <ViewTransition key={todo.$key}>
          <li>{todo.text}</li>
        </ViewTransition>
      ))}
    </ul>
  )
}
```

Respect the user's `prefers-reduced-motion` setting. To disable the row
animations, pass `default={prefersReducedMotion ? 'none' : 'auto'}` to each
`<ViewTransition>`, where `prefersReducedMotion` is your app's current value
for that media query.
[React View Transition props](https://react.dev/reference/react/ViewTransition#view-transition-class)

A deferred list can briefly show a row after deletion. If a row has a Delete
button, use the target collection's key for the record you want to delete.
Check `collection.has(key)` before calling `collection.delete(key)`. For a
joined result, `$key` identifies the result row for rendering. Read the record
key from the source you intend to delete from.
