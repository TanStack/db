---
title: TanStack DB Vue Adapter
id: adapter
---

## Installation

```sh
npm install @tanstack/vue-db
```

## Vue Composables

See the [Vue Functions Reference](../reference/index.md) to see the full list of composables available in the Vue Adapter.

For comprehensive documentation on writing queries (filtering, joins, aggregations, etc.), see the [Live Queries Guide](../../guides/live-queries).

## Basic Usage

### useLiveQuery

The `useLiveQuery` composable creates a live query that automatically updates your component when data changes:

```vue
<script setup>
import { useLiveQuery } from '@tanstack/vue-db'
import { eq } from '@tanstack/db'

const { data, isLoading } = useLiveQuery((q) =>
  q.from({ todos: todosCollection })
   .where(({ todos }) => eq(todos.completed, false))
   .select(({ todos }) => ({ id: todos.id, text: todos.text }))
)
</script>

<template>
  <div v-if="isLoading">Loading...</div>
  <ul v-else>
    <li v-for="todo in data" :key="todo.id">{{ todo.text }}</li>
  </ul>
</template>
```

### Dependency Arrays

The `useLiveQuery` composable accepts an optional dependency array as its last parameter. This array works similarly to Vue's `watchEffect` dependencies - when any value in the array changes, the query is recreated and re-executed.

#### When to Use Dependency Arrays

Use dependency arrays when your query depends on external reactive values (props, refs, or other composables):

```vue
<script setup>
import { useLiveQuery } from '@tanstack/vue-db'
import { gt } from '@tanstack/db'

const props = defineProps<{ minPriority: number }>()

const { data } = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, props.minPriority)),
  [() => props.minPriority] // Re-run when minPriority changes
)
</script>

<template>
  <div>{{ data.length }} high-priority todos</div>
</template>
```

**Note:** When using props or refs in the query, wrap them in a function for the dependency array.

#### What Happens When Dependencies Change

When a dependency value changes:
1. The previous live query collection is cleaned up
2. A new query is created with the updated values
3. The component re-renders with the new data
4. The composable shows loading state again

#### Best Practices

**Include all external values used in the query:**

```vue
<script setup>
import { ref } from 'vue'
import { useLiveQuery } from '@tanstack/vue-db'
import { eq, and } from '@tanstack/db'

const userId = ref(1)
const status = ref('active')

// Good - all external values in deps
const { data } = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => and(
           eq(todos.userId, userId.value),
           eq(todos.status, status.value)
         )),
  [() => userId.value, () => status.value]
)

// Bad - missing dependencies
const { data: badData } = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.userId, userId.value)),
  [] // Missing userId!
)
</script>
```

**Empty array for static queries:**

```vue
<script setup>
import { useLiveQuery } from '@tanstack/vue-db'

// No external dependencies - query never changes
const { data } = useLiveQuery(
  (q) => q.from({ todos: todosCollection }),
  []
)
</script>
```

**Omit the array for queries with no external dependencies:**

```vue
<script setup>
import { useLiveQuery } from '@tanstack/vue-db'

// Same as above - no deps needed
const { data } = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
)
</script>
```
