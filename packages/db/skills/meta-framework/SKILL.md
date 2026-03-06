---
name: meta-framework
description: >
  Integrating TanStack DB with meta-frameworks (TanStack Start, Next.js,
  Remix, Nuxt, SvelteKit). Client-side only: SSR is NOT supported — routes
  must disable SSR. Preloading collections in route loaders with
  collection.preload(). Pattern: ssr: false + await collection.preload() in
  loader. Multiple collection preloading with Promise.all. Framework-specific
  loader APIs.
type: composition
library: db
library_version: '0.5.30'
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
2. Call `collection.preload()` in the route loader
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
  const { data: todos } = useLiveQuery((q) => q.from({ todo: todoCollection }))
  return (
    <ul>
      {todos.map((t) => (
        <li key={t.id}>{t.text}</li>
      ))}
    </ul>
  )
}
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
  const { data: todos, isLoading } = useLiveQuery((q) =>
    q.from({ todo: todoCollection }),
  )

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
  const { data: todos } = useLiveQuery((q) => q.from({ todo: todoCollection }))
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
  const { data: todos } = useLiveQuery((q) => q.from({ todo: todoCollection }))
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

`collection.preload()` starts the sync process and returns a promise that resolves when the collection reaches "ready" status. This means:

1. The sync function connects to the backend
2. Initial data is fetched and written to the collection
3. `markReady()` is called by the adapter
4. The promise resolves

Subsequent calls to `preload()` on an already-ready collection return immediately.

### Collection module pattern

Define collections in a shared module, import in both loaders and components:

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
    const { data } = useLiveQuery((q) => q.from({ todo: todoCollection }))
    // ...
  },
})
```

### TanStack Start server functions for Electric write path

When using Electric collections with TanStack Start, use `createServerFn` for mutations that return `txid`:

```tsx
import { createServerFn } from '@tanstack/react-start'

const createTodo = createServerFn({ method: 'POST' })
  .validator(z.object({ text: z.string(), id: z.string() }))
  .handler(async ({ data }) => {
    let txid!: number
    const todo = await sql.begin(async (tx) => {
      // txid MUST be queried inside the same Postgres transaction
      const [{ txid: rawTxid }] =
        await tx`SELECT pg_current_xact_id()::text as txid`
      txid = Number(rawTxid)
      const [row] = await tx`INSERT INTO todos ${tx(data)} RETURNING *`
      return row
    })
    return { todo, txid }
  })
```

See electric-adapter reference for how `txid` is used with `awaitTxId`.

### Duplicate @tanstack/db instances

When third-party packages bundle their own copy of `@tanstack/db`, the `instanceof` check in `useLiveInfiniteQuery` can fail. In dev mode, TanStack DB throws `DuplicateDbInstanceError` if two instances are detected.

Fix with Vite `resolve.alias`:

```ts
// vite.config.ts
export default defineConfig({
  resolve: {
    alias: {
      '@tanstack/db': path.resolve('./node_modules/@tanstack/db'),
    },
  },
})
```

This forces all imports of `@tanstack/db` to resolve to a single copy. The root cause is typically a dependency that doesn't declare `@tanstack/db` as a `peerDependency`.

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

Without preloading, the collection starts syncing only when the component mounts, causing a loading flash. Preloading in the route loader starts sync during navigation, making data available immediately when the component renders.

### MEDIUM Creating separate collection instances

Wrong:

```tsx
// routes/todos.tsx
const todoCollection = createCollection(queryCollectionOptions({ ... }))

export const Route = createFileRoute('/todos')({
  ssr: false,
  loader: async () => { await todoCollection.preload() },
  component: () => {
    const { data } = useLiveQuery((q) => q.from({ todo: todoCollection }))
  },
})
```

Correct:

```ts
// lib/collections.ts — single shared instance
export const todoCollection = createCollection(queryCollectionOptions({ ... }))
```

Collections are singletons. Creating multiple instances for the same data causes duplicate syncs, wasted bandwidth, and inconsistent state between components.

See also: react-db/SKILL.md, vue-db/SKILL.md, svelte-db/SKILL.md, solid-db/SKILL.md, angular-db/SKILL.md — for framework-specific hook usage.

See also: db-core/collection-setup/SKILL.md — for collection creation and adapter selection.
