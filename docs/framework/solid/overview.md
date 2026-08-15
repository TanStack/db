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

The `useLiveQuery` primitive creates a live query that automatically updates your component when data changes. It returns an accessor — call it as a function (`query()`) to read data. Status fields (`isLoading`, `isReady`, `isError`, `status`) are plain properties:

```tsx
import { useLiveQuery } from '@tanstack/solid-db'
import { eq } from '@tanstack/db'
import { For } from 'solid-js'
import { Loading } from '@solidjs/web'

function TodoList() {
  const query = useLiveQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
  )

  return (
    <Loading fallback={<div>Loading...</div>}>
      <ul>
        <For each={query()}>
          {(todo) => <li>{todo.text}</li>}
        </For>
      </ul>
    </Loading>
  )
}
```

**Note:** Call `query()` to read data. Use `<Loading>` and `<Errored>` boundaries to handle loading and error states. The accessor also exposes `query.state` (a `ReactiveMap`) and `query.collection` (the underlying `Collection`).

### Loading and Error Boundaries

In Solid v2, reading the accessor while the collection is loading throws `NotReadyError` (caught by `<Loading>`), and reading an errored query throws the error (caught by `<Errored>`):

```tsx
import { Loading, Errored } from '@solidjs/web'

function TodoList() {
  const query = useLiveQuery((q) => q.from({ todos: todosCollection }))

  return (
    <Errored catch={(err) => <div>Error: {err.message}</div>}>
      <Loading fallback={<div>Loading...</div>}>
        <For each={query()}>
          {(todo) => <li>{todo.text}</li>}
        </For>
      </Loading>
    </Errored>
  )
}
```

You can also check status without boundaries:

```tsx
<Show when={query.isError}>
  <div>Error: {query.status}</div>
</Show>
```

### isPending and latest Helpers

Solid v2's async `createMemo` enables `isPending` and `latest` on the accessor result:

```tsx
import { isPending, latest } from 'solid-js'

// isPending: true during revalidation while new collection loads
<Show when={isPending(query)}>
  <Spinner />
</Show>

// latest: returns stale value during revalidation, skipping <Loading>
<For each={latest(query)}>
  {(todo) => <li>{todo.text}</li>}
</For>
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
2. Cleans up the previous live query collection
3. Creates a new query with the updated value
4. Updates the component with the new data

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

### External-Source Bridge (Opt-in)

For advanced use cases where you want observer snapshots to auto-track in any Solid compute without `useLiveQuery`, install the external-source bridge once at app startup:

```tsx
import { enableSolidDBExternalSource, trackSnapshot } from '@tanstack/solid-db'
import { createMemo } from 'solid-js'

enableSolidDBExternalSource()

// Now trackSnapshot() auto-subscribes inside any Solid compute:
const snapshot = createMemo(() => trackSnapshot(observer))
```
