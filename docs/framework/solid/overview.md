---
title: TanStack DB Solid Adapter
id: adapter
---

## Installation

```sh
npm install @tanstack/solid-db
```

Requires `solid-js@>=2.0.0-rc.0` and `@solidjs/web@>=2.0.0-rc.0` as peer dependencies.

## Solid Primitives

See the [Solid Functions Reference](./reference/index.md) to see the full list of primitives available in the Solid Adapter.

For comprehensive documentation on writing queries (filtering, joins, aggregations, etc.), see the [Live Queries Guide](../../guides/live-queries).

## Basic Usage

### useLiveQuery

The `useLiveQuery` primitive creates a live query that automatically updates your component when data changes. It returns an accessor — call it as a function (`query()`) to read the current rows synchronously. Rows that sync before the collection is ready render immediately (progressive sync); only reading an errored query throws.

```tsx
import { useLiveQuery } from '@tanstack/solid-db'
import { eq } from '@tanstack/db'
import { For } from 'solid-js'

function TodoList() {
  const query = useLiveQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
  )

  return (
    <ul>
      <For each={query()}>
        {(todo) => <li>{todo.text}</li>}
      </For>
    </ul>
  )
}
```

**Note:** The accessor also exposes reactive properties: `query.state` (a `ReactiveMap` keyed by result key), `query.collection`, `query.status`, `query.isReady`, `query.isError`, and the persisted-readiness trio `query.persistedStatus` / `query.isPersistedReady` / `query.persistedError`.

### Opt-in gate with loaded

Data reads never suspend. To gate rendering on first data, read `query.loaded()` inside a `<Loading>` boundary — it throws `NotReadyError` until the query passes its initial-render gate (network ready, or a permitted persisted fallback), then returns the rows exactly like `query()`. Errors flow to `<Errored>`:

```tsx
import { Loading, Errored } from '@solidjs/web'

function TodoList() {
  const query = useLiveQuery((q) => q.from({ todos: todosCollection }))

  return (
    <Errored fallback={(err) => <div>Error: {String(err())}</div>}>
      <Loading fallback={<div>Loading...</div>}>
        <For each={query.loaded()}>
          {(todo) => <li>{todo.text}</li>}
        </For>
      </Loading>
    </Errored>
  )
}
```

Once content has rendered, revalidation keeps it visible — no fallback flash while a changed input loads its new collection.

### isPending for revalidation progress

Solid v2's `isPending` reads the `loaded` accessor to report an in-flight change without a boundary:

```tsx
import { isPending } from 'solid-js'

// True while a changed input's new collection is loading:
{isPending(() => query.loaded()) && <Spinner />}
```

### Reactive Queries with Signals

Solid uses fine-grained reactivity, which means queries automatically track and respond to signal changes. Simply call signals inside your query function, and Solid will automatically recompute when they change:

```tsx
import { createSignal } from 'solid-js'
import { useLiveQuery } from '@tanstack/solid-db'
import { gt } from '@tanstack/db'

function FilteredTodos(props: { minPriority: number }) {
  const query = useLiveQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => gt(todos.priority, props.minPriority))
  )

  return <div>{query().length} high-priority todos</div>
}
```

When `props.minPriority` changes, Solid's reactivity system automatically:
1. Detects the prop access inside the query function
2. Resolves the query for the updated value — identical eq-filtered queries share a pooled live-query Collection, others get a fresh one
3. Updates the component with the new data

#### Using Signals from Component State

```tsx
import { createSignal } from 'solid-js'
import { useLiveQuery } from '@tanstack/solid-db'
import { eq, and } from '@tanstack/db'

function TodoList() {
  const [userId, setUserId] = createSignal(1)
  const [status, setStatus] = createSignal('active')

  // Solid automatically tracks userId() and status() calls
  const query = useLiveQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => and(
       eq(todos.userId, userId()),
       eq(todos.status, status())
     ))
  )

  return (
    <div>
      <select onChange={(e) => setStatus(e.currentTarget.value)}>
        <option value="active">Active</option>
        <option value="completed">Completed</option>
      </select>
      <div>{query().length} todos</div>
    </div>
  )
}
```

**Key Point:** Unlike React, you don't need dependency arrays. Solid's reactive system automatically tracks any signals, props, or stores accessed during query execution.

#### Best Practices

**Access signals inside the query function:**

```tsx
import { createSignal } from 'solid-js'
import { useLiveQuery } from '@tanstack/solid-db'
import { gt } from '@tanstack/db'

function TodoList() {
  const [minPriority, setMinPriority] = createSignal(5)

  const query = useLiveQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => gt(todos.priority, minPriority()))
  )

  return <div>{query().length} todos</div>
}
```

**Don't read signals outside the query function:**

```tsx
// Bad - reading signal outside query function
const currentPriority = minPriority()
const query = useLiveQuery((q) =>
  q.from({ todos: todosCollection })
   .where(({ todos }) => gt(todos.priority, currentPriority))
)
// Won't update when minPriority changes!
```

### findOne (single result)

When the query uses `.findOne()`, the accessor returns a single object (or `undefined`) instead of an array:

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

### Using Pre-created Collections

You can also pass an existing collection to `useLiveQuery`. This is useful for sharing queries across components:

```tsx
import { createLiveQueryCollection } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/solid-db'

// Create collection outside component
const todosQuery = createLiveQueryCollection((q) =>
  q.from({ todos: todosCollection })
   .where(({ todos }) => eq(todos.active, true))
)

function TodoList() {
  // Pass existing collection via accessor
  const query = useLiveQuery(() => todosQuery)

  return <div>{query().length} todos</div>
}
```
