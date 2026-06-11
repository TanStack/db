---
title: TanStack DB Vue Adapter
id: adapter
---

## Installation

```sh
npm install @tanstack/vue-db
```

## Vue Composables

See the [Vue Functions Reference](./reference/index.md) to see the full list of composables available in the Vue Adapter.

For comprehensive documentation on writing queries (filtering, joins, aggregations, etc.), see the [Live Queries Guide](../../guides/live-queries).

## Basic Usage

### useLiveQuery

The `useLiveQuery` composable creates a live query that automatically updates your component when data changes. It returns reactive computed refs:

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

**Note:** All return values (`data`, `isLoading`, `status`, etc.) are computed refs, so access them with `.value` in `<script>` but directly in `<template>`.

### Dependency Arrays

The `useLiveQuery` composable accepts an optional dependency array as its last parameter. When any reactive value in the array changes, the query is recreated and re-executed.

#### When to Use Dependency Arrays

Use dependency arrays when your query depends on external reactive values (refs, props, or reactive objects):

```vue
<script setup>
import { ref } from 'vue'
import { useLiveQuery } from '@tanstack/vue-db'
import { gt } from '@tanstack/db'

const minPriority = ref(5)

const { data } = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => gt(todos.priority, minPriority.value)),
  [minPriority] // Pass the ref directly, it will be unwrapped automatically
)
</script>

<template>
  <div>{{ data.length }} high-priority todos</div>
</template>
```

**Important:** Pass refs directly in the dependency array, not as functions. Vue will automatically track them.

#### What Happens When Dependencies Change

When a dependency value changes:
1. The previous live query collection is cleaned up
2. A new query is created with the updated values
3. The component re-renders with the new data
4. The composable shows loading state again

#### Best Practices

**Include all external refs used in the query:**

```vue
<script setup>
import { ref } from 'vue'
import { useLiveQuery } from '@tanstack/vue-db'
import { eq, and } from '@tanstack/db'

const userId = ref(1)
const status = ref('active')

// Good - all refs in deps array
const { data } = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => and(
           eq(todos.userId, userId.value),
           eq(todos.status, status.value)
         )),
  [userId, status] // Pass refs directly
)

// Bad - missing dependencies
const { data: badData } = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.userId, userId.value)),
  [] // Missing userId!
)
</script>

<template>
  <div>{{ data.length }} todos</div>
</template>
```

**Using with props:**

```vue
<script setup>
import { toRef } from 'vue'
import { useLiveQuery } from '@tanstack/vue-db'
import { eq } from '@tanstack/db'

const props = defineProps<{ userId: number }>()

// Option 1: Convert prop to ref
const userIdRef = toRef(props, 'userId')
const { data } = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.userId, userIdRef.value)),
  [userIdRef]
)

// Option 2: Use a getter function for the prop
const { data: data2 } = useLiveQuery(
  (q) => q.from({ todos: todosCollection })
         .where(({ todos }) => eq(todos.userId, props.userId)),
  [() => props.userId] // Getter function for non-ref values
)
</script>

<template>
  <div>{{ data.length }} todos</div>
</template>
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

<template>
  <div>{{ data.length }} todos</div>
</template>
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

<template>
  <div>{{ data.length }} todos</div>
</template>
```

### Using Pre-created Collections

You can also pass an existing collection to `useLiveQuery`. This is useful for sharing queries across components:

```vue
<script setup>
import { ref } from 'vue'
import { createLiveQueryCollection } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/vue-db'
import { eq } from '@tanstack/db'

// Create collection outside component or in a composable
const todosQuery = createLiveQueryCollection({
  query: (q) => q.from({ todos: todosCollection })
               .where(({ todos }) => eq(todos.active, true)),
  startSync: true
})

// Use the pre-created collection
const { data, collection } = useLiveQuery(todosQuery)

// Or use a reactive ref to switch between collections
const currentQuery = ref(todosQuery)
const { data: reactiveData } = useLiveQuery(currentQuery)
</script>

<template>
  <div>{{ data.length }} todos</div>
</template>
```
