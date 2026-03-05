---
name: react-db
description: >
  React bindings for TanStack DB. useLiveQuery hook with dependency arrays
  (8 overloads: query function, config object, pre-created collection,
  disabled state via returning undefined/null). useLiveSuspenseQuery for
  React Suspense with Error Boundaries (data always defined).
  useLiveInfiniteQuery for cursor-based pagination (pageSize, fetchNextPage,
  hasNextPage, isFetchingNextPage). usePacedMutations for debounced React
  state updates. Return shape: data, state, collection, status, isLoading,
  isReady, isError. Import from @tanstack/react-db (re-exports all of
  @tanstack/db).
type: framework
library: db
framework: react
library_version: "0.5.30"
requires:
  - db-core
sources:
  - "TanStack/db:docs/framework/react/overview.md"
  - "TanStack/db:docs/guides/live-queries.md"
  - "TanStack/db:packages/react-db/src/useLiveQuery.ts"
  - "TanStack/db:packages/react-db/src/useLiveInfiniteQuery.ts"
---

This skill builds on db-core. Read it first for collection setup, query builder, and mutation patterns.

# TanStack DB — React

## Setup

```tsx
import { useLiveQuery, eq, not } from "@tanstack/react-db"

function TodoList() {
  const { data: todos, isLoading } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => not(todo.completed))
      .orderBy(({ todo }) => todo.created_at, "asc")
  )

  if (isLoading) return <div>Loading...</div>

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  )
}
```

`@tanstack/react-db` re-exports everything from `@tanstack/db`. In React projects, import everything from `@tanstack/react-db`.

## Hooks

### useLiveQuery

```tsx
// Query function with dependency array
const { data, state, collection, status, isLoading, isReady, isError } =
  useLiveQuery(
    (q) =>
      q
        .from({ todo: todoCollection })
        .where(({ todo }) => eq(todo.userId, userId)),
    [userId]
  )

// Config object
const { data } = useLiveQuery({
  query: (q) => q.from({ todo: todoCollection }),
  gcTime: 60000,
})

// Pre-created collection (from route loader)
const { data } = useLiveQuery(preloadedCollection)

// Conditional query — return undefined/null to disable
const { data, status } = useLiveQuery(
  (q) => {
    if (!userId) return undefined
    return q.from({ todo: todoCollection }).where(({ todo }) => eq(todo.userId, userId))
  },
  [userId]
)
// When disabled: status='disabled', data=undefined
```

### useLiveSuspenseQuery

```tsx
// data is ALWAYS defined — never undefined
// Must wrap in <Suspense> and <ErrorBoundary>
function TodoList() {
  const { data: todos } = useLiveSuspenseQuery((q) =>
    q.from({ todo: todoCollection })
  )

  return <ul>{todos.map((t) => <li key={t.id}>{t.text}</li>)}</ul>
}

// With deps — re-suspends when deps change
const { data } = useLiveSuspenseQuery(
  (q) => q.from({ todo: todoCollection }).where(({ todo }) => eq(todo.category, category)),
  [category]
)
```

### useLiveInfiniteQuery

```tsx
const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useLiveInfiniteQuery(
    (q) =>
      q
        .from({ posts: postsCollection })
        .orderBy(({ posts }) => posts.createdAt, "desc"),
    { pageSize: 20 },
    [category]
  )

// data is the flat array of all loaded pages
// fetchNextPage() loads the next page
// hasNextPage is true when more data is available
```

### usePacedMutations

```tsx
import { usePacedMutations, debounceStrategy } from "@tanstack/react-db"

const mutate = usePacedMutations({
  onMutate: (value: string) => {
    noteCollection.update(noteId, (draft) => {
      draft.content = value
    })
  },
  mutationFn: async ({ transaction }) => {
    await api.notes.update(noteId, transaction.mutations[0].changes)
  },
  strategy: debounceStrategy({ wait: 500 }),
})

// In handler:
<textarea onChange={(e) => mutate(e.target.value)} />
```

## React-Specific Patterns

### Dependency arrays

```tsx
// Include ALL external reactive values
const { data } = useLiveQuery(
  (q) =>
    q.from({ todo: todoCollection }).where(({ todo }) =>
      and(eq(todo.userId, userId), eq(todo.status, filter))
    ),
  [userId, filter]
)

// Empty array = static query, never re-runs
const { data } = useLiveQuery(
  (q) => q.from({ todo: todoCollection }),
  []
)

// No array = re-runs on every render (usually wrong)
```

### Suspense + Error Boundary

```tsx
<ErrorBoundary fallback={<div>Error</div>}>
  <Suspense fallback={<div>Loading...</div>}>
    <TodoList />
  </Suspense>
</ErrorBoundary>
```

### Router loader preloading

```tsx
// In route loader:
await todoCollection.preload()

// In component — data available immediately:
const { data } = useLiveQuery((q) => q.from({ todo: todoCollection }))
```

See meta-framework/SKILL.md for full preloading patterns.

## Common Mistakes

### CRITICAL Missing external values in dependency array

Wrong:

```tsx
const { data } = useLiveQuery((q) =>
  q.from({ todo: todoCollection }).where(({ todo }) => eq(todo.userId, userId))
)
```

Correct:

```tsx
const { data } = useLiveQuery(
  (q) => q.from({ todo: todoCollection }).where(({ todo }) => eq(todo.userId, userId)),
  [userId]
)
```

When the query uses external state not in the deps array, the query won't re-run when that value changes, showing stale results.

Source: docs/framework/react/overview.md

### HIGH useLiveSuspenseQuery without Error Boundary

Wrong:

```tsx
<Suspense fallback={<div>Loading...</div>}>
  <TodoList /> {/* uses useLiveSuspenseQuery */}
</Suspense>
```

Correct:

```tsx
<ErrorBoundary fallback={<div>Error</div>}>
  <Suspense fallback={<div>Loading...</div>}>
    <TodoList />
  </Suspense>
</ErrorBoundary>
```

`useLiveSuspenseQuery` throws errors during rendering. Without an Error Boundary, the entire app crashes.

Source: docs/guides/live-queries.md

### HIGH Tension: Query expressiveness vs. IVM constraints

The query builder looks like SQL but has constraints that SQL doesn't — equality joins only, orderBy required for limit/offset, no distinct without select. Agents write SQL-style queries that violate these constraints. See db-core/live-queries/SKILL.md § Common Mistakes for all constraints.

See also: db-core/live-queries/SKILL.md — for query builder API and all operators.

See also: db-core/mutations-optimistic/SKILL.md — for mutation patterns.

See also: meta-framework/SKILL.md — for preloading in route loaders.
