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
library_version: "0.5.30"
requires:
  - db-core
sources:
  - "TanStack/db:docs/framework/solid/overview.md"
  - "TanStack/db:packages/solid-db/src/useLiveQuery.ts"
---

This skill builds on db-core. Read it first for collection setup, query builder, and mutation patterns.

# TanStack DB — SolidJS

## Setup

```tsx
import { useLiveQuery, eq, not } from "@tanstack/solid-db"
import { For, Show, Suspense } from "solid-js"

function TodoList() {
  const todosQuery = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => not(todo.completed))
      .orderBy(({ todo }) => todo.created_at, "asc")
  )

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ul>
        <For each={todosQuery()}>
          {(todo) => <li>{todo.text}</li>}
        </For>
      </ul>
    </Suspense>
  )
}
```

`@tanstack/solid-db` re-exports everything from `@tanstack/db`.

## Hook

### useLiveQuery

Returns an `Accessor<Array<T>>` with additional properties. Call it as a function to get data:

```tsx
// Query function — call result as function for data
const query = useLiveQuery((q) =>
  q.from({ todo: todoCollection })
)
// query()        → Array<T> (data)
// query.status   → CollectionStatus
// query.isLoading, query.isReady, query.isError
// query.state    → ReactiveMap<TKey, T>
// query.collection → Collection

// With reactive signals — signals MUST be read INSIDE the query function
const [minPriority, setMinPriority] = createSignal(5)
const query = useLiveQuery((q) =>
  q.from({ todo: todoCollection })
   .where(({ todo }) => gt(todo.priority, minPriority()))
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
  return q.from({ todo: todoCollection }).where(({ todo }) => eq(todo.userId, id))
})
```

## Solid-Specific Patterns

### Signal reads inside query function

```tsx
// CORRECT — signal read tracked inside query function
const [category, setCategory] = createSignal("work")
const query = useLiveQuery((q) =>
  q.from({ todo: todoCollection })
   .where(({ todo }) => eq(todo.category, category()))
)
// Query re-runs when category() changes

// WRONG — signal read outside, not tracked
const cat = category()  // read here loses tracking
const query = useLiveQuery((q) =>
  q.from({ todo: todoCollection })
   .where(({ todo }) => eq(todo.category, cat))
)
```

### Suspense integration

```tsx
<Suspense fallback={<div>Loading...</div>}>
  <For each={todosQuery()}>
    {(todo) => <li>{todo.text}</li>}
  </For>
</Suspense>
```

`useLiveQuery` integrates with Solid's `createResource` — wrap in `<Suspense>` for loading states.

## Common Mistakes

### HIGH Reading signals outside the query function

Wrong:

```tsx
const [userId] = createSignal(1)
const id = userId()
const query = useLiveQuery((q) =>
  q.from({ todo: todoCollection }).where(({ todo }) => eq(todo.userId, id))
)
```

Correct:

```tsx
const [userId] = createSignal(1)
const query = useLiveQuery((q) =>
  q.from({ todo: todoCollection }).where(({ todo }) => eq(todo.userId, userId()))
)
```

Solid's reactivity tracks signal reads inside reactive contexts. Reading outside the query function captures the value at creation time — changes won't trigger re-execution.

Source: docs/framework/solid/overview.md

See also: db-core/live-queries/SKILL.md — for query builder API.

See also: db-core/mutations-optimistic/SKILL.md — for mutation patterns.
