---
title: TanStack DB React Adapter
id: adapter
---

## Installation

```sh
npm install @tanstack/react-db
```

## React Hooks

See the [React Functions Reference](../reference/index.md) to see the full list of hooks available in the React Adapter.

## Basic Usage

### useLiveQuery

The `useLiveQuery` hook creates a live query that automatically updates your component when data changes:

```tsx
import { useLiveQuery } from '@tanstack/react-db'

function TodoList() {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
  )

  if (isLoading) return <div>Loading...</div>

  return (
    <ul>
      {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
    </ul>
  )
}
```

### Dependency Arrays

All query hooks (`useLiveQuery`, `useLiveInfiniteQuery`, `useLiveSuspenseQuery`) accept an optional dependency array as their last parameter. This array works similarly to React's `useEffect` dependencies - when any value in the array changes, the query is recreated and re-executed.

#### When to Use Dependency Arrays

Use dependency arrays when your query depends on external reactive values (props, state, or other hooks):

```tsx
function FilteredTodos({ minPriority }: { minPriority: number }) {
  const { data } = useLiveQuery(
    (q) => q.from({ todos: todosCollection })
           .where(({ todos }) => gt(todos.priority, minPriority)),
    [minPriority] // Re-run when minPriority changes
  )

  return <div>{data.length} high-priority todos</div>
}
```

#### What Happens When Dependencies Change

When a dependency value changes:
1. The previous live query collection is cleaned up
2. A new query is created with the updated values
3. The component re-renders with the new data
4. The hook suspends (for `useLiveSuspenseQuery`) or shows loading state

#### Best Practices

**Include all external values used in the query:**

```tsx
// Good - all external values in deps
const { data } = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => and(
           eq(todos.userId, userId),
           eq(todos.status, status)
         )),
  [userId, status]
)

// Bad - missing dependencies
const { data } = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.userId, userId)),
  [] // Missing userId!
)
```

**Empty array for static queries:**

```tsx
// No external dependencies - query never changes
const { data } = useLiveQuery(
  (q) => q.from({ todos: todosCollection }),
  []
)
```

**Omit the array for queries with no external dependencies:**

```tsx
// Same as above - no deps needed
const { data } = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
)
```

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
  },
  [category] // Re-run when category changes
)
```

**Note:** The dependency array is only available when using the query function variant, not when passing a pre-created collection.

### useLiveSuspenseQuery

For React Suspense integration, use `useLiveSuspenseQuery`:

```tsx
function TodoList({ filter }: { filter: string }) {
  const { data } = useLiveSuspenseQuery(
    (q) => q.from({ todos: todosCollection })
           .where(({ todos }) => eq(todos.filter, filter)),
    [filter] // Re-suspends when filter changes
  )

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

When dependencies change, `useLiveSuspenseQuery` will re-suspend, showing your Suspense fallback until the new data is ready.
