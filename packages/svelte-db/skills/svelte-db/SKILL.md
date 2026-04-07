---
name: svelte-db
description: >
  Svelte 5 bindings for TanStack DB. useLiveQuery with Svelte 5 runes
  ($state, $derived, $effect). Dependency arrays use getter functions
  (() => value) for reactive props. Direct destructuring breaks reactivity —
  use dot notation or wrap with $derived. Conditional queries via returning
  undefined/null. Import from @tanstack/svelte-db (re-exports all of
  @tanstack/db).
type: framework
library: db
framework: svelte
library_version: '0.6.0'
requires:
  - db-core
sources:
  - 'TanStack/db:docs/framework/svelte/overview.md'
  - 'TanStack/db:packages/svelte-db/src/useLiveQuery.svelte.ts'
---

This skill builds on db-core. Read it first for collection setup, query builder, and mutation patterns.

# TanStack DB — Svelte 5

## Setup

```svelte
<script lang="ts">
import { useLiveQuery, eq, not } from "@tanstack/svelte-db"

const todosQuery = useLiveQuery((q) =>
  q
    .from({ todo: todoCollection })
    .where(({ todo }) => not(todo.completed))
    .orderBy(({ todo }) => todo.created_at, "asc")
)
</script>

{#if todosQuery.isLoading}
  <div>Loading...</div>
{:else}
  <ul>
    {#each todosQuery.data as todo (todo.id)}
      <li>{todo.text}</li>
    {/each}
  </ul>
{/if}
```

`@tanstack/svelte-db` re-exports everything from `@tanstack/db`.

## Hook

### useLiveQuery

Returns a reactive object with getter properties:

```ts
// Query function — access via dot notation
const query = useLiveQuery((q) => q.from({ todo: todoCollection }))
// query.data, query.isLoading, query.status, etc.

// With reactive deps — use GETTER FUNCTIONS
let minPriority = $state(5)
const query = useLiveQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => gt(todo.priority, minPriority)),
  [() => minPriority],
)

// Config object
const query = useLiveQuery({
  query: (q) => q.from({ todo: todoCollection }),
  gcTime: 60000,
})

// Pre-created collection
const query = useLiveQuery(preloadedCollection)
```

## Svelte-Specific Patterns

### Destructuring with $derived

```ts
// WRONG — breaks reactivity
const { data, isLoading } = useLiveQuery(...)

// CORRECT — use dot notation
const query = useLiveQuery(...)
// Access: query.data, query.isLoading

// CORRECT — wrap with $derived if you need destructuring
const query = useLiveQuery(...)
const { data, isLoading } = $derived(query)
```

### Props in dependency arrays

```svelte
<script lang="ts">
  let { userId }: { userId: number } = $props()

  const todosQuery = useLiveQuery(
    (q) => q.from({ todo: todoCollection })
             .where(({ todo }) => eq(todo.userId, userId)),
    [() => userId]
  )
</script>
```

## Common Mistakes

### CRITICAL Passing values instead of getter functions in deps

Wrong:

```ts
let filter = $state('active')
const query = useLiveQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.status, filter)),
  [filter],
)
```

Correct:

```ts
let filter = $state('active')
const query = useLiveQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.status, filter)),
  [() => filter],
)
```

In Svelte 5, deps must be getter functions. Passing values directly captures them at creation time — changes won't trigger re-execution.

Source: docs/framework/svelte/overview.md

### HIGH Direct destructuring breaks reactivity

Wrong:

```ts
const { data, isLoading } = useLiveQuery((q) =>
  q.from({ todo: todoCollection }),
)
```

Correct:

```ts
const query = useLiveQuery((q) => q.from({ todo: todoCollection }))
// Use query.data, query.isLoading
```

Direct destructuring captures values at creation time. Use dot notation or wrap with `$derived`.

Source: packages/svelte-db/src/useLiveQuery.svelte.ts

See also: db-core/live-queries/SKILL.md — for query builder API.

See also: db-core/mutations-optimistic/SKILL.md — for mutation patterns.
