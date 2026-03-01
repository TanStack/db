---
name: solid-db
description: >
  Solid.js bindings for TanStack DB. Covers useLiveQuery with fine-grained
  Solid reactivity. Signal reads must happen inside the query function for
  automatic tracking. Return shape (data, state, collection, status,
  isLoading, isReady, isError) as Solid signals.
type: framework
library: db
framework: solid
library_version: '0.5.29'
requires:
  - db-core
---

This skill builds on db-core. Read db-core first for collection setup,
query builder syntax, operators, mutations, and sync concepts.

# TanStack DB — Solid

## Setup

```bash
npm install @tanstack/db @tanstack/solid-db
```

Collections are created outside components:

```typescript
// collections/todos.ts
import { createCollection, eq } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

export const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: () => fetch('/api/todos').then((r) => r.json()),
    getKey: (todo) => todo.id,
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      await fetch(`/api/todos/${original.id}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
    },
  }),
)
```

## Hooks and Components

### useLiveQuery

Returns Solid signals that update reactively:

```typescript
import { useLiveQuery } from '@tanstack/solid-db'
import { eq } from '@tanstack/db'
import { todosCollection } from '../collections/todos'

function TodoList() {
  const query = useLiveQuery((q) =>
    q
      .from({ t: todosCollection })
      .where(({ t }) => eq(t.completed, false))
      .orderBy(({ t }) => t.createdAt, 'desc')
  )

  return (
    <Show when={query.isReady} fallback={<div>Loading...</div>}>
      <ul>
        <For each={query.data}>
          {(todo) => (
            <li onClick={() => {
              todosCollection.update(todo.id, (draft) => {
                draft.completed = !draft.completed
              })
            }}>
              {todo.text}
            </li>
          )}
        </For>
      </ul>
    </Show>
  )
}
```

## Solid-Specific Patterns

### Signal reads inside the query function

Solid tracks signal reads for reactivity. Read signals INSIDE the query
function so changes are tracked automatically:

```typescript
import { createSignal } from 'solid-js'
import { eq, gte, and } from '@tanstack/db'

function FilteredTodos() {
  const [status, setStatus] = createSignal('active')
  const [minPriority, setMinPriority] = createSignal(0)

  const query = useLiveQuery((q) =>
    q
      .from({ t: todosCollection })
      .where(({ t }) =>
        and(
          eq(t.status, status()),     // Read signal INSIDE query fn
          gte(t.priority, minPriority())  // Read signal INSIDE query fn
        )
      )
  )

  return (
    <div>
      <select onChange={(e) => setStatus(e.target.value)}>
        <option value="active">Active</option>
        <option value="done">Done</option>
      </select>
      <ul>
        <For each={query.data}>
          {(todo) => <li>{todo.text}</li>}
        </For>
      </ul>
    </div>
  )
}
```

## Common Mistakes

### HIGH — Reading Solid signals outside the query function

Wrong:

```typescript
function FilteredTodos() {
  const [status, setStatus] = createSignal('active')

  // Signal read OUTSIDE query fn — not tracked
  const currentStatus = status()

  const query = useLiveQuery((q) =>
    q
      .from({ t: todosCollection })
      .where(({ t }) => eq(t.status, currentStatus)),
  )
}
```

Correct:

```typescript
function FilteredTodos() {
  const [status, setStatus] = createSignal('active')

  const query = useLiveQuery(
    (q) =>
      q.from({ t: todosCollection }).where(({ t }) => eq(t.status, status())), // Read INSIDE
  )
}
```

Solid's reactivity tracks signal reads inside reactive scopes. Reading
a signal outside the query function and passing the value means changes
aren't tracked — the query captures the initial value and never updates.

Source: docs/framework/solid/overview.md — fine-grained reactivity section
