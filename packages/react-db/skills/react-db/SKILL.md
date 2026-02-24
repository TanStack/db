---
name: react-db
description: >
  React bindings for TanStack DB. Covers useLiveQuery, useLiveSuspenseQuery,
  useLiveInfiniteQuery, usePacedMutations hooks. Dependency arrays for
  reactive query parameters. React Suspense integration with Error Boundaries.
  Infinite query pagination with cursor-based loading. Return shape (data,
  state, collection, status, isLoading, isReady, isError).
type: framework
library: db
framework: react
library_version: "0.5.29"
requires:
  - db-core
---

This skill builds on db-core. Read db-core first for collection setup,
query builder syntax, operators, mutations, and sync concepts.

# TanStack DB — React

## Setup

Install both the core and React packages:

```bash
npm install @tanstack/db @tanstack/react-db
```

Plus your sync adapter (e.g. `@tanstack/query-db-collection`).

Collections are created outside components — typically in a dedicated
module:

```typescript
// collections/todos.ts
import { createCollection, eq } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

export const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: () => fetch('/api/todos').then((r) => r.json()),
    getKey: (todo) => todo.id,
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      await fetch(`/api/todos/${original.id}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
    },
  })
)
```

## Hooks

### useLiveQuery

Subscribes to a live query and re-renders when results change:

```typescript
import { useLiveQuery } from '@tanstack/react-db'
import { eq, gt } from '@tanstack/db'

function TodoList({ userId }: { userId: string }) {
  const { data, status, isLoading, isReady, isError } = useLiveQuery(
    (q) =>
      q
        .from({ t: todosCollection })
        .where(({ t }) => and(eq(t.userId, userId), eq(t.completed, false)))
        .orderBy(({ t }) => t.createdAt, 'desc'),
    [userId]
  )

  if (isLoading) return <div>Loading...</div>
  if (isError) return <div>Error loading todos</div>

  return (
    <ul>
      {data.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  )
}
```

Return shape:
- `data` — query results array (empty array while loading)
- `state` — Map of key → item for direct lookups
- `collection` — the derived collection instance (or null)
- `status` — `'idle'` | `'loading'` | `'ready'` | `'error'` | `'cleaned-up'` | `'disabled'`
- `isLoading`, `isReady`, `isError`, `isIdle`, `isCleanedUp`, `isEnabled` — boolean helpers

### useLiveSuspenseQuery

Same API but throws a Promise during loading (for React Suspense) and
throws errors (for Error Boundaries). `data` is always defined:

```typescript
import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'

function TodoList() {
  const { data } = useLiveSuspenseQuery((q) =>
    q
      .from({ t: todosCollection })
      .where(({ t }) => eq(t.completed, false))
  )

  return (
    <ul>
      {data.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  )
}

function App() {
  return (
    <ErrorBoundary fallback={<div>Failed to load</div>}>
      <Suspense fallback={<div>Loading...</div>}>
        <TodoList />
      </Suspense>
    </ErrorBoundary>
  )
}
```

### useLiveInfiniteQuery

Cursor-based pagination with live updates:

```typescript
import { useLiveInfiniteQuery } from '@tanstack/react-db'

function PostFeed() {
  const { data, pages, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useLiveInfiniteQuery(
      (q) =>
        q
          .from({ p: postsCollection })
          .orderBy(({ p }) => p.createdAt, 'desc'),
      {
        pageSize: 20,
        getNextPageParam: (lastPage, allPages, lastPageParam) =>
          lastPage.length === 20 ? (lastPageParam ?? 0) + 1 : undefined,
      },
      [category]
    )

  return (
    <div>
      {data.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
      {hasNextPage && (
        <button onClick={fetchNextPage} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  )
}
```

### usePacedMutations

React hook wrapper for `createPacedMutations`:

```typescript
import { usePacedMutations } from '@tanstack/react-db'
import { debounceStrategy } from '@tanstack/db'

function EditableTitle({ todoId }: { todoId: string }) {
  const updateTitle = usePacedMutations({
    onMutate: ({ id, title }: { id: string; title: string }) => {
      todosCollection.update(id, (draft) => {
        draft.title = title
      })
    },
    mutationFn: async ({ id, title }) => {
      await fetch(`/api/todos/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      })
    },
    strategy: debounceStrategy({ wait: 500 }),
  })

  return (
    <input
      defaultValue={todo.title}
      onChange={(e) => updateTitle({ id: todoId, title: e.target.value })}
    />
  )
}
```

## React-Specific Patterns

### Dependency arrays for reactive parameters

When a query uses values from props, state, or context, include them in
the dependency array. The query re-runs when any dep changes:

```typescript
function FilteredTodos({ status, priority }: Props) {
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ t: todosCollection })
        .where(({ t }) =>
          and(eq(t.status, status), gte(t.priority, priority))
        ),
    [status, priority]
  )
  // ...
}
```

### Disabling queries conditionally

Return `undefined` from the query function to disable the query:

```typescript
function TodoDetail({ todoId }: { todoId: string | null }) {
  const { data, isEnabled } = useLiveQuery(
    (q) =>
      todoId
        ? q.from({ t: todosCollection }).where(({ t }) => eq(t.id, todoId)).findOne()
        : undefined,
    [todoId]
  )
  // isEnabled is false when todoId is null
}
```

### Mutations from event handlers

Mutations are called directly on collections — no hooks needed:

```typescript
function TodoItem({ todo }: { todo: Todo }) {
  const handleToggle = () => {
    todosCollection.update(todo.id, (draft) => {
      draft.completed = !draft.completed
    })
  }

  const handleDelete = () => {
    todosCollection.delete(todo.id)
  }

  return (
    <li>
      <input type="checkbox" checked={todo.completed} onChange={handleToggle} />
      <span>{todo.text}</span>
      <button onClick={handleDelete}>Delete</button>
    </li>
  )
}
```

## Common Mistakes

### CRITICAL — Missing external values in useLiveQuery dependency array

Wrong:
```typescript
function FilteredTodos({ status }: { status: string }) {
  const { data } = useLiveQuery((q) =>
    q.from({ t: todosCollection })
      .where(({ t }) => eq(t.status, status))
  )
  // Query never re-runs when status prop changes
}
```

Correct:
```typescript
function FilteredTodos({ status }: { status: string }) {
  const { data } = useLiveQuery(
    (q) =>
      q.from({ t: todosCollection })
        .where(({ t }) => eq(t.status, status)),
    [status]
  )
}
```

When the query references external values (props, state, context), they
must be in the dependency array. Without them, the query captures the
initial value and never updates — showing stale results.

Source: docs/framework/react/overview.md

### HIGH — useLiveSuspenseQuery without Error Boundary

Wrong:
```typescript
function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TodoList />  {/* Uses useLiveSuspenseQuery */}
    </Suspense>
  )
  // Sync error crashes the entire app
}
```

Correct:
```typescript
function App() {
  return (
    <ErrorBoundary fallback={<div>Failed to load</div>}>
      <Suspense fallback={<div>Loading...</div>}>
        <TodoList />
      </Suspense>
    </ErrorBoundary>
  )
}
```

`useLiveSuspenseQuery` throws errors during rendering. Without an Error
Boundary, the error propagates up and crashes the app. Always wrap
Suspense queries with an Error Boundary.

Source: docs/guides/live-queries.md — React Suspense section
