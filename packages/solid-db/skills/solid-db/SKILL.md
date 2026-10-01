---
name: solid-db
description: >
  SolidJS v2 bindings for TanStack DB. useLiveQuery returns an Accessor that
  doubles as data access (call as function) with state and collection
  properties. Fine-grained reactivity: signal reads MUST happen inside the
  query function for tracking. Config passed as Accessor (() => config).
  Built-in Loading boundary support via async createMemo; use solid-js's
  isPending/latest helpers for revalidation states. Wholesale observer mode +
  keyed projection for per-field row reactivity. Opt-in external-source bridge
  via enableSolidDBExternalSource. Import from @tanstack/solid-db (re-exports
  all of @tanstack/db).
type: framework
library: db
framework: solid
library_version: '0.7.0'
requires:
  - db-core
sources:
  - 'TanStack/db:docs/framework/solid/overview.md'
  - 'TanStack/db:packages/solid-db/src/useLiveQuery.ts'
  - 'TanStack/db:packages/solid-db/src/external-source.ts'
---

This skill builds on db-core. Read it first for collection setup, query builder, and mutation patterns.

# TanStack DB — SolidJS v2

## Setup

```tsx
import { useLiveQuery, eq, not } from '@tanstack/solid-db'
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
// query()          → Array<T> (data)  — or T | undefined when using findOne()
// query.state      → ReactiveMap<TKey, T>
// query.collection → Collection
// query.persistedStatus / query.isPersistedReady / query.persistedError
//                  → persisted (network-first) restore state

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

### External-source bridge (opt-in)

Solid v2's `enableExternalSource` API lets external reactive systems participate in Solid's tracking graph. TanStack DB exposes this as an opt-in one-time install:

```tsx
import { enableSolidDBExternalSource, trackSnapshot } from '@tanstack/solid-db'
import { createMemo } from 'solid-js'

// Call once at app startup:
enableSolidDBExternalSource()

// Now trackSnapshot() inside any Solid compute auto-subscribes:
const snapshot = createMemo(() => trackSnapshot(observer))
// re-runs automatically when the observer notifies — no manual subscribe needed
```

Without the bridge, use `useLiveQuery` which handles subscription internally.

### Loading boundary integration

```tsx
import { Loading, Errored } from '@solidjs/web'

<Errored catch={(err) => <div>Error: {err.message}</div>}>
  <Loading fallback={<div>Loading...</div>}>
    <For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
  </Loading>
</Errored>
```

`useLiveQuery` integrates with Solid v2's async `createMemo`: reading the accessor while the collection is loading throws `NotReadyError` (caught by `<Loading>`); reading an errored query throws the captured error (caught by `<Errored>`).

### Revalidation: isPending and latest

During revalidation (a changed input is loading a new collection), Solid v2's built-in helpers read the accessor without a `<Loading>` boundary:

```tsx
import { isPending, latest } from 'solid-js'

// True while a value CHANGE is in flight (not during first load):
{isPending(() => todosQuery()) && <Spinner />}

// Last committed rows — no Loading flash while the new collection loads:
<For each={latest(() => todosQuery())}>{(todo) => <li>{todo.text}</li>}</For>
```

These read the async `createMemo` inside `useLiveQuery`, so they follow Solid's standard pending/latest semantics.

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

### MEDIUM Reading removed v1 properties (query.data / query.status)

Wrong:

```tsx
<For each={todosQuery.data}>{(todo) => <li>{todo.text}</li>}</For>
{todosQuery.status === 'loading' && <Spinner />}
```

Correct:

```tsx
<For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
{isPending(() => todosQuery()) && <Spinner />}
```

`query.data` and the status flags (`status`, `isLoading`, `isReady`, `isError`) were removed in the v2 API. Read data by calling the accessor; use `isPending(() => query())` for in-flight changes and `query.collection.status` for a non-reactive status read.

See also: db-core/live-queries/SKILL.md — for query builder API.

See also: db-core/mutations-optimistic/SKILL.md — for mutation patterns.
