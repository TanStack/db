---
name: solid-db
description: >
  SolidJS v2 bindings for TanStack DB. useLiveQuery returns an Accessor that
  doubles as data access (call as function — returns current rows
  synchronously, including partial rows synced before ready) with state,
  collection, status, isReady, and persisted-readiness properties. Suspense
  is opt-in via the whenReady accessor read inside <Loading>. Fine-grained
  reactivity: signal reads MUST happen inside the query function for
  tracking. Config passed as Accessor (() => config). Wholesale observer
  mode + keyed projection for per-field row reactivity keyed by live result
  identity. Import from @tanstack/solid-db (re-exports all of @tanstack/db).
type: framework
library: db
framework: solid
library_version: '0.3.0'
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
import { useLiveQuery, eq, gt, not } from '@tanstack/solid-db'
import { For, Show } from 'solid-js'
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
        <For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
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
// Query function — call result as function for data
const query = useLiveQuery((q) => q.from({ todo: todoCollection }))
// query()          → Array<T> (current rows, never suspends) — or T | undefined when using findOne()
// query.state      → ReactiveMap<TKey, T>
// query.collection → Collection
// query.status     → CollectionStatus | 'disabled'
// query.isReady / query.isError → boolean
// query.persistedStatus / query.isPersistedReady / query.persistedError
//                  → persisted (network-first) restore state
// query.whenReady  → Accessor; reading it inside <Loading> gates on first data

// With reactive signals — signals MUST be read INSIDE the query function
const [minPriority, setMinPriority] = createSignal(5)
const query = useLiveQuery((q) =>
  q
    .from({ todo: todoCollection })
    .where(({ todo }) => gt(todo.priority, minPriority())),
)

// Config object — pass as Accessor
const query = useLiveQuery(() => ({
  query: (q) => q.from({ todo: todoCollection }),
  gcTime: 60000,
}))

// Pre-created collection — pass as Accessor
const query = useLiveQuery(() => preloadedCollection)

// Conditional query
const query = useLiveQuery((q) => {
  const id = userId()
  if (!id) return undefined
  return q
    .from({ todo: todoCollection })
    .where(({ todo }) => eq(todo.userId, id))
})
```

## Solid-Specific Patterns

### Signal reads inside query function

```tsx
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
const query = useLiveQuery((q) =>
  q.from({ todo: todoCollection }).where(({ todo }) => eq(todo.category, cat)),
)
```

### findOne (single result)

When the query uses `.findOne()`, `useLiveQuery` returns a single object (or `undefined`) instead of an array:

```tsx
const userQuery = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.id, userId()))
    .findOne(),
)

// userQuery() → T | undefined (not Array<T>)
return <Show when={userQuery()}>{(user) => <div>{user().name}</div>}</Show>
```

### Loading boundary integration

```tsx
import { Loading, Errored } from '@solidjs/web'

<Errored fallback={(err) => <div>Error: {String(err())}</div>}>
  <Loading fallback={<div>Loading...</div>}>
    <For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
  </Loading>
</Errored>
```

Data reads never suspend — `query()` returns the current rows at any time, including partial rows synced while loading; only reading an errored query throws (for `<Errored>` to catch). Suspense is opt-in: `query.whenReady()` gates on the initial render (throwing `NotReadyError` for `<Loading>` to catch) and then returns the rows exactly like `query()` — feed it straight into `<For each={...}>`. It settles at network readiness or a permitted persisted fallback.

### Revalidation progress with isPending

```tsx
import { isPending } from 'solid-js'

// True while a changed input's new collection is loading:
{isPending(() => todosQuery.whenReady()) && <Spinner />}
```

Rendered content stays visible during revalidation (v2 `<Loading>` holds), so no fallback flash.

## Includes (Hierarchical Data)

When a query uses includes (subqueries in `select`), each child field is a live `Collection` by default. Subscribe to it with `useLiveQuery` in a subcomponent:

```tsx
function ProjectList() {
  const projectsQuery = useLiveQuery((q) =>
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

Note: wrap the child Collection in an Accessor (`() => props.issuesCollection`) to match the overload signature.

With `toArray()`, child results are plain arrays and the parent re-emits on child changes:

```tsx
import { toArray, eq } from '@tanstack/solid-db'

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

### HIGH Reading signals outside the query function

Wrong:

```tsx
const [userId] = createSignal(1)
const id = userId()
const query = useLiveQuery((q) =>
  q.from({ todo: todoCollection }).where(({ todo }) => eq(todo.userId, id)),
)
```

Correct:

```tsx
const [userId] = createSignal(1)
const query = useLiveQuery((q) =>
  q
    .from({ todo: todoCollection })
    .where(({ todo }) => eq(todo.userId, userId())),
)
```

Solid's reactivity tracks signal reads inside reactive contexts. Reading outside the query function captures the value at creation time — changes won't trigger re-execution.

Source: docs/framework/solid/overview.md

### MEDIUM Reading removed v1 properties (query.data / query.isLoading)

Wrong:

```tsx
<For each={todosQuery.data}>{(todo) => <li>{todo.text}</li>}</For>
{todosQuery.isLoading && <Spinner />}
```

Correct:

```tsx
<For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
{todosQuery.status === 'loading' && <Spinner />}
```

`query.data` was a deprecated duplicate of calling the accessor; `isLoading`, `isIdle`, and `isCleanedUp` were removed in favor of `query.status`. `status`, `isReady`, `isError`, and the persisted-readiness properties remain.

See also: db-core/live-queries/SKILL.md — for query builder API.

See also: db-core/mutations-optimistic/SKILL.md — for mutation patterns.
