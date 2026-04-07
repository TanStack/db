---
name: solid-db
description: >
  SolidJS bindings for TanStack DB. useLiveQuery returns an Accessor that
  doubles as data access (call as function) with state/status properties.
  Fine-grained reactivity: signal reads MUST happen inside the query function
  for tracking. Config passed as Accessor (() => config). Built-in Suspense
  support via createResource. ReactiveMap for state. Import from
  @tanstack/solid-db (re-exports all of @tanstack/db).
type: framework
library: db
framework: solid
library_version: '0.6.0'
requires:
  - db-core
sources:
  - 'TanStack/db:docs/framework/solid/overview.md'
  - 'TanStack/db:packages/solid-db/src/useLiveQuery.ts'
---

This skill builds on db-core. Read it first for collection setup, query builder, and mutation patterns.

# TanStack DB — SolidJS

## Setup

```tsx
import { useLiveQuery, eq, not } from '@tanstack/solid-db'
import { For, Show, Suspense } from 'solid-js'

function TodoList() {
  const todosQuery = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => not(todo.completed))
      .orderBy(({ todo }) => todo.created_at, 'asc'),
  )

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ul>
        <For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
      </ul>
    </Suspense>
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
// query()        → Array<T> (data)  — or T | undefined when using findOne()
// query.data     → DEPRECATED — use query() instead. Migrate any existing code.
// query.status   → CollectionStatus
// query.isLoading, query.isReady, query.isError
// query.state    → ReactiveMap<TKey, T>
// query.collection → Collection

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

### Suspense integration

```tsx
<Suspense fallback={<div>Loading...</div>}>
  <For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
</Suspense>
```

`useLiveQuery` integrates with Solid's `createResource` — wrap in `<Suspense>` for loading states.

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
  return (
    <For each={issuesQuery()}>
      {(issue) => <div>{issue.title}</div>}
    </For>
  )
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

### MEDIUM Using deprecated query.data instead of query()

Wrong:

```tsx
<For each={todosQuery.data}>{(todo) => <li>{todo.text}</li>}</For>
```

Correct:

```tsx
<For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
```

`query.data` is deprecated. Always use `query()` to access data. If you encounter existing code using `.data`, migrate it to the function call form.

See also: db-core/live-queries/SKILL.md — for query builder API.

See also: db-core/mutations-optimistic/SKILL.md — for mutation patterns.
