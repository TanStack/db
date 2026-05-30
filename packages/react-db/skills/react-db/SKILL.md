---
name: react-db
description: >
  React bindings for TanStack DB. Prefer useLiveQuery({ query }) with
  derived structured query identity. Provide queryKey only for opaque
  functional query variants or very hot render paths. Dependency arrays are
  legacy and warn before 1.0 removal. useLiveSuspenseQuery for
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
import { eq, not, useLiveQuery } from '@tanstack/react-db'

function TodoList() {
  const { data: todos, isLoading } = useLiveQuery({
    query: (q) =>
      q
        .from({ todo: todoCollection })
        .where(({ todo }) => not(todo.completed))
        .orderBy(({ todo }) => todo.created_at, 'asc'),
  })

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
// Preferred config object with derived query identity
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
} = useLiveQuery({
  query: (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.userId, userId)),
})

// Static query
const { data } = useLiveQuery({
  query: (q) => q.from({ todo: todoCollection }),
  gcTime: 60000,
})

// Pre-created collection (from route loader)
const { data } = useLiveQuery(preloadedCollection)

// Conditional query — derived identity handles enabled/disabled transitions
const { data, status } = useLiveQuery((q) => {
  if (!userId) return undefined
  return q
    .from({ todo: todoCollection })
    .where(({ todo }) => eq(todo.userId, userId))
})
// When disabled: status='disabled', data=undefined
```

### useLiveSuspenseQuery

```tsx
// data is ALWAYS defined — never undefined
// Must wrap in <Suspense> and <ErrorBoundary>
function TodoList() {
  const { data: todos } = useLiveSuspenseQuery({
    query: (q) => q.from({ todo: todoCollection }),
  })

  return (
    <ul>
      {todos.map((t) => (
        <li key={t.id}>{t.text}</li>
      ))}
    </ul>
  )
}

// Structured captured values are part of the derived identity and re-suspend when changed
const { data } = useLiveSuspenseQuery({
  query: (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.category, category)),
})
```

### useLiveInfiniteQuery

```tsx
const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useLiveInfiniteQuery(
    (q) =>
      q
        .from({ posts: postsCollection })
        .where(({ posts }) => eq(posts.category, category))
        .orderBy(({ posts }) => posts.createdAt, 'desc'),
    {
      pageSize: 20,
    },
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
  const { data: projects } = useLiveQuery({
    query: (q) =>
      q.from({ p: projectsCollection }).select(({ p }) => ({
        id: p.id,
        name: p.name,
        issues: q
          .from({ i: issuesCollection })
          .where(({ i }) => eq(i.projectId, p.id))
          .select(({ i }) => ({ id: i.id, title: i.title })),
      })),
  })

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

const { data: projects } = useLiveQuery({
  query: (q) =>
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
})
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
const { data } = useLiveQuery({
  query: (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.$synced, false)),
})
// Shows only optimistic (unconfirmed) todos
```

## React-Specific Patterns

### Query identity

```tsx
// Structured captured values are included in the derived identity
const { data } = useLiveQuery({
  query: (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) =>
        and(eq(todo.userId, userId), eq(todo.status, filter)),
      ),
})

// Static query
const { data } = useLiveQuery({
  query: (q) => q.from({ todo: todoCollection }),
})
```

Use `queryKey` only when DB cannot derive identity from structured IR, such as
`.fn.where`, `.fn.select`, `.fn.having`, or as a deliberate performance escape
hatch on a hot render path:

```tsx
const { data } = useLiveQuery({
  queryKey: [todoCollection.id, 'search', search],
  query: (q) =>
    q.from({ todo: todoCollection }).fn.where(({ todo }) => {
      return fuzzyMatch(todo.title, search)
    }),
})
```

In development, opaque IR throws and tells the user to add `queryKey`. Slow or
repeated derived identity work warns once and points to the same escape hatch.

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
const { data } = useLiveQuery({
  query: (q) => q.from({ todo: todoCollection }),
})
```

See meta-framework/SKILL.md for full preloading patterns.

## Common Mistakes

### CRITICAL Using opaque query logic without queryKey

Wrong:

```tsx
const { data } = useLiveQuery({
  query: (q) =>
    q.from({ todo: todoCollection }).fn.where(({ todo }) => {
      return fuzzyMatch(todo.title, search)
    }),
})
```

Correct:

```tsx
const { data } = useLiveQuery({
  queryKey: [todoCollection.id, 'search', search],
  query: (q) =>
    q.from({ todo: todoCollection }).fn.where(({ todo }) => {
      return fuzzyMatch(todo.title, search)
    }),
})
```

Structured expressions are hashable by default. Functional query variants are
opaque runtime code, so they need an explicit key to say when identity changes.

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
