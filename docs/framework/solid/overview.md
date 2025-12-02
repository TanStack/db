---
title: TanStack DB Solid Adapter
id: adapter
---

## Installation

```sh
npm install @tanstack/solid-db
```

## Solid Primitives

See the [Solid Functions Reference](../reference/index.md) to see the full list of primitives available in the Solid Adapter.

For comprehensive documentation on writing queries (filtering, joins, aggregations, etc.), see the [Live Queries Guide](../../guides/live-queries).

## Basic Usage

### useLiveQuery

The `useLiveQuery` primitive creates a live query that automatically updates your component when data changes. It returns an object where `data` is a plain array and status fields (e.g. `isLoading()`, `status()`) are accessors:

```tsx
import { useLiveQuery } from '@tanstack/solid-db'
import { eq } from '@tanstack/db'
import { Show, For } from 'solid-js'

function TodoList() {
  const query = useLiveQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
  )

  return (
    <Show when={!query.isLoading()} fallback={<div>Loading...</div>}>
      <ul>
        <For each={query.data}>
          {(todo) => <li>{todo.text}</li>}
        </For>
      </ul>
    </Show>
  )
}
```

**Note:** `query.data` returns an array directly (not a function), but status fields like `isLoading()`, `status()`, etc. are accessor functions.

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

  return <div>{query.data.length} high-priority todos</div>
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
      <div>{query.data.length} todos</div>
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

  // Good - signal accessed inside query function
  const query = useLiveQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => gt(todos.priority, minPriority()))
  )

  // Solid automatically tracks minPriority() and recomputes when it changes
  return <div>{query.data.length} todos</div>
}
```

**Don't read signals outside the query function:**

```tsx
import { createSignal } from 'solid-js'
import { useLiveQuery } from '@tanstack/solid-db'
import { gt } from '@tanstack/db'

function TodoList() {
  const [minPriority, setMinPriority] = createSignal(5)

  // Bad - reading signal outside query function
  const currentPriority = minPriority()
  const query = useLiveQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => gt(todos.priority, currentPriority))
  )
  // Won't update when minPriority changes!

  return <div>{query.data.length} todos</div>
}
```

**Static queries need no special handling:**

```tsx
import { useLiveQuery } from '@tanstack/solid-db'

function AllTodos() {
  // No signals accessed - query never changes
  const query = useLiveQuery((q) =>
    q.from({ todos: todosCollection })
  )

  return <div>{query.data.length} todos</div>
}
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
  // Pass existing collection
  const query = useLiveQuery(() => todosQuery)

  return <div>{query.data.length} todos</div>
}
```
