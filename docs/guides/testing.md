---
title: Testing
id: testing
---

# Testing

TanStack DB is designed to be easy to test. Collections can be created with mock sync configurations, and every framework adapter works with standard testing tools for that ecosystem.

This guide covers how to set up your test environment, create mock collections, and test components that use TanStack DB across all supported frameworks.

## Test Setup

TanStack DB uses [Vitest](https://vitest.dev/) as its testing framework. Install the necessary dependencies for your framework:

```bash
# Core
npm install -D vitest @testing-library/jest-dom

# React
npm install -D @testing-library/react

# Vue
# (no additional testing library needed — use Vue's built-in nextTick)

# Solid
npm install -D @solidjs/testing-library

# Svelte
# (no additional testing library needed — use Svelte's built-in flushSync)

# Angular
# (uses Angular's built-in TestBed)
```

### Vitest Configuration

A basic Vitest configuration for testing TanStack DB:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom', // needed for DOM-based tests
    setupFiles: ['./tests/test-setup.ts'],
  },
})
```

### Test Setup File

For React projects, create a setup file that configures the React ACT environment and automatic cleanup:

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

For non-React projects, a minimal setup is sufficient:

```ts
// tests/test-setup.ts
import '@testing-library/jest-dom/vitest'
```

## Creating Mock Collections

The key to testing with TanStack DB is creating collections with controlled sync behavior. You don't need a real backend — create collections with inline sync functions that provide initial data immediately.

### Basic Pattern

Create a collection that synchronously loads initial data:

```ts
import { createCollection } from '@tanstack/db'

function createTestCollection<T extends object>(config: {
  id: string
  initialData: Array<T>
  getKey: (item: T) => string | number
}) {
  let begin: () => void
  let write: (op: { type: string; value: T }) => void
  let commit: () => void

  return createCollection<T>({
    id: config.id,
    getKey: config.getKey,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit

        // Load initial data immediately
        begin()
        config.initialData.forEach((item) => {
          write({ type: 'insert', value: item })
        })
        commit()
        params.markReady()
      },
    },
    startSync: true,
  })
}
```

### Using the Built-in Test Utility

TanStack DB's own test suite uses a `mockSyncCollectionOptions` helper that also exposes `begin`, `write`, and `commit` for simulating live sync updates after initial load. You can adopt this pattern in your own tests:

```ts
import { createCollection } from '@tanstack/db'

type Person = {
  id: string
  name: string
  age: number
}

const collection = createCollection<Person>({
  id: 'test-persons',
  getKey: (person) => person.id,
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

### Simulating Live Updates

To test how your components react to data changes, keep references to the sync functions and call them later:

```ts
let begin: () => void
let write: (op: { type: string; value: any }) => void
let commit: () => void

const collection = createCollection<Person>({
  id: 'test-persons',
  getKey: (person) => person.id,
  sync: {
    sync: (params) => {
      begin = params.begin
      write = params.write
      commit = params.commit

      // Load initial data
      begin()
      write({ type: 'insert', value: { id: '1', name: 'Alice', age: 30 } })
      commit()
      params.markReady()
    },
  },
  startSync: true,
})

// Later in your test, simulate a new record arriving from the server:
begin()
write({ type: 'insert', value: { id: '3', name: 'Charlie', age: 28 } })
commit()
```

## Testing by Framework

### React

Use `renderHook` and `waitFor` from `@testing-library/react`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createCollection, gt } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'

type Person = { id: string; name: string; age: number }

describe('useLiveQuery', () => {
  it('filters data reactively', async () => {
    const collection = createCollection<Person>({
      id: 'persons',
      getKey: (p) => p.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: 'insert', value: { id: '1', name: 'Alice', age: 30 } })
          write({ type: 'insert', value: { id: '2', name: 'Bob', age: 25 } })
          write({ type: 'insert', value: { id: '3', name: 'Charlie', age: 35 } })
          commit()
          markReady()
        },
      },
      startSync: true,
    })

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

    expect(result.current.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Alice' }),
        expect.objectContaining({ name: 'Charlie' }),
      ]),
    )
  })
})
```

### Vue

Use Vue's `nextTick` for reactivity updates:

```ts
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createCollection, gt } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/vue-db'

describe('useLiveQuery', () => {
  it('returns reactive data', async () => {
    const collection = createCollection<Person>({
      id: 'persons',
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

    const { data } = useLiveQuery((q) =>
      q
        .from({ persons: collection })
        .where(({ persons }) => gt(persons.age, 28))
        .select(({ persons }) => ({
          id: persons.id,
          name: persons.name,
        })),
    )

    await nextTick()
    // Additional delay for collection updates
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(data.value).toHaveLength(1)
    expect(data.value[0]).toMatchObject({ name: 'Alice' })
  })
})
```

### Svelte

Use Svelte 5's `$effect.root` and `flushSync`:

```ts
import { describe, expect, it, afterEach } from 'vitest'
import { flushSync } from 'svelte'
import { createCollection, gt } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/svelte-db'

describe('useLiveQuery', () => {
  let cleanup: (() => void) | null = null
  afterEach(() => cleanup?.())

  it('works with Svelte runes', () => {
    const collection = createCollection<Person>({
      id: 'persons',
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

    cleanup = $effect.root(() => {
      const query = useLiveQuery((q) =>
        q
          .from({ persons: collection })
          .where(({ persons }) => gt(persons.age, 28)),
      )

      flushSync()

      expect(query.data).toHaveLength(1)
      expect(query.data[0]).toMatchObject({ name: 'Alice' })
    })
  })
})
```

### Solid

Use `renderHook` from `@solidjs/testing-library`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@solidjs/testing-library'
import { createCollection, gt } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/solid-db'

describe('useLiveQuery', () => {
  it('returns reactive accessors', async () => {
    const collection = createCollection<Person>({
      id: 'persons',
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

    const rendered = renderHook(() =>
      useLiveQuery((q) =>
        q
          .from({ persons: collection })
          .where(({ persons }) => gt(persons.age, 28)),
      ),
    )

    await waitFor(() => {
      expect(rendered.result.state.size).toBe(1)
    })

    expect(rendered.result()).toHaveLength(1)
  })
})
```

### Angular

Use Angular's `TestBed.runInInjectionContext`:

```ts
import { TestBed } from '@angular/core/testing'
import { describe, expect, it } from 'vitest'
import { createCollection, gt } from '@tanstack/db'
import { injectLiveQuery } from '@tanstack/angular-db'

describe('injectLiveQuery', () => {
  it('returns signals', async () => {
    const collection = createCollection<Person>({
      id: 'persons',
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

    TestBed.runInInjectionContext(() => {
      const query = injectLiveQuery((q) =>
        q
          .from({ persons: collection })
          .where(({ persons }) => gt(persons.age, 28)),
      )

      // Wait for Angular effects and collection updates
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(query.data()).toHaveLength(1)
    })
  })
})
```

## Testing Mutations

Test optimistic mutations by verifying the collection state changes immediately:

```ts
import { describe, expect, it } from 'vitest'
import { createCollection } from '@tanstack/db'

describe('mutations', () => {
  it('applies optimistic inserts', async () => {
    const collection = createCollection<Person>({
      id: 'persons',
      getKey: (p) => p.id,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
      startSync: true,
      onInsert: async () => {
        // Mock handler — in tests, resolve immediately
      },
    })

    await collection.stateWhenReady()

    collection.insert({ id: '1', name: 'Alice', age: 30 })

    expect(collection.has('1')).toBe(true)
    expect(collection.get('1')).toMatchObject({ name: 'Alice' })
  })

  it('applies optimistic updates', async () => {
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

    collection.update('1', (draft) => {
      draft.name = 'Alice Updated'
    })

    expect(collection.get('1')).toMatchObject({ name: 'Alice Updated' })
  })

  it('applies optimistic deletes', async () => {
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
      onDelete: async () => {},
    })

    await collection.stateWhenReady()

    collection.delete('1')

    expect(collection.has('1')).toBe(false)
  })
})
```

## Testing with createOptimisticAction

```ts
import { createCollection, createOptimisticAction } from '@tanstack/db'

const collection = createCollection<{ id: string; liked: boolean }>({
  id: 'posts',
  getKey: (p) => p.id,
  sync: {
    sync: ({ begin, write, commit, markReady }) => {
      begin()
      write({ type: 'insert', value: { id: '1', liked: false } })
      commit()
      markReady()
    },
  },
  startSync: true,
})

const likePost = createOptimisticAction<string>({
  onMutate: (postId) => {
    collection.update(postId, (draft) => {
      draft.liked = true
    })
  },
  mutationFn: async () => {
    // Mock API call
  },
})

// In your test:
likePost('1')
expect(collection.get('1')).toMatchObject({ liked: true })
```

## Stripping Virtual Props

TanStack DB adds virtual properties (`$synced`, `$origin`, `$key`, `$collectionId`) to collection items. When asserting on specific object shapes, you may want to strip these:

```ts
function stripVirtualProps<T extends Record<string, any>>(value: T) {
  const {
    $synced: _synced,
    $origin: _origin,
    $key: _key,
    $collectionId: _collectionId,
    ...rest
  } = value as Record<string, unknown>
  return rest as T
}

// Usage in tests
const item = collection.get('1')!
expect(stripVirtualProps(item)).toEqual({
  id: '1',
  name: 'Alice',
  age: 30,
})
```

Alternatively, use `toMatchObject` which ignores extra properties:

```ts
expect(collection.get('1')).toMatchObject({
  id: '1',
  name: 'Alice',
  age: 30,
})
```

## Tips

- **Use `stateWhenReady()`** to wait for a collection to finish its initial sync before asserting: `await collection.stateWhenReady()`
- **Use `toMatchObject`** instead of `toEqual` to avoid needing to match virtual properties
- **Each test should create its own collection** with a unique `id` to avoid state leakage between tests
- **For async tests**, each framework has its own reactivity flush mechanism:
  - React: `waitFor` from `@testing-library/react`
  - Vue: `nextTick()` + small delay
  - Svelte: `flushSync()` from `svelte`
  - Solid: `waitFor` from `@solidjs/testing-library`
  - Angular: `setTimeout` + `TestBed.runInInjectionContext`
- **Collection-level tests don't need a framework** — you can test `createCollection`, mutations, and live queries directly without any UI framework
