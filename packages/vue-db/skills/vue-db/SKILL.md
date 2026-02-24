---
name: vue-db
description: >
  Vue 3 bindings for TanStack DB. Covers useLiveQuery composable with
  computed refs. Reactive query parameters via Vue refs. Return shape
  (data, state, collection, status, isLoading, isReady, isError) as
  reactive Refs.
type: framework
library: db
framework: vue
library_version: '0.5.29'
requires:
  - db-core
---

This skill builds on db-core. Read db-core first for collection setup,
query builder syntax, operators, mutations, and sync concepts.

# TanStack DB — Vue

## Setup

```bash
npm install @tanstack/db @tanstack/vue-db
```

Collections are created outside components in a dedicated module:

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

Returns reactive Refs that update when query results change:

```vue
<script setup lang="ts">
import { useLiveQuery } from '@tanstack/vue-db'
import { eq } from '@tanstack/db'
import { todosCollection } from '../collections/todos'

const { data, isLoading, isReady, isError } = useLiveQuery((q) =>
  q
    .from({ t: todosCollection })
    .where(({ t }) => eq(t.completed, false))
    .orderBy(({ t }) => t.createdAt, 'desc'),
)

const handleToggle = (id: string) => {
  todosCollection.update(id, (draft) => {
    draft.completed = !draft.completed
  })
}
</script>

<template>
  <div v-if="isLoading">Loading...</div>
  <div v-else-if="isError">Error loading todos</div>
  <ul v-else>
    <li v-for="todo in data" :key="todo.id" @click="handleToggle(todo.id)">
      {{ todo.text }}
    </li>
  </ul>
</template>
```

All return values (`data`, `state`, `collection`, `status`, `isLoading`,
`isReady`, `isError`) are Vue Refs.

## Vue-Specific Patterns

### Reactive query parameters with refs

Vue refs used inside the query function are automatically tracked:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useLiveQuery } from '@tanstack/vue-db'
import { eq, gte } from '@tanstack/db'

const statusFilter = ref('active')
const minPriority = ref(0)

const { data } = useLiveQuery((q) =>
  q
    .from({ t: todosCollection })
    .where(({ t }) =>
      and(eq(t.status, statusFilter.value), gte(t.priority, minPriority.value)),
    ),
)
</script>
```

### Mutations from event handlers

Mutations are called directly on collections — same as in any framework:

```vue
<script setup lang="ts">
const addTodo = (text: string) => {
  todosCollection.insert({
    id: crypto.randomUUID(),
    text,
    completed: false,
  })
}
</script>
```

## Common Mistakes

No Vue-specific mistakes beyond those covered in db-core. The Vue adapter
handles reactivity tracking automatically through Vue's composition API.
See db-core/live-queries and db-core/mutations-optimistic for common
mistakes that apply across all frameworks.
