---
name: solid-db
description: >
  SolidJS v2 bindings for TanStack DB. useLiveQuery returns an Accessor that
  doubles as data access (call as function — returns current rows
  synchronously, including partial rows synced before ready) with state,
  collection, status, and status-flag properties. query.loaded() is the
  opt-in first-data gate: read it inside <Loading> and it returns the rows
  once the first load settles. Fine-grained reactivity: signal reads MUST
  happen inside the query function for tracking, and rows are read where they
  are used (JSX, a memo), never once in the component body. Config passed as
  Accessor (() => config). Import from @tanstack/solid-db (re-exports all of
  @tanstack/db).
type: framework
library: db
framework: solid
library_version: '1.0.0-rc.1.5'
requires:
  - db-core
sources:
  - 'TanStack/db:docs/framework/solid/overview.md'
  - 'TanStack/db:packages/solid-db/src/useLiveQuery.ts'
---

This skill builds on db-core. Read it first for collection setup, query builder, and mutation patterns.

# TanStack DB — SolidJS v2

## Setup

```tsx
import { useLiveQuery, not } from '@tanstack/solid-db'
import { For } from 'solid-js'
import { Loading } from '@solidjs/web'

function TodoList() {
  const todosQuery = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => not(todo.completed))
      .orderBy(({ todo }) => todo.created_at, 'asc'),
  )

  return (
    <Loading fallback={<div>Loading...</div>}>
      <ul>
        <For each={todosQuery.loaded()}>{(todo) => <li>{todo.text}</li>}</For>
      </ul>
    </Loading>
  )
}
```

`@tanstack/solid-db` re-exports everything from `@tanstack/db`.

## Hook

### useLiveQuery

Returns an `Accessor<Array<T>>` (or `Accessor<T | undefined>` with `findOne`) with additional properties. Call it as a function to get data:

```tsx
import { useLiveQuery, eq, gt } from '@tanstack/solid-db'
import { createSignal } from 'solid-js'

// Query function — call result as function for data
const query = useLiveQuery((q) => q.from({ todo: todoCollection }))
// query()          → Array<T> (current rows, never suspends) — or T | undefined when using findOne()
// query.state      → ReactiveMap<TKey, T>
// query.collection → Collection (null while the query is disabled)
// query.status     → CollectionStatus | 'disabled'
// query.isReady / query.isLoading / query.isIdle     → boolean
// query.isLoadingError / query.isCrashed / query.isCleanedUp / query.isSyncError → boolean
// query.health     → HealthNode | undefined
// query.loaded  → Accessor; read inside <Loading> — gates on first data, then returns the rows

// With reactive signals — signals MUST be read INSIDE the query function
const [minPriority, setMinPriority] = createSignal(5)
const byPriority = useLiveQuery((q) =>
  q
    .from({ todo: todoCollection })
    .where(({ todo }) => gt(todo.priority, minPriority())),
)

// Config object — pass as Accessor
const configured = useLiveQuery(() => ({
  query: (q) => q.from({ todo: todoCollection }),
  gcTime: 60000,
}))

// Pre-created collection — pass as Accessor
const precreated = useLiveQuery(() => preloadedCollection)

// Conditional query — returning null or undefined disables it. The signal
// is read INSIDE the query function, so the query follows it.
const conditional = useLiveQuery((q) => {
  const id = userId()
  if (!id) return undefined
  return q
    .from({ todo: todoCollection })
    .where(({ todo }) => eq(todo.userId, id))
})
```

Each status flag is its own reactive value: a component that reads `query.isReady` does not re-run when a row changes.

Query-function form note: identical eq-filtered queries share one pooled live-query Collection and subscription, so two hooks rendering the same filter hit the source once. A hook-created Collection is retired 1 ms after its last subscriber leaves; pass a config object with `gcTime` or a pre-created collection to keep it longer.

## Solid-Specific Patterns

### Signal reads inside query function

```tsx
import { useLiveQuery, eq } from '@tanstack/solid-db'
import { createSignal } from 'solid-js'

// CORRECT — signal read tracked inside query function
const [category, setCategory] = createSignal('work')
const query = useLiveQuery((q) =>
  q
    .from({ todo: todoCollection })
    .where(({ todo }) => eq(todo.category, category())),
)
// Query re-runs when category() changes

// WRONG — signal read outside, not tracked
const cat = category() // read here loses tracking
const stale = useLiveQuery((q) =>
  q.from({ todo: todoCollection }).where(({ todo }) => eq(todo.category, cat)),
)
```

### Read rows where they are used

The rows are reactive, like any prop in Solid 2. Read them in JSX, a memo, an effect, or an event handler:

```tsx
import { useLiveQuery } from '@tanstack/solid-db'
import { createMemo, For } from 'solid-js'

function TodoList() {
  const todosQuery = useLiveQuery((q) => q.from({ todo: todoCollection }))

  // CORRECT: a memo follows the rows
  const remaining = createMemo(
    () => todosQuery().filter((todo) => !todo.completed).length,
  )

  return (
    <div>
      <For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
      {remaining()} left
    </div>
  )
}
```

### findOne (single result)

When the query uses `.findOne()`, `useLiveQuery` returns a single object (or `undefined`) instead of an array:

```tsx
import { useLiveQuery, eq } from '@tanstack/solid-db'
import { Show } from 'solid-js'

function UserName() {
  const userQuery = useLiveQuery((q) =>
    q
      .from({ user: usersCollection })
      .where(({ user }) => eq(user.id, userId()))
      .findOne(),
  )

  // userQuery() → T | undefined (not Array<T>)
  return <Show when={userQuery()}>{(user) => <div>{user().name}</div>}</Show>
}
```

### Loading boundary integration

```tsx
import { useLiveQuery } from '@tanstack/solid-db'
import { For } from 'solid-js'
import { Loading, Errored } from '@solidjs/web'

function TodoList() {
  const todosQuery = useLiveQuery((q) => q.from({ todo: todoCollection }))

  return (
    <Errored fallback={(err) => <div>Error: {String(err())}</div>}>
      <Loading fallback={<div>Loading...</div>}>
        <For each={todosQuery.loaded()}>{(todo) => <li>{todo.text}</li>}</For>
      </Loading>
    </Errored>
  )
}
```

Data reads never suspend — `query()` returns the current rows at any time, including partial rows synced while loading. Reading the accessor throws only when the query cannot serve data: its first load failed, or its collection crashed. The first-data gate is opt-in: `query.loaded()` participates in <Loading> (throwing `NotReadyError` for `<Loading>` to catch) and then returns the rows exactly like `query()` — feed it straight into `<For each={...}>`. It settles when the query's first load has settled.

Without boundaries, branch on the status flags instead: `query.isLoading`, `query.isLoadingError || query.isCrashed`, `query.isReady`.

### Revalidation progress with isPending

```tsx
import { useLiveQuery } from '@tanstack/solid-db'
import { For, isPending } from 'solid-js'
import { Loading } from '@solidjs/web'

function TodoList() {
  const todosQuery = useLiveQuery((q) => q.from({ todo: todoCollection }))

  return (
    <Loading fallback={<div>Loading...</div>}>
      {/* True while a changed input's new collection is loading */}
      {isPending(() => todosQuery.loaded()) && <Spinner />}
      <For each={todosQuery.loaded()}>{(todo) => <li>{todo.text}</li>}</For>
    </Loading>
  )
}
```

Rendered content stays visible during revalidation (v2 `<Loading>` holds), so no fallback flash. Solid 2 also holds the rest of that update until the wait ends: while `query.loaded()` waits on the new collection, `query()` in the same component keeps returning the rows from before the change. Outside such a boundary nothing is held, and `query()` shows the new collection's rows as they sync.

## Includes (Hierarchical Data)

When a query uses includes (subqueries in `select`), each child field is a live `Collection` by default. Subscribe to it with `useLiveQuery` in a subcomponent:

```tsx
import { useLiveQuery, eq, include } from '@tanstack/solid-db'
import { For } from 'solid-js'
import type { Collection } from '@tanstack/solid-db'

function ProjectList() {
  const projectsQuery = useLiveQuery((q) =>
    q.from({ p: projectsCollection }).select(({ p }) => ({
      id: p.id,
      name: p.name,
      issues: include(
        q
          .from({ i: issuesCollection })
          .where(({ i }) => eq(i.projectId, p.id))
          .select(({ i }) => ({ id: i.id, title: i.title })),
      ),
    })),
  )

  return (
    <For each={projectsQuery()}>
      {(project) => (
        <div>
          {project.name}
          <IssueList issuesCollection={project.issues} />
        </div>
      )}
    </For>
  )
}

// Child component subscribes to the child Collection
function IssueList(props: { issuesCollection: Collection }) {
  const issuesQuery = useLiveQuery(() => props.issuesCollection)
  return <For each={issuesQuery()}>{(issue) => <div>{issue.title}</div>}</For>
}
```

Note: wrap the child Collection in an Accessor (`() => props.issuesCollection`) to match the overload signature. A bare subquery in `select` throws `IncludeOperatorRequiredError`.

With `toArray()`, child results are plain arrays and the parent re-emits on child changes:

```tsx
import { useLiveQuery, toArray, eq } from '@tanstack/solid-db'

const projectsQuery = useLiveQuery((q) =>
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
// project.issues is a plain array — no subcomponent needed
```

See db-core/live-queries/SKILL.md for full includes rules (correlation conditions, nested includes, aggregates).

## Common Mistakes

### HIGH Reading rows or props in the component body

Wrong:

```tsx
import { useLiveQuery } from '@tanstack/solid-db'

function TodoList() {
  const todosQuery = useLiveQuery((q) => q.from({ todo: todoCollection }))

  // Computed once: the count never changes, and the read is untracked
  const count = todosQuery().length

  return <div>{count} todos</div>
}
```

Correct:

```tsx
import { useLiveQuery } from '@tanstack/solid-db'
import { createMemo } from 'solid-js'

function TodoList() {
  const todosQuery = useLiveQuery((q) => q.from({ todo: todoCollection }))
  const count = createMemo(() => todosQuery().length)

  return <div>{count()} todos</div>
}
```

A component body runs once. A read there captures one value, and Solid 2 reports it with `STRICT_READ_UNTRACKED`. The same applies to a component that receives rows as a prop: read `props.todos` in JSX or a memo. If the rows come from `query.loaded()`, the body read also meets a pending value and the component renders nothing (`PENDING_ASYNC_UNTRACKED_READ`).

Source: docs/framework/solid/overview.md

### HIGH Reading signals outside the query function

Wrong:

```tsx
import { useLiveQuery, eq } from '@tanstack/solid-db'
import { createSignal } from 'solid-js'

const [userId] = createSignal(1)
const id = userId()
const query = useLiveQuery((q) =>
  q.from({ todo: todoCollection }).where(({ todo }) => eq(todo.userId, id)),
)
```

Correct:

```tsx
import { useLiveQuery, eq } from '@tanstack/solid-db'
import { createSignal } from 'solid-js'

const [userId] = createSignal(1)
const query = useLiveQuery((q) =>
  q
    .from({ todo: todoCollection })
    .where(({ todo }) => eq(todo.userId, userId())),
)
```

Solid's reactivity tracks signal reads inside reactive contexts. Reading outside the query function captures the value at creation time — changes won't trigger re-execution.

Source: docs/framework/solid/overview.md

### MEDIUM Using the v1 accessor shape

Wrong:

```tsx
import { useLiveQuery } from '@tanstack/solid-db'
import { For, Suspense } from 'solid-js'

function TodoList() {
  const todosQuery = useLiveQuery((q) => q.from({ todo: todoCollection }))

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <For each={todosQuery.data}>{(todo) => <li>{todo.text}</li>}</For>
    </Suspense>
  )
}
```

Correct:

```tsx
import { useLiveQuery } from '@tanstack/solid-db'
import { For } from 'solid-js'
import { Loading } from '@solidjs/web'

function TodoList() {
  const todosQuery = useLiveQuery((q) => q.from({ todo: todoCollection }))

  return (
    <Loading fallback={<div>Loading...</div>}>
      <For each={todosQuery.loaded()}>{(todo) => <li>{todo.text}</li>}</For>
    </Loading>
  )
}
```

From the v1 adapter: `query.data` is gone — call the accessor. `Suspense` and `ErrorBoundary` are `Loading` and `Errored`. Calling the accessor no longer suspends, so wrapping it in a boundary shows no fallback; read `query.loaded()` under the boundary to gate on first data. The status flags (`isLoading`, `isReady`, `isIdle`, `isLoadingError`, `isCrashed`, `isCleanedUp`, `isSyncError`, `health`) are unchanged.

See also: db-core/live-queries/SKILL.md — for query builder API.

See also: db-core/mutations-optimistic/SKILL.md — for mutation patterns.
