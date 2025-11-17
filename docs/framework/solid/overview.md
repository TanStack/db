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

The `useLiveQuery` primitive creates a live query that automatically updates your component when data changes:

```tsx
import { useLiveQuery } from '@tanstack/solid-db'
import { eq } from '@tanstack/db'
import { Show, For } from 'solid-js'

function TodoList() {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
  )

  return (
    <Show when={!isLoading()} fallback={<div>Loading...</div>}>
      <ul>
        <For each={data()}>
          {(todo) => <li>{todo.text}</li>}
        </For>
      </ul>
    </Show>
  )
}
```

### Dependency Arrays

The `useLiveQuery` primitive accepts an optional dependency array as its last parameter. This array works similarly to Solid's `createEffect` dependencies - when any value in the array changes, the query is recreated and re-executed.

#### When to Use Dependency Arrays

Use dependency arrays when your query depends on external reactive values (props or signals):

```tsx
import { useLiveQuery } from '@tanstack/solid-db'
import { gt } from '@tanstack/db'

function FilteredTodos(props: { minPriority: number }) {
  const { data } = useLiveQuery(
    (q) => q.from({ todos: todosCollection })
           .where(({ todos }) => gt(todos.priority, props.minPriority)),
    [() => props.minPriority] // Re-run when minPriority changes
  )

  return <div>{data().length} high-priority todos</div>
}
```

**Note:** When using props or signals in the query, wrap them in a function for the dependency array.

#### What Happens When Dependencies Change

When a dependency value changes:
1. The previous live query collection is cleaned up
2. A new query is created with the updated values
3. The component re-renders with the new data
4. The primitive shows loading state again

#### Best Practices

**Include all external values used in the query:**

```tsx
import { createSignal } from 'solid-js'
import { useLiveQuery } from '@tanstack/solid-db'
import { eq, and } from '@tanstack/db'

function TodoList() {
  const [userId, setUserId] = createSignal(1)
  const [status, setStatus] = createSignal('active')

  // Good - all external values in deps
  const { data } = useLiveQuery(
    (q) => q.from({ todos: todosCollection })
           .where(({ todos }) => and(
             eq(todos.userId, userId()),
             eq(todos.status, status())
           )),
    [userId, status]
  )

  // Bad - missing dependencies
  const { data: badData } = useLiveQuery(
    (q) => q.from({ todos: todosCollection })
           .where(({ todos }) => eq(todos.userId, userId())),
    [] // Missing userId!
  )

  return <div>{data().length} todos</div>
}
```

**Empty array for static queries:**

```tsx
import { useLiveQuery } from '@tanstack/solid-db'

function AllTodos() {
  // No external dependencies - query never changes
  const { data } = useLiveQuery(
    (q) => q.from({ todos: todosCollection }),
    []
  )

  return <div>{data().length} todos</div>
}
```

**Omit the array for queries with no external dependencies:**

```tsx
import { useLiveQuery } from '@tanstack/solid-db'

function AllTodos() {
  // Same as above - no deps needed
  const { data } = useLiveQuery(
    (q) => q.from({ todos: todosCollection })
  )

  return <div>{data().length} todos</div>
}
```
