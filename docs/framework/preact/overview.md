---
title: TanStack DB Preact Adapter
id: adapter
---

## Installation

```sh
npm install @tanstack/preact-db
```

`@tanstack/preact-db` supports Preact 10 and later and ships as ES modules.

Queries read concrete source Collections. Preact has no `DbProvider` yet, so it does not bind collection descriptors or read from a `DbClient`; a query over a descriptor throws when it is consumed. Use `@tanstack/react-db` or `@tanstack/svelte-db` for `DbClient`-based SSR and hydration.

## Preact Hooks

See the [Preact Functions Reference](./reference/index.md) to see the full list of hooks available in the Preact Adapter.

For comprehensive documentation on writing queries (filtering, joins, aggregations, etc.), see the [Live Queries Guide](../../guides/live-queries).

## Basic Usage

### useLiveQuery

The `useLiveQuery` hook creates a live query that automatically updates your component when data changes:

```tsx
import { eq, useLiveQuery } from '@tanstack/preact-db'

function TodoList() {
  const { data, isLoading } = useLiveQuery((q) =>
    q
      .from({ todos: todoCollection })
      .where(({ todos }) => eq(todos.completed, false))
      .select(({ todos }) => ({ id: todos.id, text: todos.text })),
  )

  if (isLoading) return <div>Loading...</div>

  return (
    <ul>
      {data.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  )
}
```

`useLiveQuery` accepts a query callback, a `{ query }` config object, or an existing live-query Collection. Return `undefined` or `null` from the callback to disable the query; a disabled query reports `status: 'disabled'` and has no `data` or `state`:

```tsx
function UserTodos({ userId }: { userId?: string }) {
  const { data, isEnabled } = useLiveQuery((q) =>
    userId
      ? q
          .from({ todos: todoCollection })
          .where(({ todos }) => eq(todos.userId, userId))
      : undefined,
  )

  if (!isEnabled) return <div>Select a user</div>
  return <div>{data?.length} todos</div>
}
```

### Query Identity

Preact live query hooks derive the live query identity from structured query IR. The hook runs the query builder on each render, normalizes the resulting IR, and uses that as the identity. When the derived identity changes, the old live query collection is cleaned up and a new one is created.

That means normal structured queries need no `queryKey` and no dependency array. Captured values inside structured expressions become part of the derived identity:

```tsx
function FilteredTodos({ minPriority }: { minPriority: number }) {
  const { data } = useLiveQuery((q) =>
    q
      .from({ todos: todoCollection })
      .where(({ todos }) => gt(todos.priority, minPriority)),
  )

  return <div>{data.length} high-priority todos</div>
}
```

While a hook is mounted, each source Collection ID its queries read must keep referring to the same Collection object. If a render supplies a different source object with a previously used ID, the hook throws `SourceCollectionIdReuseError` instead of returning rows from the old source. To reuse an ID, unmount the hook, clean up its source, then mount the replacement. Separate hooks can use the same ID.

#### When to Use Query Keys

Use `queryKey` when DB cannot derive identity from structured IR. The common case is a functional query variant such as `.fn.where`, `.fn.select`, or `.fn.having`. Without a `queryKey`, such a query throws `UnhashableQueryIRError`:

```tsx
function SearchTodos({ search }: { search: string }) {
  const { data } = useLiveQuery({
    queryKey: [todoCollection.id, 'search', search],
    query: (q) =>
      q
        .from({ todos: todoCollection })
        .fn.where(({ todos }) =>
          todos.text.toLowerCase().includes(search.toLowerCase()),
        ),
  })

  return <div>{data.length} matching todos</div>
}
```

An explicit `queryKey` is the caller's identity contract. Represent every value the opaque logic captures in the key, and change the key when its source object changes, even if the source ID stays the same. Use a primitive scope token in the key; Collection objects cannot be hashed there.

#### What Happens When Identity Changes

When the derived identity or explicit query key changes:

1. The previous live query collection is cleaned up
2. A new query is created with the updated values
3. The component re-renders with the new data

### useLiveInfiniteQuery

For paginated data with live updates, use `useLiveInfiniteQuery`:

```tsx
const { data, pages, fetchNextPage, hasNextPage } = useLiveInfiniteQuery(
  (q) =>
    q
      .from({ posts: postsCollection })
      .where(({ posts }) => eq(posts.category, category))
      .orderBy(({ posts }) => posts.createdAt, 'desc'),
  {
    pageSize: 20,
  },
)
```

The query must include `.orderBy()`. The hook keeps one live query collection and widens its window as pages load, so every loaded page stays live. Its identity follows `useLiveQuery`: pass `queryKey` in the config for a functional query variant.

`fetchNextPage()` returns a promise that resolves after the page request settles. Failures are exposed through the returned `error` value and do not reject the promise.

This hook widens an ordered live query; it is not TanStack Query's `useInfiniteQuery`. `getNextPageParam` is rejected. `initialPageParam` only labels the returned pages; it does not set a server cursor or skip remote rows. For server pagination, use an on-demand Query Collection whose `queryFn` fulfills `meta.loadSubsetOptions`. See the [server pagination guide](../../collections/query-collection.md#server-pagination-with-live-queries).

### Using Pre-created Collections

Pass an existing live query collection to share one query across components. The hook starts its sync and leaves its retention policy to the caller:

```tsx
const activeTodos = createLiveQueryCollection((q) =>
  q.from({ todos: todoCollection }).where(({ todos }) => eq(todos.active, true)),
)

function ActiveTodos() {
  const { data, collection } = useLiveQuery(activeTodos)
  return <div>{data.length} active todos</div>
}
```
