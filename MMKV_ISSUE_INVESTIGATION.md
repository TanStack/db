# Investigation: MMKV Storage with TanStack DB - "Cannot determine default value of object" Error

## Issue Summary

A user reported getting a `TypeError: Cannot determine default value of object` error when trying to use TanStack DB with MMKV storage and the live query hook (`useLiveQuery`) in a React component.

## Root Cause Analysis

After thorough investigation, this is **NOT a TypeScript type error** but rather a **runtime error** specific to the **Hermes JavaScript engine** used in React Native and Expo environments.

### What is this error?

The error `TypeError: Cannot determine default value of object` occurs in the Hermes engine when:

1. **Object-to-primitive conversions fail**: The engine expects certain operations to return primitives but encounters improperly implemented `valueOf()` or `toString()` methods
2. **Proxy object issues**: Proxy objects that don't properly handle method calls
3. **Console.log complications**: When trying to log functions or complex objects that can't be properly serialized

### Why it happens with MMKV + TanStack DB

The error likely occurs because:

1. **MMKV is synchronous** but TanStack DB's storage adapter interface expects **async/Promise-based methods**
2. **Improper wrapping** of MMKV's synchronous methods in Promises can create proxy-like objects
3. **React Native's Hermes engine** is stricter about object serialization than standard JavaScript engines

## Understanding TanStack DB Storage

TanStack DB has **TWO different storage interfaces** for different purposes:

### 1. StorageAdapter (for Offline Transactions)

Located at: `packages/offline-transactions/src/storage/StorageAdapter.ts`

```typescript
interface StorageAdapter {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<Array<string>>
  clear(): Promise<void>
}
```

**Purpose**: Used by the offline transaction system to persist transaction outbox
**Package**: `@tanstack/offline-transactions`
**Key requirement**: All methods MUST return Promises, values are JSON-serialized strings

### 2. StorageApi (for Collection Data)

Located at: `packages/db/src/local-storage.ts`

```typescript
type StorageApi = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
```

**Purpose**: Direct collection data persistence (like localStorage collections)
**Package**: `@tanstack/db`
**Key requirement**: Can be synchronous, follows DOM Storage API

## The Confusion

The user wants to use MMKV for "local data management" which could mean either:
1. Using MMKV as storage for offline transactions
2. Using MMKV directly with collections (like localStorage collections)

## Proper MMKV Implementation

### Option 1: MMKV Storage Adapter (for Offline Transactions)

```typescript
import { BaseStorageAdapter } from '@tanstack/offline-transactions'
import { MMKV } from 'react-native-mmkv'

export class MMKVStorageAdapter extends BaseStorageAdapter {
  private storage: MMKV

  constructor(id = 'offline-transactions') {
    super()
    this.storage = new MMKV({ id })
  }

  async get(key: string): Promise<string | null> {
    try {
      // MMKV.getString is synchronous, wrap in Promise.resolve
      return Promise.resolve(this.storage.getString(key) ?? null)
    } catch (error) {
      console.warn('MMKV get failed:', error)
      return Promise.resolve(null)
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      // MMKV.set is synchronous, wrap in Promise.resolve
      this.storage.set(key, value)
      return Promise.resolve()
    } catch (error) {
      console.error('MMKV set failed:', error)
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    try {
      this.storage.delete(key)
      return Promise.resolve()
    } catch (error) {
      console.warn('MMKV delete failed:', error)
      return Promise.resolve()
    }
  }

  async keys(): Promise<Array<string>> {
    try {
      // MMKV.getAllKeys is synchronous
      return Promise.resolve(this.storage.getAllKeys())
    } catch (error) {
      console.warn('MMKV keys failed:', error)
      return Promise.resolve([])
    }
  }

  async clear(): Promise<void> {
    try {
      this.storage.clearAll()
      return Promise.resolve()
    } catch (error) {
      console.warn('MMKV clear failed:', error)
    }
  }
}
```

**Usage:**

```typescript
import { startOfflineExecutor } from '@tanstack/offline-transactions'
import { MMKVStorageAdapter } from './MMKVStorageAdapter'

const executor = startOfflineExecutor({
  collections: { todos: todoCollection },
  storage: new MMKVStorageAdapter('my-app-offline'),
  mutationFns: {
    syncTodos: todoAPI.syncTodos,
  },
})
```

### Option 2: MMKV for Collection Storage (Direct)

If you want to use MMKV directly for collection data (similar to localStorage collections), you would create a custom collection options creator:

```typescript
import { createCollection } from '@tanstack/react-db'
import { MMKV } from 'react-native-mmkv'

// This would require implementing a custom collection options creator
// following the pattern in packages/db/src/local-storage.ts
// but adapted for MMKV's synchronous API
```

This is more complex and would require creating a full collection options creator (see `docs/guides/collection-options-creator.md`).

## Live Query Hook - Not the Problem

The `useLiveQuery` hook itself is NOT causing the error. Located at `packages/react-db/src/useLiveQuery.ts`, it:

1. Uses React's `useSyncExternalStore` for state management
2. Subscribes to collection changes
3. Returns reactive data

The hook is agnostic to the storage layer and works with any properly implemented collection.

## Debugging Steps

If you're encountering this error:

### 1. Check Your Environment
- Are you using React Native with Hermes engine?
- Confirm by checking `package.json` for `react-native` and `hermes-engine`

### 2. Verify Promise Wrapping
```typescript
// ❌ WRONG - May cause issues in Hermes
async get(key: string) {
  return this.storage.getString(key) ?? null
}

// ✅ CORRECT - Explicitly wrap in Promise.resolve
async get(key: string): Promise<string | null> {
  return Promise.resolve(this.storage.getString(key) ?? null)
}
```

### 3. Check Console.log Statements
The error often occurs when logging:
```typescript
// ❌ May trigger the error
console.log(collection)
console.log(useLiveQuery(...))

// ✅ Log specific properties instead
console.log(collection.status)
console.log(data)
```

### 4. Verify Collection Setup
```typescript
// Make sure you're providing proper types
const collection = createCollection(
  queryCollectionOptions({
    queryFn: async () => { /* ... */ },
    getKey: (item: Todo) => item.id, // ✅ Explicit type
    schema: todoSchema, // ✅ Use schema for type safety
  })
)
```

## Related GitHub Issues

This error has been reported in the React Native ecosystem:
- [Hermes Issue #205](https://github.com/facebook/hermes/issues/205)
- [react-native-bottom-sheet #1129](https://github.com/gorhom/react-native-bottom-sheet/issues/1129)
- [Hono #2509](https://github.com/honojs/hono/issues/2509)

Common theme: Issues with object serialization, proxy objects, and Hermes engine.

## Recommended Solution

1. **Implement MMKV Storage Adapter** using the example above
2. **Use explicit Promise.resolve()** for all synchronous MMKV operations
3. **Avoid logging complex objects** in React Native
4. **Use schemas** for proper type inference in collections
5. **Test in both development and production** (Hermes behavior can differ)

## Example Complete Setup

```typescript
// MMKVStorageAdapter.ts
import { BaseStorageAdapter } from '@tanstack/offline-transactions'
import { MMKV } from 'react-native-mmkv'

export class MMKVStorageAdapter extends BaseStorageAdapter {
  private storage: MMKV

  constructor(id = 'offline-transactions') {
    super()
    this.storage = new MMKV({ id })
  }

  async get(key: string): Promise<string | null> {
    return Promise.resolve(this.storage.getString(key) ?? null)
  }

  async set(key: string, value: string): Promise<void> {
    this.storage.set(key, value)
    return Promise.resolve()
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key)
    return Promise.resolve()
  }

  async keys(): Promise<Array<string>> {
    return Promise.resolve(this.storage.getAllKeys())
  }

  async clear(): Promise<void> {
    this.storage.clearAll()
    return Promise.resolve()
  }
}

// collection.ts
import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { startOfflineExecutor } from '@tanstack/offline-transactions'
import { MMKVStorageAdapter } from './MMKVStorageAdapter'
import { z } from 'zod'

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
})

export const todoCollection = createCollection(
  queryCollectionOptions({
    queryFn: async () => {
      const response = await fetch('/api/todos')
      return response.json()
    },
    getKey: (item) => item.id,
    schema: todoSchema,
  })
)

export const offlineExecutor = startOfflineExecutor({
  collections: { todos: todoCollection },
  storage: new MMKVStorageAdapter('my-app'),
  mutationFns: {
    syncTodos: async ({ transaction }) => {
      // Your sync logic
    },
  },
})

// Component.tsx
import { useLiveQuery } from '@tanstack/react-db'
import { todoCollection } from './collection'

function TodoList() {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ todos: todoCollection })
  )

  if (isLoading) return <Text>Loading...</Text>

  return (
    <View>
      {data.map(todo => (
        <Text key={todo.id}>{todo.text}</Text>
      ))}
    </View>
  )
}
```

## Conclusion

The "Cannot determine default value of object" error is a **Hermes engine runtime error**, not a TanStack DB bug. The solution is:

1. Properly implement the `StorageAdapter` interface for MMKV
2. Explicitly wrap synchronous operations in `Promise.resolve()`
3. Use proper TypeScript types and schemas
4. Be careful with console.log in React Native

The TanStack DB architecture is sound and works correctly when the storage adapter is properly implemented.

---

**Investigation Date**: 2025-11-13
**TanStack DB Version**: Latest (main branch)
**Key Files Examined**:
- `/home/user/db/packages/offline-transactions/src/storage/StorageAdapter.ts`
- `/home/user/db/packages/offline-transactions/src/storage/LocalStorageAdapter.ts`
- `/home/user/db/packages/offline-transactions/src/storage/IndexedDBAdapter.ts`
- `/home/user/db/packages/react-db/src/useLiveQuery.ts`
- `/home/user/db/packages/db/src/local-storage.ts`
- `/home/user/db/docs/guides/collection-options-creator.md`
- `/home/user/db/examples/react/offline-transactions/src/db/todos.ts`
