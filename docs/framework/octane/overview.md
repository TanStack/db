---
title: TanStack DB Octane Adapter
id: adapter
---

## Installation

```sh
npm install @tanstack/octane-db octane @octanejs/vite-plugin
```

Configure the Octane compiler in your Vite app — see [Octane build tools](https://octanejs.dev/docs/build-tools).

`@tanstack/octane-db` re-exports everything from `@tanstack/db`. Import collections, query helpers, and hooks from `@tanstack/octane-db`.

## Octane Hooks

See the [Octane Functions Reference](./reference/index.md) for the full hook list.

For comprehensive documentation on writing queries (filtering, joins, aggregations, etc.), see the [Live Queries Guide](../../guides/live-queries).

## Basic Usage

The examples below assume `todosCollection` and `postsCollection` are collections you've already created (see the [Collections guide](../../guides/collections)), and that query helpers such as `eq` and `gt` are imported from `@tanstack/octane-db`.

### useLiveQuery

```tsx
import { useLiveQuery, eq } from '@tanstack/octane-db'

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

All query hooks (`useLiveQuery`, `useLiveInfiniteQuery`, `useLiveSuspenseQuery`) accept an optional dependency array as their last parameter. When any value in the array changes, the query is recreated and re-executed.

```tsx
function FilteredTodos({ minPriority }: { minPriority: number }) {
  const { data } = useLiveQuery(
    (q) => q.from({ todos: todosCollection })
           .where(({ todos }) => gt(todos.priority, minPriority)),
    [minPriority]
  )

  return <div>{data.length} high-priority todos</div>
}
```

### useLiveInfiniteQuery

```tsx
import { useLiveInfiniteQuery, eq } from '@tanstack/octane-db'

function PostFeed({ category }: { category: string }) {
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
    [category]
  )

  return <div>{data.length} posts loaded</div>
}
```

### useLiveSuspenseQuery

Wrap components in Octane `Suspense` (and `@try` / `@catch` or an error boundary for failures):

```tsx
import { Suspense } from 'octane'
import { useLiveSuspenseQuery, eq } from '@tanstack/octane-db'

function TodoList({ filter }: { filter: string }) {
  const { data } = useLiveSuspenseQuery(
    (q) => q.from({ todos: todosCollection })
           .where(({ todos }) => eq(todos.filter, filter)),
    [filter]
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

### Incremental adoption from React

You can host compiled Octane components inside an existing React 19 app with `OctaneCompat` from `octane/react`. Islands can use `@tanstack/octane-db` hooks while the rest of the app keeps `@tanstack/react-db`. See [OctaneCompat](https://octanejs.dev/docs/differences-from-react).
