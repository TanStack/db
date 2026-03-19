---
name: db-core/testing
description: >
  Testing TanStack DB collections and components. Creating mock collections
  with controlled sync behavior. Framework-specific testing patterns for
  React (renderHook, waitFor), Vue (nextTick), Svelte ($effect.root, flushSync),
  Solid (renderHook), and Angular (TestBed). Testing mutations (insert, update,
  delete), createOptimisticAction, and live queries. Stripping virtual props.
  Vitest setup and configuration. Use when writing tests, setting up test
  infrastructure, or debugging test failures for code that uses TanStack DB.
user-invocable: false
type: sub-skill
library: db
library_version: '0.5.30'
sources:
  - 'TanStack/db:docs/guides/testing.md'
  - 'TanStack/db:packages/db/tests/utils.ts'
  - 'TanStack/db:packages/react-db/tests/useLiveQuery.test.tsx'
  - 'TanStack/db:packages/vue-db/tests/useLiveQuery.test.ts'
  - 'TanStack/db:packages/svelte-db/tests/useLiveQuery.svelte.test.ts'
  - 'TanStack/db:packages/solid-db/tests/useLiveQuery.test.tsx'
  - 'TanStack/db:packages/angular-db/tests/inject-live-query.test.ts'
---

This skill builds on db-core. Read it first for the overall mental model.

For the full test inventory with file counts and coverage areas,
see [references/test-inventory.md](references/test-inventory.md).

# TanStack DB — Testing

## Quick Decision Tree

- Testing collection logic without a framework? → [Core Collection Tests](#core-collection-tests)
- Testing a React component with useLiveQuery? → [React](#react)
- Testing a Vue component with useLiveQuery? → [Vue](#vue)
- Testing a Svelte component with useLiveQuery? → [Svelte](#svelte)
- Testing a Solid component with useLiveQuery? → [Solid](#solid)
- Testing an Angular component with injectLiveQuery? → [Angular](#angular)
- Testing mutations or optimistic actions? → [Testing Mutations](#testing-mutations)
- Want to see what the built-in test suite covers? → [references/test-inventory.md](references/test-inventory.md)

## Setup

TanStack DB uses **Vitest** with **jsdom** for all tests.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/test-setup.ts'],
  },
})
```

React setup file (other frameworks need only `import '@testing-library/jest-dom/vitest'`):

```ts
// tests/test-setup.ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
global.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => cleanup())
```

## Creating Mock Collections

The core pattern: create a collection with an inline `sync` function that loads data synchronously.

```ts
import { createCollection } from '@tanstack/db'

type Person = { id: string; name: string; age: number }

const collection = createCollection<Person>({
  id: 'test-persons',
  getKey: (p) => p.id,
  sync: {
    sync: ({ begin, write, commit, markReady }) => {
      begin()
      write({ type: 'insert', value: { id: '1', name: 'Alice', age: 30 } })
      write({ type: 'insert', value: { id: '2', name: 'Bob', age: 25 } })
      commit()
      markReady()
    },
  },
  startSync: true,
})
```

**Key points:**

- Call `begin()` before writing, `commit()` after, and `markReady()` once initial load is done.
- Each test should use a unique collection `id` to avoid state leakage.
- Keep references to `begin`/`write`/`commit` to simulate live updates later in the test.

## Core Collection Tests

You can test collection logic without any UI framework:

```ts
const collection = createCollection<Person>({
  id: 'persons',
  getKey: (p) => p.id,
  sync: {
    sync: ({ begin, write, commit, markReady }) => {
      begin()
      write({ type: 'insert', value: { id: '1', name: 'Alice', age: 30 } })
      commit()
      markReady()
    },
  },
  startSync: true,
  onUpdate: async () => {},
})

await collection.stateWhenReady()

// Test mutation
collection.update('1', (draft) => {
  draft.name = 'Alice Updated'
})
expect(collection.get('1')).toMatchObject({ name: 'Alice Updated' })

// Test size
expect(collection.size).toBe(1)
```

## React

Use `renderHook` and `waitFor` from `@testing-library/react`.

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { createCollection, gt } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'

const { result } = renderHook(() =>
  useLiveQuery((q) =>
    q
      .from({ persons: collection })
      .where(({ persons }) => gt(persons.age, 28))
      .select(({ persons }) => ({
        id: persons.id,
        name: persons.name,
      })),
  ),
)

await waitFor(() => {
  expect(result.current.data).toHaveLength(2)
})
```

**Access pattern:** `result.current.data`, `result.current.state`, `result.current.status`

## Vue

Use Vue's `nextTick()` + a small delay for collection update propagation.

```ts
import { nextTick } from 'vue'
import { useLiveQuery } from '@tanstack/vue-db'

const { data, state } = useLiveQuery((q) =>
  q.from({ persons: collection }).where(({ persons }) => gt(persons.age, 28)),
)

await nextTick()
await new Promise((resolve) => setTimeout(resolve, 50))

expect(data.value).toHaveLength(1)
```

**Access pattern:** `data.value`, `state.value` (Vue refs)

## Svelte

Use `$effect.root` and `flushSync` from Svelte 5.

```ts
import { flushSync } from 'svelte'
import { useLiveQuery } from '@tanstack/svelte-db'

let cleanup: (() => void) | null = null
afterEach(() => cleanup?.())

cleanup = $effect.root(() => {
  const query = useLiveQuery((q) =>
    q.from({ persons: collection }).where(({ persons }) => gt(persons.age, 28)),
  )

  flushSync()

  expect(query.data).toHaveLength(1)
})
```

**Access pattern:** `query.data`, `query.state` (direct access, reactive via runes)

**Note:** When destructuring, wrap in `$derived` to maintain reactivity:

```ts
const { data } = $derived(query) // preserves reactivity
```

## Solid

Use `renderHook` and `waitFor` from `@solidjs/testing-library`.

```tsx
import { renderHook, waitFor } from '@solidjs/testing-library'
import { useLiveQuery } from '@tanstack/solid-db'

const rendered = renderHook(() =>
  useLiveQuery((q) =>
    q.from({ persons: collection }).where(({ persons }) => gt(persons.age, 28)),
  ),
)

await waitFor(() => {
  expect(rendered.result.state.size).toBe(1)
})

// result is an accessor (function call)
expect(rendered.result()).toHaveLength(1)
```

**Access pattern:** `rendered.result()` (accessor function), `rendered.result.state`

## Angular

Use `TestBed.runInInjectionContext` to provide the injection context.

```ts
import { TestBed } from '@angular/core/testing'
import { injectLiveQuery } from '@tanstack/angular-db'

TestBed.runInInjectionContext(() => {
  const query = injectLiveQuery((q) =>
    q.from({ persons: collection }).where(({ persons }) => gt(persons.age, 28)),
  )

  await new Promise((resolve) => setTimeout(resolve, 50))

  expect(query.data()).toHaveLength(1)
})
```

**Access pattern:** `query.data()`, `query.state()` (Angular signals)

## Testing Mutations

Test optimistic inserts, updates, and deletes directly on collections:

```ts
// Provide mutation handlers so the collection accepts mutations
const collection = createCollection<Person>({
  id: 'test',
  getKey: (p) => p.id,
  sync: {
    sync: ({ begin, commit, markReady }) => {
      begin()
      commit()
      markReady()
    },
  },
  startSync: true,
  onInsert: async () => {},
  onUpdate: async () => {},
  onDelete: async () => {},
})

await collection.stateWhenReady()

// Insert
collection.insert({ id: '1', name: 'Alice', age: 30 })
expect(collection.has('1')).toBe(true)

// Update (Immer-style draft)
collection.update('1', (draft) => {
  draft.age = 31
})
expect(collection.get('1')).toMatchObject({ age: 31 })

// Delete
collection.delete('1')
expect(collection.has('1')).toBe(false)
```

### Testing createOptimisticAction

```ts
import { createOptimisticAction } from '@tanstack/db'

const likePost = createOptimisticAction<string>({
  onMutate: (postId) => {
    collection.update(postId, (draft) => {
      draft.liked = true
    })
  },
  mutationFn: async () => {
    /* mock */
  },
})

likePost('1')
expect(collection.get('1')).toMatchObject({ liked: true })
```

## Stripping Virtual Props

TanStack DB adds `$synced`, `$origin`, `$key`, `$collectionId` to items. Two approaches:

1. **Use `toMatchObject`** (recommended) — ignores extra properties automatically.
2. **Strip manually** if you need exact equality:

```ts
function stripVirtualProps<T extends Record<string, any>>(value: T) {
  const { $synced, $origin, $key, $collectionId, ...rest } = value as any
  return rest as T
}

expect(stripVirtualProps(item)).toEqual({ id: '1', name: 'Alice', age: 30 })
```

## Common Mistakes

| Mistake                              | Fix                                                                   |
| ------------------------------------ | --------------------------------------------------------------------- |
| Not calling `markReady()` in sync    | Collection stays in `loading` state; queries never resolve            |
| Reusing collection `id` across tests | State leaks between tests; use unique IDs                             |
| Not waiting for reactivity flush     | Use framework-appropriate wait mechanism                              |
| Using `toEqual` on collection items  | Use `toMatchObject` to ignore virtual props                           |
| Forgetting mutation handlers         | Provide `onInsert`/`onUpdate`/`onDelete` (even empty async functions) |

## Running the Built-in Tests

```bash
# Full suite
pnpm test

# Specific package
pnpm --filter @tanstack/db test
pnpm --filter @tanstack/react-db test
```

For a detailed inventory of all 166+ built-in test files grouped by package and area,
see [references/test-inventory.md](references/test-inventory.md).

## Version

Targets @tanstack/db v0.5.30.
