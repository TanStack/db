---
name: meta-framework
description: >
  Integrating TanStack DB with meta-frameworks (TanStack Start, Next.js,
  Remix, Nuxt, SvelteKit). Client-side only: SSR is NOT supported — routes
  must disable SSR. Preloading eager collections in route loaders with
  collection.preload(). On-demand Query Collections require preloading the
  live query because source collection preload is a no-op. Multiple collection
  preloading with Promise.all. Framework-specific loader APIs.
type: composition
library: db
library_version: '0.6.17'
requires:
  - db-core
  - db-core/collection-setup
sources:
  - 'TanStack/db:examples/react/todo/src/routes/electric.tsx'
  - 'TanStack/db:examples/react/todo/src/routes/query.tsx'
  - 'TanStack/db:examples/react/todo/src/start.tsx'
---

This skill builds on db-core. Read it first for collection setup and query builder.

# TanStack DB — Meta-Framework Integration

## Setup

TanStack DB collections are **client-side only**. SSR is not implemented. Routes using TanStack DB **must disable SSR**. The setup pattern is:

1. Set `ssr: false` on the route
2. Preload the eager collection, or preload the live query for an on-demand source
3. Use `useLiveQuery` in the component

## TanStack Start

### Global SSR disable

```ts
// start.tsx
import { createStart } from '@tanstack/react-start'

export const startInstance = createStart(() => {
  return {
    defaultSsr: false,
  }
})
```

### Per-route SSR disable + preload

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'

export const Route = createFileRoute('/todos')({
  ssr: false,
  loader: async () => {
    await todoCollection.preload()
    return null
  },
  component: TodoPage,
})

function TodoPage() {
  const { data: todos } = useLiveQuery({
    query: (q) => q.from({ todo: todoCollection }),
  })
  return (
    <ul>
      {todos.map((t) => (
        <li key={t.id}>{t.text}</li>
      ))}
    </ul>
  )
}
```

### On-demand Query Collection preload

Calling `preload()` on an on-demand source collection is a no-op. Define the
live query once, preload it in the loader, and pass that same collection to the
framework hook:

```tsx
import { createLiveQueryCollection, eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'

const activeTodos = createLiveQueryCollection((q) =>
  q
    .from({ todo: todoCollection })
    .where(({ todo }) => eq(todo.completed, false)),
)

export const Route = createFileRoute('/todos')({
  ssr: false,
  loader: async () => {
    await activeTodos.preload()
    return null
  },
  component: () => {
    const { data } = useLiveQuery(activeTodos)
    // ...
  },
})
```

### Multiple collection preloading

```tsx
export const Route = createFileRoute('/electric')({
  ssr: false,
  loader: async () => {
    await Promise.all([todoCollection.preload(), configCollection.preload()])
    return null
  },
  component: ElectricPage,
})
```

## Next.js (App Router)

### Client component with preloading

```tsx
// app/todos/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'

export default function TodoPage() {
  const { data: todos, isLoading } = useLiveQuery({
    query: (q) => q.from({ todo: todoCollection }),
  })

  if (isLoading) return <div>Loading...</div>
  return (
    <ul>
      {todos.map((t) => (
        <li key={t.id}>{t.text}</li>
      ))}
    </ul>
  )
}
```

Next.js App Router components using TanStack DB must be client components (`'use client'`). There is no server-side preloading — collections sync on mount.

### With route-level preloading (experimental)

```tsx
// app/todos/page.tsx
'use client'

import { useEffect } from 'react'
import { useLiveQuery } from '@tanstack/react-db'

// Trigger preload immediately when module is loaded
const preloadPromise = todoCollection.preload()

export default function TodoPage() {
  const { data: todos } = useLiveQuery({
    query: (q) => q.from({ todo: todoCollection }),
  })
  return (
    <ul>
      {todos.map((t) => (
        <li key={t.id}>{t.text}</li>
      ))}
    </ul>
  )
}
```

## Remix

### Client loader pattern

```tsx
// app/routes/todos.tsx
import { useLiveQuery } from '@tanstack/react-db'
import type { ClientLoaderFunctionArgs } from '@remix-run/react'

export const clientLoader = async ({ request }: ClientLoaderFunctionArgs) => {
  await todoCollection.preload()
  return null
}

// Prevent server loader from running
export const loader = () => null

export default function TodoPage() {
  const { data: todos } = useLiveQuery({
    query: (q) => q.from({ todo: todoCollection }),
  })
  return (
    <ul>
      {todos.map((t) => (
        <li key={t.id}>{t.text}</li>
      ))}
    </ul>
  )
}
```

## Nuxt

### Client-only component

```vue
<!-- pages/todos.vue -->
<script setup lang="ts">
import { useLiveQuery } from '@tanstack/vue-db'

const { data: todos, isLoading } = useLiveQuery((q) =>
  q.from({ todo: todoCollection }),
)
</script>

<template>
  <ClientOnly>
    <div v-if="isLoading">Loading...</div>
    <ul v-else>
      <li v-for="todo in todos" :key="todo.id">{{ todo.text }}</li>
    </ul>
  </ClientOnly>
</template>
```

Wrap TanStack DB components in `<ClientOnly>` to prevent SSR.

## SvelteKit

### Client-side only page

```svelte
<!-- src/routes/todos/+page.svelte -->
<script lang="ts">
  import { browser } from '$app/environment'
  import { useLiveQuery } from '@tanstack/svelte-db'

  const todosQuery = browser
    ? useLiveQuery((q) => q.from({ todo: todoCollection }))
    : null
</script>

{#if todosQuery}
  {#each todosQuery.data as todo (todo.id)}
    <li>{todo.text}</li>
  {/each}
{/if}
```

Or disable SSR for the route:

```ts
// src/routes/todos/+page.ts
export const ssr = false
```

## Core Patterns

### What preload() does

For eager collections, `collection.preload()` starts the sync process and
returns a promise that resolves when the collection reaches "ready" status.
This means:

1. The sync function connects to the backend
2. Initial data is fetched and written to the collection
3. `markReady()` is called by the adapter
4. The promise resolves

Subsequent calls to `preload()` on an already-ready collection return immediately.

For on-demand collections, source `collection.preload()` warns and does
nothing because no subset has been requested. Create the required live query
and await `liveQuery.preload()`.

### Stable collection ownership

For one global `QueryClient` and one global server resource, define the
collection in a shared module and import it in loaders and components:

```ts
// lib/collections.ts
import { createCollection, queryCollectionOptions } from '@tanstack/react-db'

export const todoCollection = createCollection(
  queryCollectionOptions({ ... })
)
```

```tsx
// routes/todos.tsx — loader uses the same collection instance
import { todoCollection } from '../lib/collections'

export const Route = createFileRoute('/todos')({
  ssr: false,
  loader: async () => {
    await todoCollection.preload()
    return null
  },
  component: () => {
    const { data } = useLiveQuery({
      query: (q) => q.from({ todo: todoCollection }),
    })
    // ...
  },
})
```

When the `QueryClient`, tenant, project, account, or route parameter defines
the resource, create one stable collection per `QueryClient` and business
scope. Memoize it and put it in router/request context rather than using a
process-global collection. Remove unused entries and call
`collection.cleanup()` in long-lived scope maps.

See the
[Query adapter runtime and business-scope pattern](../db-core/collection-setup/references/query-adapter.md#runtime-queryclient-and-business-scopes).

## Server-Side Integration

This skill covers the **client-side** read path only (preloading, live queries). For server-side concerns:

- **Electric proxy route** (forwarding shape requests to Electric) — see the [Electric adapter reference](../db-core/collection-setup/references/electric-adapter.md)
- **Mutation endpoints** (`createServerFn` in TanStack Start, API routes in Next.js/Remix) — implement using your framework's server function pattern. See the Electric adapter reference for the txid handshake that mutations must return.

## Common Mistakes

### CRITICAL Enabling SSR with TanStack DB

Wrong:

```tsx
export const Route = createFileRoute('/todos')({
  loader: async () => {
    await todoCollection.preload()
    return null
  },
})
```

Correct:

```tsx
export const Route = createFileRoute('/todos')({
  ssr: false,
  loader: async () => {
    await todoCollection.preload()
    return null
  },
})
```

TanStack DB collections are client-side only. Without `ssr: false`, the route loader runs on the server where collections cannot sync, causing hangs or errors.

Source: examples/react/todo/src/start.tsx

### HIGH Forgetting to preload in route loader

Wrong:

```tsx
export const Route = createFileRoute('/todos')({
  ssr: false,
  component: TodoPage,
})
```

Correct:

```tsx
export const Route = createFileRoute('/todos')({
  ssr: false,
  loader: async () => {
    await todoCollection.preload()
    return null
  },
  component: TodoPage,
})
```

Without preloading, the collection starts syncing when the component first renders, causing a loading flash. Preloading in the route loader starts sync during navigation, so the data is already there on that first render.

### MEDIUM Creating separate collection instances in one scope

Wrong:

```tsx
// routes/todos.tsx
const todoCollection = createCollection(queryCollectionOptions({ ... }))

export const Route = createFileRoute('/todos')({
  ssr: false,
  loader: async () => { await todoCollection.preload() },
  component: () => {
    const { data } = useLiveQuery({
      query: (q) => q.from({ todo: todoCollection }),
    })
  },
})
```

Correct:

```ts
// lib/collections.ts — shared for a global QueryClient and global resource
export const todoCollection = createCollection(queryCollectionOptions({ ... }))
```

Collections are stable within a `QueryClient` and business scope; they are not
universal singletons. Creating several instances in one scope causes duplicate
syncs and split state. A request-, router-, tenant-, or route-scoped client
needs a scoped factory instead of the global module pattern.

See also: react-db/SKILL.md, vue-db/SKILL.md, svelte-db/SKILL.md, solid-db/SKILL.md, angular-db/SKILL.md — for framework-specific hook usage.

See also: db-core/collection-setup/SKILL.md — for collection creation and adapter selection.
