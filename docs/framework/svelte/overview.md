---
title: TanStack DB Svelte Adapter
id: adapter
---

## Installation

```sh
npm install @tanstack/svelte-db
```

## Svelte Utilities

See the [Svelte Functions Reference](../reference/index.md) to see the full list of utilities available in the Svelte Adapter.

For comprehensive documentation on writing queries (filtering, joins, aggregations, etc.), see the [Live Queries Guide](../../guides/live-queries).

## Basic Usage

### useLiveQuery

The `useLiveQuery` utility creates a live query that automatically updates your component when data changes:

```svelte
<script>
  import { useLiveQuery } from '@tanstack/svelte-db'
  import { eq } from '@tanstack/db'

  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
  )
</script>

{#if $isLoading}
  <div>Loading...</div>
{:else}
  <ul>
    {#each $data as todo (todo.id)}
      <li>{todo.text}</li>
    {/each}
  </ul>
{/if}
```

### Dependency Arrays

The `useLiveQuery` utility accepts an optional dependency array as its last parameter. When any value in the array changes, the query is recreated and re-executed.

#### When to Use Dependency Arrays

Use dependency arrays when your query depends on external reactive values (props or state):

```svelte
<script>
  import { useLiveQuery } from '@tanstack/svelte-db'
  import { gt } from '@tanstack/db'

  let { minPriority } = $props()

  const { data } = useLiveQuery(
    (q) => q.from({ todos: todosCollection })
           .where(({ todos }) => gt(todos.priority, minPriority)),
    [() => minPriority] // Re-run when minPriority changes
  )
</script>

<div>{$data.length} high-priority todos</div>
```

**Note:** When using props or reactive state in the query, wrap them in a function for the dependency array.

#### What Happens When Dependencies Change

When a dependency value changes:
1. The previous live query collection is cleaned up
2. A new query is created with the updated values
3. The component re-renders with the new data
4. The utility shows loading state again

#### Best Practices

**Include all external values used in the query:**

```svelte
<script>
  import { useLiveQuery } from '@tanstack/svelte-db'
  import { eq, and } from '@tanstack/db'

  let userId = $state(1)
  let status = $state('active')

  // Good - all external values in deps
  const { data } = useLiveQuery(
    (q) => q.from({ todos: todosCollection })
           .where(({ todos }) => and(
             eq(todos.userId, userId),
             eq(todos.status, status)
           )),
    [() => userId, () => status]
  )

  // Bad - missing dependencies
  const { data: badData } = useLiveQuery(
    (q) => q.from({ todos: todosCollection })
           .where(({ todos }) => eq(todos.userId, userId)),
    [] // Missing userId!
  )
</script>

<div>{$data.length} todos</div>
```

**Empty array for static queries:**

```svelte
<script>
  import { useLiveQuery } from '@tanstack/svelte-db'

  // No external dependencies - query never changes
  const { data } = useLiveQuery(
    (q) => q.from({ todos: todosCollection }),
    []
  )
</script>

<div>{$data.length} todos</div>
```

**Omit the array for queries with no external dependencies:**

```svelte
<script>
  import { useLiveQuery } from '@tanstack/svelte-db'

  // Same as above - no deps needed
  const { data } = useLiveQuery(
    (q) => q.from({ todos: todosCollection })
  )
</script>

<div>{$data.length} todos</div>
```
