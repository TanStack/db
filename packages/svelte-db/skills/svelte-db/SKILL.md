---
name: svelte-db
description: >
  Svelte 5 bindings for TanStack DB. Covers useLiveQuery with Svelte 5
  runes ($state, $derived). Dependency tracking with getter functions
  for props and derived values. Return shape (data, state, collection,
  status, isLoading, isReady, isError).
type: framework
library: db
framework: svelte
library_version: '0.5.29'
requires:
  - db-core
---

This skill builds on db-core. Read db-core first for collection setup,
query builder syntax, operators, mutations, and sync concepts.

# TanStack DB — Svelte

## Setup

```bash
npm install @tanstack/db @tanstack/svelte-db
```

Requires Svelte 5+ (runes).

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

```svelte
<script lang="ts">
  import { useLiveQuery } from '@tanstack/svelte-db'
  import { eq } from '@tanstack/db'
  import { todosCollection } from '../collections/todos'

  const query = useLiveQuery((q) =>
    q
      .from({ t: todosCollection })
      .where(({ t }) => eq(t.completed, false))
      .orderBy(({ t }) => t.createdAt, 'desc')
  )

  function handleToggle(id: string) {
    todosCollection.update(id, (draft) => {
      draft.completed = !draft.completed
    })
  }
</script>

{#if query.isLoading}
  <div>Loading...</div>
{:else if query.isError}
  <div>Error loading todos</div>
{:else}
  <ul>
    {#each query.data as todo (todo.id)}
      <li onclick={() => handleToggle(todo.id)}>
        {todo.text}
      </li>
    {/each}
  </ul>
{/if}
```

## Svelte-Specific Patterns

### Reactive parameters with getter functions in deps

In Svelte 5, props and derived values must be wrapped in getter functions
in the dependency array to maintain reactivity:

```svelte
<script lang="ts">
  import { useLiveQuery } from '@tanstack/svelte-db'
  import { eq, gte, and } from '@tanstack/db'

  let { status }: { status: string } = $props()
  let minPriority = $state(0)

  const query = useLiveQuery(
    (q) =>
      q
        .from({ t: todosCollection })
        .where(({ t }) =>
          and(eq(t.status, status), gte(t.priority, minPriority))
        ),
    [() => status, () => minPriority]
  )
</script>
```

## Common Mistakes

### HIGH — Destructuring useLiveQuery result breaks reactivity

Wrong:

```svelte
<script lang="ts">
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ t: todosCollection })
  )
  // data and isLoading are captured once — never update
</script>
```

Correct:

```svelte
<script lang="ts">
  const query = useLiveQuery((q) =>
    q.from({ t: todosCollection })
  )
  // Access via dot notation: query.data, query.isLoading

  // OR destructure with $derived:
  const { data, isLoading } = $derived(query)
</script>
```

Direct destructuring captures values at creation time, breaking Svelte 5
reactivity. Either use dot notation (`query.data`) or wrap with `$derived`
to maintain reactive tracking.

Source: packages/svelte-db/src/useLiveQuery.svelte.ts

### MEDIUM — Passing Svelte props directly instead of getter functions in deps

Wrong:

```svelte
<script lang="ts">
  let { status }: { status: string } = $props()

  const query = useLiveQuery(
    (q) => q.from({ t: todosCollection })
      .where(({ t }) => eq(t.status, status)),
    [status]  // Captures value at creation time
  )
</script>
```

Correct:

```svelte
<script lang="ts">
  let { status }: { status: string } = $props()

  const query = useLiveQuery(
    (q) => q.from({ t: todosCollection })
      .where(({ t }) => eq(t.status, status)),
    [() => status]  // Getter function maintains reactivity
  )
</script>
```

In Svelte 5, `$props()` values and `$state()` values must be wrapped in
getter functions in the dependency array. Passing values directly captures
them at creation time — the query never re-runs when props change.

Source: docs/framework/svelte/overview.md — Props in dependencies
