---
name: vue-db
description: >
  Vue 3 bindings for TanStack DB. useLiveQuery composable with
  MaybeRefOrGetter query functions, ComputedRef return values for all fields
  (data, state, collection, status, isLoading, isReady, isError).
  Dependency arrays with Vue refs. Conditional queries via returning
  undefined/null. Pre-created collection support via ref or getter.
  Import from @tanstack/vue-db (re-exports all of @tanstack/db).
type: framework
library: db
framework: vue
library_version: '0.6.0'
requires:
  - db-core
sources:
  - 'TanStack/db:docs/framework/vue/overview.md'
  - 'TanStack/db:packages/vue-db/src/useLiveQuery.ts'
---

This skill builds on db-core. Read it first for collection setup, query builder, and mutation patterns.

# TanStack DB — Vue

## Setup

```vue
<script setup lang="ts">
import { useLiveQuery, eq, not } from '@tanstack/vue-db'

const { data: todos, isLoading } = useLiveQuery((q) =>
  q
    .from({ todo: todoCollection })
    .where(({ todo }) => not(todo.completed))
    .orderBy(({ todo }) => todo.created_at, 'asc'),
)
</script>

<template>
  <div v-if="isLoading">Loading...</div>
  <ul v-else>
    <li v-for="todo in todos" :key="todo.id">{{ todo.text }}</li>
  </ul>
</template>
```

`@tanstack/vue-db` re-exports everything from `@tanstack/db`.

## Hook

### useLiveQuery

All return values are `ComputedRef`:

```ts
// Query function with reactive deps
const minPriority = ref(5)
const { data, isLoading, isReady, status } = useLiveQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => gt(todo.priority, minPriority.value)),
  [minPriority],
)

// Config object
const { data } = useLiveQuery({
  query: (q) => q.from({ todo: todoCollection }),
  gcTime: 60000,
})

// Pre-created collection (reactive via ref)
const { data } = useLiveQuery(preloadedCollection)

// Conditional query
const userId = ref<number | null>(null)
const { data, status } = useLiveQuery(
  (q) => {
    if (!userId.value) return undefined
    return q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.userId, userId.value))
  },
  [userId],
)
```

## Vue-Specific Patterns

### Reactive dependencies with refs

```ts
const filter = ref('active')
const { data } = useLiveQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.status, filter.value)),
  [filter],
)
// Query re-runs when filter.value changes
```

### Mutations in event handlers

```ts
const handleToggle = (id: number) => {
  todoCollection.update(id, (draft) => {
    draft.completed = !draft.completed
  })
}
```

## Common Mistakes

### CRITICAL Missing reactive deps in dependency array

Wrong:

```ts
const userId = ref(1)
const { data } = useLiveQuery((q) =>
  q
    .from({ todo: todoCollection })
    .where(({ todo }) => eq(todo.userId, userId.value)),
)
```

Correct:

```ts
const userId = ref(1)
const { data } = useLiveQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.userId, userId.value)),
  [userId],
)
```

Reactive refs used in the query must be included in the deps array for the query to re-run on changes.

Source: docs/framework/vue/overview.md

See also: db-core/live-queries/SKILL.md — for query builder API.

See also: db-core/mutations-optimistic/SKILL.md — for mutation patterns.
