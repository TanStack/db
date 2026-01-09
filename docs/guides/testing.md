---
title: Testing
id: testing
---

# Testing TanStack DB

This guide covers best practices for testing applications that use TanStack DB collections and live queries. We'll focus on unit testing with Vitest and React Testing Library, though these patterns apply to other testing frameworks as well.

## Table of Contents

- [Core Testing Principles](#core-testing-principles)
- [Creating Test Collections](#creating-test-collections)
- [Testing React Hooks](#testing-react-hooks)
- [Testing Live Query Updates](#testing-live-query-updates)
- [Dependency Injection Pattern](#dependency-injection-pattern)
- [Testing Mutations](#testing-mutations)
- [Common Issues and Solutions](#common-issues-and-solutions)
- [Complete Example](#complete-example)

## Core Testing Principles

When testing TanStack DB:

1. **Create fresh collections per test** - Don't use singleton collections across tests
2. **Use `localOnlyCollectionOptions`** - Replace server-synced collections with local-only versions for isolated tests
3. **Let React handle cleanup** - React Testing Library's `unmount` properly cleans up subscriptions
4. **Disable garbage collection** - Use `gcTime: 0` to prevent timing-related issues

## Creating Test Collections

### Using localOnlyCollectionOptions

The simplest approach is to use `localOnlyCollectionOptions` with initial data:

```typescript
import { createCollection } from '@tanstack/db'
import { localOnlyCollectionOptions } from '@tanstack/db'

// Create a fresh collection for each test
function createTestUsersCollection(initialData: User[] = []) {
  return createCollection(
    localOnlyCollectionOptions({
      id: `test-users-${Math.random()}`, // Unique ID per test
      getKey: (user) => user.id,
      initialData,
    })
  )
}

describe('UserList', () => {
  it('should filter active users', async () => {
    const usersCollection = createTestUsersCollection([
      { id: '1', name: 'Alice', active: true },
      { id: '2', name: 'Bob', active: false },
      { id: '3', name: 'Charlie', active: true },
    ])

    // Test with the fresh collection...
  })
})
```

### Using mockSyncCollectionOptions (Internal Testing Utility)

TanStack DB's internal tests use a `mockSyncCollectionOptions` helper that provides more control over sync behavior. You can create a similar utility:

```typescript
import { createCollection, type CollectionConfig } from '@tanstack/db'

type MockCollectionConfig<T extends object> = {
  id: string
  getKey: (item: T) => string | number
  initialData?: T[]
}

export function createMockCollection<T extends object>(
  config: MockCollectionConfig<T>
) {
  let begin: () => void
  let write: (op: { type: 'insert' | 'update' | 'delete'; value: T }) => void
  let commit: () => void

  const collection = createCollection<T>({
    id: config.id,
    getKey: config.getKey,
    gcTime: 0, // Disable GC for tests
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit

        // Load initial data
        if (config.initialData) {
          begin()
          config.initialData.forEach((item) => {
            write({ type: 'insert', value: item })
          })
          commit()
          params.markReady()
        } else {
          params.markReady()
        }
      },
    },
    onInsert: async () => {},
    onUpdate: async () => {},
    onDelete: async () => {},
  })

  return {
    collection,
    // Expose utils to simulate sync changes in tests
    utils: {
      begin: () => begin(),
      write: (op: { type: 'insert' | 'update' | 'delete'; value: T }) => write(op),
      commit: () => commit(),
      // Helper to insert data after initial load
      insert: (item: T) => {
        begin()
        write({ type: 'insert', value: item })
        commit()
      },
      update: (item: T) => {
        begin()
        write({ type: 'update', value: item })
        commit()
      },
      delete: (item: T) => {
        begin()
        write({ type: 'delete', value: item })
        commit()
      },
    },
  }
}
```

## Testing React Hooks

### Basic Hook Testing

Use `renderHook` from React Testing Library to test hooks that use `useLiveQuery`:

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { useLiveQuery, createCollection, eq } from '@tanstack/react-db'
import { localOnlyCollectionOptions } from '@tanstack/react-db'

type Todo = {
  id: string
  text: string
  completed: boolean
}

describe('useTodos', () => {
  it('should return incomplete todos', async () => {
    const todosCollection = createCollection(
      localOnlyCollectionOptions<Todo>({
        id: 'test-todos',
        getKey: (todo) => todo.id,
        initialData: [
          { id: '1', text: 'Buy milk', completed: false },
          { id: '2', text: 'Walk dog', completed: true },
          { id: '3', text: 'Write tests', completed: false },
        ],
      })
    )

    const { result } = renderHook(() =>
      useLiveQuery((q) =>
        q
          .from({ todo: todosCollection })
          .where(({ todo }) => eq(todo.completed, false))
      )
    )

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2)
    })

    expect(result.current.data.map((t) => t.text)).toEqual([
      'Buy milk',
      'Write tests',
    ])
  })
})
```

### Testing with Query Parameters

Test how your queries respond to parameter changes:

```tsx
import { renderHook, waitFor, act } from '@testing-library/react'
import { useLiveQuery, createCollection, gt } from '@tanstack/react-db'
import { localOnlyCollectionOptions } from '@tanstack/react-db'

type Product = {
  id: string
  name: string
  price: number
}

describe('useProducts', () => {
  it('should filter products by minimum price', async () => {
    const productsCollection = createCollection(
      localOnlyCollectionOptions<Product>({
        id: 'test-products',
        getKey: (p) => p.id,
        initialData: [
          { id: '1', name: 'Widget', price: 10 },
          { id: '2', name: 'Gadget', price: 25 },
          { id: '3', name: 'Gizmo', price: 50 },
        ],
      })
    )

    const { result, rerender } = renderHook(
      ({ minPrice }: { minPrice: number }) =>
        useLiveQuery(
          (q) =>
            q
              .from({ product: productsCollection })
              .where(({ product }) => gt(product.price, minPrice)),
          [minPrice]
        ),
      { initialProps: { minPrice: 20 } }
    )

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2) // Gadget and Gizmo
    })

    // Change the parameter
    act(() => {
      rerender({ minPrice: 40 })
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1) // Only Gizmo
    })

    expect(result.current.data[0].name).toBe('Gizmo')
  })
})
```

## Testing Live Query Updates

Test that live queries properly react to data changes:

```tsx
import { renderHook, waitFor, act } from '@testing-library/react'
import { useLiveQuery, createCollection, gt } from '@tanstack/react-db'
import { localOnlyCollectionOptions } from '@tanstack/react-db'

describe('Live Updates', () => {
  it('should update when data is inserted', async () => {
    const usersCollection = createCollection(
      localOnlyCollectionOptions({
        id: 'test-users',
        getKey: (user) => user.id,
        initialData: [{ id: '1', name: 'Alice', age: 30 }],
      })
    )

    const { result } = renderHook(() =>
      useLiveQuery((q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => gt(user.age, 25))
      )
    )

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1)
    })

    // Insert a new user
    act(() => {
      usersCollection.insert({ id: '2', name: 'Bob', age: 35 })
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2)
    })

    // Insert a user that doesn't match the filter
    act(() => {
      usersCollection.insert({ id: '3', name: 'Charlie', age: 20 })
    })

    // Still only 2 results (Charlie doesn't match age > 25)
    await waitFor(() => {
      expect(result.current.data).toHaveLength(2)
    })
  })

  it('should update when data is modified', async () => {
    const todosCollection = createCollection(
      localOnlyCollectionOptions({
        id: 'test-todos',
        getKey: (todo) => todo.id,
        initialData: [
          { id: '1', text: 'Task 1', completed: false },
          { id: '2', text: 'Task 2', completed: false },
        ],
      })
    )

    const { result } = renderHook(() =>
      useLiveQuery((q) =>
        q
          .from({ todo: todosCollection })
          .where(({ todo }) => eq(todo.completed, false))
      )
    )

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2)
    })

    // Complete a todo
    act(() => {
      todosCollection.update('1', (draft) => {
        draft.completed = true
      })
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1)
    })

    expect(result.current.data[0].id).toBe('2')
  })

  it('should update when data is deleted', async () => {
    const itemsCollection = createCollection(
      localOnlyCollectionOptions({
        id: 'test-items',
        getKey: (item) => item.id,
        initialData: [
          { id: '1', name: 'Item 1' },
          { id: '2', name: 'Item 2' },
        ],
      })
    )

    const { result } = renderHook(() =>
      useLiveQuery((q) => q.from({ item: itemsCollection }))
    )

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2)
    })

    // Delete an item
    act(() => {
      itemsCollection.delete('1')
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1)
    })
  })
})
```

## Dependency Injection Pattern

For hooks that internally use collections, use dependency injection to make them testable:

### Before (Hard to Test)

```typescript
// hooks/useTodos.ts - Using a singleton (hard to test)
import { todosCollection } from '../collections/todos'

export function useTodos() {
  return useLiveQuery((q) =>
    q.from({ todo: todosCollection })
  )
}
```

### After (Easy to Test)

```typescript
// hooks/useTodos.ts - Using dependency injection
import { todosCollection as defaultCollection } from '../collections/todos'
import type { Collection } from '@tanstack/db'

export function useTodos(
  collection: Collection<Todo> = defaultCollection
) {
  return useLiveQuery((q) =>
    q.from({ todo: collection })
  )
}

// In tests:
const testCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'test-todos',
    getKey: (t) => t.id,
    initialData: testData,
  })
)

renderHook(() => useTodos(testCollection))
```

### Factory Pattern for Collections

Create factory functions instead of singleton exports:

```typescript
// collections/todos.ts
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

export type Todo = {
  id: string
  text: string
  completed: boolean
}

export function createTodosCollection() {
  return createCollection(
    queryCollectionOptions<Todo>({
      queryKey: ['todos'],
      queryFn: () => fetch('/api/todos').then((r) => r.json()),
      getKey: (todo) => todo.id,
    })
  )
}

// Default singleton for production
export const todosCollection = createTodosCollection()
```

```typescript
// In tests - create fresh instances
import { createCollection } from '@tanstack/db'
import { localOnlyCollectionOptions } from '@tanstack/db'
import type { Todo } from '../collections/todos'

function createTestTodosCollection(initialData: Todo[] = []) {
  return createCollection(
    localOnlyCollectionOptions<Todo>({
      id: `test-todos-${Date.now()}`,
      getKey: (todo) => todo.id,
      initialData,
    })
  )
}
```

## Testing Mutations

### Testing Insert Operations

```tsx
import { renderHook, waitFor, act } from '@testing-library/react'

describe('Mutations', () => {
  it('should handle insert mutations', async () => {
    const collection = createCollection(
      localOnlyCollectionOptions({
        id: 'test-items',
        getKey: (item) => item.id,
        initialData: [],
      })
    )

    const { result } = renderHook(() =>
      useLiveQuery((q) => q.from({ item: collection }))
    )

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    expect(result.current.data).toHaveLength(0)

    act(() => {
      collection.insert({ id: '1', name: 'New Item' })
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1)
    })

    expect(result.current.data[0]).toMatchObject({
      id: '1',
      name: 'New Item',
    })
  })
})
```

### Testing Update Operations

```tsx
it('should handle update mutations', async () => {
  const collection = createCollection(
    localOnlyCollectionOptions({
      id: 'test-items',
      getKey: (item) => item.id,
      initialData: [{ id: '1', name: 'Original', count: 0 }],
    })
  )

  const { result } = renderHook(() =>
    useLiveQuery((q) => q.from({ item: collection }))
  )

  await waitFor(() => {
    expect(result.current.data).toHaveLength(1)
  })

  act(() => {
    collection.update('1', (draft) => {
      draft.name = 'Updated'
      draft.count = 5
    })
  })

  await waitFor(() => {
    expect(result.current.data[0]).toMatchObject({
      id: '1',
      name: 'Updated',
      count: 5,
    })
  })
})
```

## Common Issues and Solutions

### Issue: Collections Not Resetting Between Tests

**Problem:** Using singleton collections causes state to leak between tests.

**Solution:** Create fresh collections in each test:

```typescript
// Bad - singleton shared across tests
const collection = createCollection(...)

describe('Tests', () => {
  it('test 1', () => { /* uses shared collection */ })
  it('test 2', () => { /* state from test 1 leaks here */ })
})

// Good - fresh collection per test
describe('Tests', () => {
  it('test 1', () => {
    const collection = createCollection(...)
    // isolated test
  })

  it('test 2', () => {
    const collection = createCollection(...)
    // isolated test
  })
})
```

### Issue: cleanup() Fails with Active Subscriptions

**Problem:** Calling `collection.cleanup()` in `afterEach` fails because live queries still have active subscriptions.

**Solution:** Let React Testing Library handle cleanup. When `renderHook` unmounts, subscriptions are automatically cleaned up:

```typescript
// Don't do this
afterEach(async () => {
  await collection.cleanup() // May fail with active subscriptions
})

// Do this instead
describe('Tests', () => {
  it('test', async () => {
    const collection = createCollection(...)
    const { result, unmount } = renderHook(() => useLiveQuery(...))

    // Test assertions...

    // unmount() is called automatically after the test
    // which cleans up subscriptions properly
  })
})
```

### Issue: Timing Issues with Async Updates

**Problem:** Tests fail because assertions run before data updates propagate.

**Solution:** Use `waitFor` to wait for expected state:

```typescript
// Bad - may fail due to timing
act(() => {
  collection.insert({ id: '1', name: 'Test' })
})
expect(result.current.data).toHaveLength(1) // May fail!

// Good - wait for the update
act(() => {
  collection.insert({ id: '1', name: 'Test' })
})
await waitFor(() => {
  expect(result.current.data).toHaveLength(1)
})
```

### Issue: GC Timers Causing Cleanup Issues

**Problem:** Garbage collection timers fire during tests causing unexpected behavior.

**Solution:** Disable GC with `gcTime: 0`:

```typescript
const collection = createCollection(
  localOnlyCollectionOptions({
    id: 'test',
    getKey: (item) => item.id,
    gcTime: 0, // Disable garbage collection
    initialData: [...],
  })
)
```

### Issue: vi.resetModules() Not Working

**Problem:** Using `vi.resetModules()` doesn't reset collection state because the collection is already instantiated.

**Solution:** Use factory functions or dependency injection instead of module-level singletons:

```typescript
// collections.ts
export const createUsersCollection = () => createCollection({...})

// For production, create singleton
export const usersCollection = createUsersCollection()

// In tests, create fresh instances
const testCollection = createCollection(localOnlyCollectionOptions({...}))
```

## Complete Example

Here's a complete test file demonstrating all the patterns:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { createCollection, useLiveQuery, eq, gt } from '@tanstack/react-db'
import { localOnlyCollectionOptions } from '@tanstack/react-db'

type User = {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
  active: boolean
}

// Factory function for creating test collections
function createTestUsersCollection(initialData: User[] = []) {
  return createCollection(
    localOnlyCollectionOptions<User>({
      id: `test-users-${Math.random()}`,
      getKey: (user) => user.id,
      initialData,
    })
  )
}

// Sample test data
const sampleUsers: User[] = [
  { id: '1', name: 'Alice', email: 'alice@example.com', role: 'admin', active: true },
  { id: '2', name: 'Bob', email: 'bob@example.com', role: 'user', active: true },
  { id: '3', name: 'Charlie', email: 'charlie@example.com', role: 'user', active: false },
]

describe('User Management', () => {
  describe('Filtering', () => {
    it('should filter active users', async () => {
      const collection = createTestUsersCollection(sampleUsers)

      const { result } = renderHook(() =>
        useLiveQuery((q) =>
          q
            .from({ user: collection })
            .where(({ user }) => eq(user.active, true))
        )
      )

      await waitFor(() => {
        expect(result.current.data).toHaveLength(2)
      })

      expect(result.current.data.map((u) => u.name)).toEqual(['Alice', 'Bob'])
    })

    it('should filter by role', async () => {
      const collection = createTestUsersCollection(sampleUsers)

      const { result } = renderHook(() =>
        useLiveQuery((q) =>
          q
            .from({ user: collection })
            .where(({ user }) => eq(user.role, 'admin'))
        )
      )

      await waitFor(() => {
        expect(result.current.data).toHaveLength(1)
      })

      expect(result.current.data[0].name).toBe('Alice')
    })
  })

  describe('Live Updates', () => {
    it('should react to inserts', async () => {
      const collection = createTestUsersCollection(sampleUsers)

      const { result } = renderHook(() =>
        useLiveQuery((q) =>
          q
            .from({ user: collection })
            .where(({ user }) => eq(user.role, 'admin'))
        )
      )

      await waitFor(() => {
        expect(result.current.data).toHaveLength(1)
      })

      act(() => {
        collection.insert({
          id: '4',
          name: 'Diana',
          email: 'diana@example.com',
          role: 'admin',
          active: true,
        })
      })

      await waitFor(() => {
        expect(result.current.data).toHaveLength(2)
      })
    })

    it('should react to updates that change filter results', async () => {
      const collection = createTestUsersCollection(sampleUsers)

      const { result } = renderHook(() =>
        useLiveQuery((q) =>
          q
            .from({ user: collection })
            .where(({ user }) => eq(user.active, true))
        )
      )

      await waitFor(() => {
        expect(result.current.data).toHaveLength(2)
      })

      // Deactivate Bob
      act(() => {
        collection.update('2', (draft) => {
          draft.active = false
        })
      })

      await waitFor(() => {
        expect(result.current.data).toHaveLength(1)
      })

      expect(result.current.data[0].name).toBe('Alice')
    })

    it('should react to deletes', async () => {
      const collection = createTestUsersCollection(sampleUsers)

      const { result } = renderHook(() =>
        useLiveQuery((q) => q.from({ user: collection }))
      )

      await waitFor(() => {
        expect(result.current.data).toHaveLength(3)
      })

      act(() => {
        collection.delete('2')
      })

      await waitFor(() => {
        expect(result.current.data).toHaveLength(2)
      })
    })
  })

  describe('Query Status', () => {
    it('should track loading state', async () => {
      const collection = createTestUsersCollection(sampleUsers)

      const { result } = renderHook(() =>
        useLiveQuery((q) => q.from({ user: collection }))
      )

      // Eventually becomes ready
      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
        expect(result.current.isLoading).toBe(false)
      })
    })

    it('should provide status information', async () => {
      const collection = createTestUsersCollection(sampleUsers)

      const { result } = renderHook(() =>
        useLiveQuery((q) => q.from({ user: collection }))
      )

      await waitFor(() => {
        expect(result.current.status).toBe('ready')
      })
    })
  })

  describe('Parameterized Queries', () => {
    it('should recompute when parameters change', async () => {
      const collection = createTestUsersCollection(sampleUsers)

      const { result, rerender } = renderHook(
        ({ role }: { role: 'admin' | 'user' }) =>
          useLiveQuery(
            (q) =>
              q
                .from({ user: collection })
                .where(({ user }) => eq(user.role, role)),
            [role]
          ),
        { initialProps: { role: 'admin' as const } }
      )

      await waitFor(() => {
        expect(result.current.data).toHaveLength(1) // Alice only
      })

      act(() => {
        rerender({ role: 'user' })
      })

      await waitFor(() => {
        expect(result.current.data).toHaveLength(2) // Bob and Charlie
      })
    })
  })
})
```

## Learn More

- [Live Queries](./live-queries.md) - Complete guide to querying data
- [Mutations](./mutations.md) - Guide to inserting, updating, and deleting data
- [LocalOnly Collection](../collections/local-only-collection.md) - In-memory collections for testing
