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

React query hooks derive the live query identity from structured query IR by default. The hook runs the query builder, normalizes the resulting IR, and uses that as the identity. When the derived identity changes, the old live query collection is cleaned up and a new one is created.

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

In development, `useLiveQuery` enforces this boundary. If the structured IR contains opaque values that cannot be hashed, it throws and points at the path that needs an explicit `queryKey`. If deriving identity becomes expensive across renders, it warns once and suggests adding a `queryKey` as a performance escape hatch.

#### What Happens When Identity Changes

When the derived identity or explicit query key changes:
1. The previous live query collection is cleaned up
2. A new query is created with the updated values
3. The component re-renders with the new data
4. The hook suspends (for `useLiveSuspenseQuery`) or shows loading state

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

Dependency arrays are still accepted for backwards compatibility, but they warn in development and will be removed in 1.0.

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
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 20 ? allPages.length : undefined
  }
)
```

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

When the derived identity or explicit `queryKey` changes, `useLiveSuspenseQuery` will re-suspend, showing your Suspense fallback until the new data is ready.
