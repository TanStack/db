---
title: TanStack DB Preact Adapter
id: adapter
---

## Installation

```sh
npm install @tanstack/preact-db
```

## Preact Hooks

For comprehensive documentation on writing queries (filtering, joins, aggregations, etc.), see the [Live Queries Guide](../../guides/live-queries).

## Basic Usage

### useLiveQuery

`useLiveQuery` creates a live query and re-renders your component when collection data changes:

```tsx
import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/preact-db'

function TodoList() {
  const { data, isLoading } = useLiveQuery((q) =>
    q
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.completed, false))
      .select(({ todos }) => ({ id: todos.id, text: todos.text })),
  )

  if (isLoading) return <div>Loading...</div>

  return (
    <ul>
      {data.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  )
}
```

### Dependency Arrays

Like React hooks, Preact hooks use dependency arrays to recreate queries when external values change:

```tsx
import { gt } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/preact-db'

function FilteredTodos(props: { minPriority: number }) {
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ todos: todosCollection })
        .where(({ todos }) => gt(todos.priority, props.minPriority)),
    [props.minPriority],
  )

  return <div>{data.length} high-priority todos</div>
}
```

### useLiveSuspenseQuery

```tsx
import { Suspense } from 'preact/compat'
import { useLiveSuspenseQuery } from '@tanstack/preact-db'

function TodoList() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ todos: todosCollection }).select(({ todos }) => todos),
  )

  return (
    <ul>
      {data.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  )
}

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TodoList />
    </Suspense>
  )
}
```

### usePacedMutations

```tsx
import { debounceStrategy, usePacedMutations } from '@tanstack/preact-db'

function TodoInput() {
  const persistTodo = usePacedMutations<string>({
    onMutate: (text) => {
      todosCollection.insert({ id: crypto.randomUUID(), text, completed: false })
    },
    mutationFn: async ({ transaction }) => {
      await api.save(transaction.mutations)
    },
    strategy: debounceStrategy({ wait: 300 }),
  })

  return <input onInput={(e) => persistTodo((e.target as HTMLInputElement).value)} />
}
```

## Examples

A runnable Preact example is available at `examples/preact/basic`.
