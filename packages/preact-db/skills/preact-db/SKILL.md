---
name: preact-db
description: >
  Preact bindings for TanStack DB. useLiveQuery hook with query callbacks,
  { query, queryKey } config objects, or pre-created collections; identity is
  derived from query IR, with no dependency arrays. Conditional queries via
  returning undefined/null. useLiveInfiniteQuery for paging an ordered live
  query. Functional variants (fn.where) require queryKey. Import from
  @tanstack/preact-db (re-exports all of @tanstack/db).
type: framework
library: db
framework: preact
library_version: '0.6.17'
requires:
  - db-core
sources:
  - 'TanStack/db:docs/framework/preact/overview.md'
  - 'TanStack/db:packages/preact-db/src/useLiveQuery.ts'
  - 'TanStack/db:packages/preact-db/src/useLiveInfiniteQuery.ts'
---

This skill builds on db-core. Read it first for collection setup, query builder, and mutation patterns.

Queries read concrete source Collections. Preact has no `DbProvider` yet, so it does not bind collection descriptors or read from a `DbClient`; a query over a descriptor throws when it is consumed. Use `@tanstack/react-db` or `@tanstack/svelte-db` for `DbClient`-based SSR and hydration.

# TanStack DB — Preact

## Setup

```tsx
import { eq, not, useLiveQuery } from '@tanstack/preact-db'

function TodoList() {
  const { data, isLoading } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => not(todo.completed))
      .orderBy(({ todo }) => todo.created_at, 'asc'),
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

`@tanstack/preact-db` re-exports everything from `@tanstack/db`. It supports Preact 10+ and ships ES modules only.

## Hooks

### useLiveQuery

```tsx
// Query callback
const { data, state, status, isReady, isEnabled } = useLiveQuery((q) =>
  q.from({ todo: todoCollection }),
)

// Config object (required for queryKey)
const { data } = useLiveQuery({
  query: (q) => q.from({ todo: todoCollection }),
  gcTime: 60_000,
})

// Pre-created live query collection
const { data } = useLiveQuery(activeTodosCollection)

// Disabled until an input exists: data and state are undefined
const { data, isEnabled } = useLiveQuery((q) =>
  userId
    ? q
        .from({ todo: todoCollection })
        .where(({ todo }) => eq(todo.userId, userId))
    : undefined,
)
```

### useLiveInfiniteQuery

```tsx
const { data, pages, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useLiveInfiniteQuery(
    (q) =>
      q
        .from({ post: postsCollection })
        .orderBy(({ post }) => post.createdAt, 'desc'),
    { pageSize: 20 },
  )
```

The query must include `.orderBy()`. `fetchNextPage()` resolves when the page request settles; failures appear in `error`. `getNextPageParam` is rejected.

## Preact-Specific Patterns

### Query identity

The hook derives identity from the query IR on every render. Captured values in structured expressions recompile the query when they change, so there is no dependency array:

```tsx
function Filtered({ minPriority }: { minPriority: number }) {
  const { data } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => gt(todo.priority, minPriority)),
  )
  return <div>{data.length}</div>
}
```

While a hook is mounted, a source Collection ID must keep naming the same Collection object. A different object under a previously read ID throws `SourceCollectionIdReuseError`.

## Common Mistakes

### CRITICAL Using opaque query logic without queryKey

Wrong:

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ todo: todoCollection })
    .fn.where(({ todo }) => todo.text.includes(search)),
)
```

Correct:

```tsx
const { data } = useLiveQuery({
  queryKey: [todoCollection.id, 'search', search],
  query: (q) =>
    q
      .from({ todo: todoCollection })
      .fn.where(({ todo }) => todo.text.includes(search)),
})
```

Functional variants (`fn.where`, `fn.select`, `fn.having`) have no stable IR identity, so without `queryKey` the hook throws `UnhashableQueryIRError`. Put every value the function captures into the key.

### HIGH Using === instead of eq() in .where()

`.where(({ todo }) => todo.completed === false)` compares a query reference, not a value. Use `eq(todo.completed, false)` or `not(todo.completed)`.

### HIGH Reading data of a disabled query without narrowing

A callback that can return `undefined` makes `data` possibly `undefined`. Check `isEnabled` or use `data?.`.
