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
library_version: '0.6.0'
requires:
  - db-core
sources:
  - 'TanStack/db:docs/framework/react/overview.md'
  - 'TanStack/db:docs/guides/live-queries.md'
  - 'TanStack/db:packages/react-db/src/useLiveQuery.ts'
  - 'TanStack/db:packages/react-db/src/useLiveInfiniteQuery.ts'
---

This skill builds on db-core. Read it first for collection setup, query builder, and mutation patterns.

# TanStack DB — React

## Setup

```tsx
import { useLiveQuery, eq, not } from '@tanstack/react-db'

function TodoList() {
  const { data: todos, isLoading } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => not(todo.completed))
      .orderBy(({ todo }) => todo.created_at, 'asc'),
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
const {
  data,
  state,
  collection,
  status,
  isLoading,
  isReady,
  isError,
  isIdle,
  isCleanedUp,
} = useLiveQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.userId, userId)),
  [userId],
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
    return q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.userId, userId))
  },
  [userId],
)
// When disabled: status='disabled', data=undefined
```

### useLiveSuspenseQuery

```tsx
// data is ALWAYS defined — never undefined
// Must wrap in <Suspense> and <ErrorBoundary>
function TodoList() {
  const { data: todos } = useLiveSuspenseQuery((q) =>
    q.from({ todo: todoCollection }),
  )

  return (
    <ul>
      {todos.map((t) => (
        <li key={t.id}>{t.text}</li>
      ))}
    </ul>
  )
}

// With deps — re-suspends when deps change
const { data } = useLiveSuspenseQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.category, category)),
  [category],
)
```

### useLiveInfiniteQuery

```tsx
const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useLiveInfiniteQuery(
    (q) =>
      q
        .from({ posts: postsCollection })
        .orderBy(({ posts }) => posts.createdAt, 'desc'),
    { pageSize: 20 },
    [category],
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

## Includes (Hierarchical Data)

When a query uses includes (subqueries in `select`), each child field is a live `Collection` by default. Subscribe to it with `useLiveQuery` in a subcomponent:

```tsx
function ProjectList() {
  const { data: projects } = useLiveQuery((q) =>
    q.from({ p: projectsCollection }).select(({ p }) => ({
      id: p.id,
      name: p.name,
      issues: q
        .from({ i: issuesCollection })
        .where(({ i }) => eq(i.projectId, p.id))
        .select(({ i }) => ({ id: i.id, title: i.title })),
    })),
  )

  return (
    <ul>
      {projects.map((project) => (
        <li key={project.id}>
          {project.name}
          <IssueList issuesCollection={project.issues} />
        </li>
      ))}
    </ul>
  )
}

// Child component subscribes to the child Collection
function IssueList({ issuesCollection }) {
  const { data: issues } = useLiveQuery(issuesCollection)
  return (
    <ul>
      {issues.map((issue) => (
        <li key={issue.id}>{issue.title}</li>
      ))}
    </ul>
  )
}
```

Only the affected `IssueList` re-renders when an issue changes — the parent does not.

With `toArray()`, child results are plain arrays and the parent re-renders on child changes:

```tsx
import { toArray, eq } from '@tanstack/react-db'

const { data: projects } = useLiveQuery((q) =>
  q.from({ p: projectsCollection }).select(({ p }) => ({
    id: p.id,
    name: p.name,
    issues: toArray(
      q
        .from({ i: issuesCollection })
        .where(({ i }) => eq(i.projectId, p.id))
        .select(({ i }) => ({ id: i.id, title: i.title })),
    ),
  })),
)
// project.issues is string[] — no subcomponent needed
```

See db-core/live-queries/SKILL.md for full includes rules (correlation conditions, nested includes, aggregates).

## Virtual Properties

Live query results include computed, read-only virtual properties on every row:

- `$synced`: `true` when the row is confirmed by sync; `false` when it is still optimistic.
- `$origin`: `"local"` if the last confirmed change came from this client, otherwise `"remote"`.
- `$key`: the row key for the result.
- `$collectionId`: the source collection ID.

These props are added automatically and can be used in `where`, `select`, and `orderBy` clauses. Do not persist them back to storage.

```tsx
const { data } = useLiveQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.$synced, false)),
  [],
)
// Shows only optimistic (unconfirmed) todos
```

## React-Specific Patterns

### Dependency arrays

```tsx
// Include ALL external reactive values
const { data } = useLiveQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) =>
        and(eq(todo.userId, userId), eq(todo.status, filter)),
      ),
  [userId, filter],
)

// Empty array = static query, never re-runs
const { data } = useLiveQuery((q) => q.from({ todo: todoCollection }), [])

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

### CRITICAL Using === instead of eq() in .where()

Wrong — throws `InvalidWhereExpressionError` at runtime:

```tsx
const { data } = useLiveQuery((q) =>
  q.from({ todo: todoCollection }).where(({ todo }) => todo.completed === true),
  [],
)
```

Correct — use expression functions from `@tanstack/react-db`:

```tsx
import { useLiveQuery, eq } from '@tanstack/react-db'

const { data } = useLiveQuery((q) =>
  q.from({ todo: todoCollection }).where(({ todo }) => eq(todo.completed, true)),
  [],
)
```

JavaScript `===`, `!==`, `<`, `>` return a boolean, not a query expression. Always use `eq`, `gt`, `gte`, `lt`, `lte`, `and`, `or`, `not`, `like`, `ilike`, `isNull`, `isUndefined`, `inArray`. See db-core/live-queries/SKILL.md for the full operator reference.

### CRITICAL Assigning useLiveQuery result directly instead of destructuring

Wrong — crashes with "map is not a function":

```tsx
const todos = useLiveQuery((q) => q.from({ todo: todoCollection }), [])
return todos.map(t => <li>{t.text}</li>)  // TypeError: todos.map is not a function
```

Correct — destructure `{ data }` with a default:

```tsx
const { data: todos = [] } = useLiveQuery((q) => q.from({ todo: todoCollection }), [])
return todos.map(t => <li key={t.id}>{t.text}</li>)
```

`useLiveQuery` returns an object `{ data, isLoading, status, ... }`, not the array directly.

### CRITICAL Missing external values in dependency array

Wrong:

```tsx
const { data } = useLiveQuery((q) =>
  q.from({ todo: todoCollection }).where(({ todo }) => eq(todo.userId, userId)),
)
```

Correct:

```tsx
const { data } = useLiveQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.userId, userId)),
  [userId],
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

### HIGH "Not a Collection" error from duplicate @tanstack/db

If `useLiveQuery` throws `InvalidSourceError: The value provided for alias "todo" is not a Collection`, it usually means two copies of `@tanstack/db` are installed. The collection was created by one copy, but `useLiveQuery` checks `instanceof` against the other.

In dev mode, TanStack DB also throws `DuplicateDbInstanceError` if two instances are detected.

**Diagnose:**

```bash
pnpm ls @tanstack/db
```

If multiple versions appear, fix with one of:

**pnpm overrides** (in root package.json):

```json
{
  "pnpm": {
    "overrides": {
      "@tanstack/db": "^0.6.0"
    }
  }
}
```

**Vite resolve.alias** (in vite.config.ts):

```ts
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@tanstack/db': path.resolve('./node_modules/@tanstack/db'),
    },
  },
})
```

The root cause is typically a dependency that bundles its own copy instead of declaring `@tanstack/db` as a `peerDependency`.

### HIGH Tension: Query expressiveness vs. IVM constraints

The query builder looks like SQL but has constraints that SQL doesn't — equality joins only, orderBy required for limit/offset, no distinct without select. Agents write SQL-style queries that violate these constraints. See db-core/live-queries/SKILL.md § Common Mistakes for all constraints.

See also: db-core/live-queries/SKILL.md — for query builder API and all operators.

See also: db-core/mutations-optimistic/SKILL.md — for mutation patterns.

See also: meta-framework/SKILL.md — for preloading in route loaders.
