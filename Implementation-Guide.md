# Implementation Guide: QueryObserver Reference Counting and Row-Level GC

## Background

### The Problem We're Solving

When using TanStack Query collections with live queries, we need to manage the lifecycle of query data properly:

1. **Component remounts should preserve cached data** - When a component unmounts and remounts quickly (< `gcTime`), it should show cached data immediately without refetching
2. **Multiple queries can share the same QueryObserver** - When two live queries have identical predicates, they should share the same TanStack Query observer
3. **Row-level garbage collection** - When all queries that reference a row are gone, that row should be removed from the source collection
4. **Clean interaction with TanStack Query's cache** - The collection should respect `gcTime`, `staleTime`, and `invalidateQueries` behavior

### The Core Challenge

The tricky part is handling **`invalidateQueries`**. When you call:

```typescript
await queryClient.invalidateQueries({ queryKey: ['users'] })
```

TanStack Query internally does this:
1. Marks the query as stale
2. **Unsubscribes** the current observer (triggers our `unloadSubset`)
3. **Resubscribes** with a new observer (triggers our `loadSubset`)
4. Fetches fresh data

During step 2, our reference count temporarily drops to 0. If we immediately delete rows, the source collection breaks and step 3 fails!

## Architecture Overview

### Key Components

**TanStack DB Collections:**
- `Collection` - In-memory store of rows with transactions, indexes, and change events
- `Subscription` - Connects live queries to collections, tracks `loadSubset` calls
- `SyncConfig` - Interface for loading/unloading data subsets

**TanStack Query:**
- `QueryClient` - Manages query cache and orchestrates invalidation
- `QueryObserver` - Subscribes to query results, has `hasListeners()` method
- `QueryCache` - Emits 'removed' events when queries are GC'd

**Our Integration:**
- `queryCollectionOptions()` - Returns a `SyncConfig` that bridges TanStack Query to Collections
- Reference counting - Tracks how many subscriptions use each QueryObserver
- Row-level tracking - Maps queries ↔ rows for precise garbage collection

### Data Flow

```
Live Query (Component)
    ↓ subscribe
Subscription
    ↓ requestSnapshot
Collection._sync.loadSubset(options)
    ↓
queryCollectionOptions.loadSubset
    ↓ compute queryKey from options
    ↓ check if QueryObserver exists
QueryObserver (TanStack Query)
    ↓ subscribe
    ↓ fetch data
Collection (begin/write/commit)
    ↓ emit changes
Subscription callback
    ↓
Live Query receives update
```

### Critical Insight: The Subscription Lifecycle

When a `CollectionSubscription` unsubscribes (line 435-442 in subscription.ts):

```typescript
unsubscribe() {
  // Unload all subsets that this subscription loaded
  for (const subset of this.loadedSubsets) {
    this.collection._sync.unloadSubset({
      ...subset,
      subscription: this,
    })
  }
  this.loadedSubsets = []
  this.emit(`unsubscribed`, { ... })
}
```

This creates a **symmetric pairing**: every `loadSubset` call is matched with a corresponding `unloadSubset` call with the same options. This is the foundation for reference counting.

## Milestone 1: Basic Query Collection Integration

**Goal:** Get TanStack Query working as a data source for collections, without reference counting yet.

### What to Implement

Create `packages/query-db-collection/src/query.ts` with a basic `queryCollectionOptions` function:

```typescript
import { QueryClient, QueryObserver, hashKey } from '@tanstack/query-core'
import type { SyncConfig } from '@tanstack/db'

export type QueryCollectionOptions = {
  id: string
  queryClient: QueryClient
  queryKey: any[] // Static query key
  queryFn: (context: any) => Promise<Array<any>>
  getKey: (item: any) => string | number
}

export function queryCollectionOptions(options: QueryCollectionOptions): SyncConfig {
  const { queryClient, queryKey, queryFn, getKey } = options

  return {
    sync: ({ begin, write, commit, markReady }) => {
      // Create a QueryObserver
      const observer = new QueryObserver(queryClient, {
        queryKey,
        queryFn,
      })

      // Subscribe to query results
      const unsubscribe = observer.subscribe((result) => {
        if (result.isSuccess && result.data) {
          // Write data to collection
          begin()
          for (const item of result.data) {
            write({ type: 'insert', value: item })
          }
          commit()
          markReady()
        }
      })

      // Return cleanup function
      return () => {
        unsubscribe()
      }
    },
    getSyncMetadata: () => ({}),
  }
}
```

### How to Test

Create a simple test in `packages/query-db-collection/tests/query.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createCollection } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { queryCollectionOptions } from '../src/query'

describe('Basic Query Integration', () => {
  it('should load data from queryFn into collection', async () => {
    const queryClient = new QueryClient()
    const mockData = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]

    const collection = createCollection(
      queryCollectionOptions({
        id: 'users',
        queryClient,
        queryKey: ['users'],
        queryFn: async () => mockData,
        getKey: (item) => item.id,
      })
    )

    await collection.preload()

    expect(collection.size).toBe(2)
    expect(collection.get(1)).toEqual({ id: 1, name: 'Alice' })
    expect(collection.get(2)).toEqual({ id: 2, name: 'Bob' })
  })
})
```

### Expected Behavior

✅ Test passes
✅ Collection loads data from TanStack Query
✅ `collection.size` equals the number of items

### What We Learned

- TanStack Query's `QueryObserver` is the bridge between queries and collections
- The `subscribe` callback receives results as they arrive
- We use `begin/write/commit` to batch inserts into the collection

---

## Milestone 2: On-Demand Mode with Dynamic QueryKeys

**Goal:** Support `syncMode: 'on-demand'` where different predicates create different TanStack Query observers.

### Why This Matters

In eager mode, there's one query that loads everything. In on-demand mode, each live query with different predicates (e.g., `category = 'A'` vs `category = 'B'`) should create a separate TanStack Query observer with a unique cache key.

### What to Implement

1. Add support for function-based `queryKey`:

```typescript
export type QueryCollectionOptions = {
  // ... existing fields
  syncMode?: 'eager' | 'on-demand'
  queryKey:
    | any[] // Static (for eager mode)
    | ((options: LoadSubsetOptions) => any[]) // Dynamic (for on-demand)
}
```

2. Implement `generateQueryKeyFromOptions`:

```typescript
import type { LoadSubsetOptions } from '@tanstack/db'
import { serializeExpression } from './serialize' // You'll need to implement this

function generateQueryKeyFromOptions(
  baseQueryKey: any[] | ((options: LoadSubsetOptions) => any[]),
  options: LoadSubsetOptions
): any[] {
  if (typeof baseQueryKey === 'function') {
    return baseQueryKey(options)
  }

  // For static queryKey in on-demand mode, append serialized predicates
  const serialized = {
    ...(options.where && { where: serializeExpression(options.where) }),
    ...(options.orderBy && { orderBy: options.orderBy }),
    ...(options.limit && { limit: options.limit }),
  }

  return [...baseQueryKey, serialized]
}
```

3. Implement `loadSubset`:

```typescript
export function queryCollectionOptions(options: QueryCollectionOptions): SyncConfig {
  const { queryClient, queryKey, queryFn, getKey, syncMode = 'eager' } = options
  const observers = new Map<string, QueryObserver>()

  return {
    sync: ({ begin, write, commit, markReady }) => {
      // ... existing eager mode setup

      const loadSubset = (loadOptions: LoadSubsetOptions) => {
        const key = generateQueryKeyFromOptions(queryKey, loadOptions)
        const hashedKey = hashKey(key)

        // If observer already exists, reuse it
        if (observers.has(hashedKey)) {
          return true
        }

        // Create new observer for this predicate
        const observer = new QueryObserver(queryClient, {
          queryKey: key,
          queryFn: (context) => queryFn({ ...context, meta: { loadSubsetOptions: loadOptions } }),
        })

        observers.set(hashedKey, observer)

        // Subscribe to results
        const unsubscribe = observer.subscribe((result) => {
          if (result.isSuccess && result.data) {
            begin()
            for (const item of result.data) {
              write({ type: 'insert', value: item })
            }
            commit()
          }
        })

        return true
      }

      return {
        cleanup: () => {
          // Unsubscribe all observers
          observers.clear()
        },
        loadSubset: syncMode === 'eager' ? undefined : loadSubset,
      }
    },
  }
}
```

### How to Test

```typescript
it('should create separate observers for different predicates', async () => {
  const queryClient = new QueryClient()
  const allData = [
    { id: 1, category: 'A' },
    { id: 2, category: 'B' },
    { id: 3, category: 'A' },
  ]

  const collection = createCollection(
    queryCollectionOptions({
      id: 'items-ondemand',
      queryClient,
      queryKey: (opts) => ['items', opts],
      syncMode: 'on-demand',
      queryFn: (ctx) => {
        const options = ctx.meta?.loadSubsetOptions
        // Filter by category
        return Promise.resolve(
          allData.filter(item => {
            // Apply predicate filtering logic here
            return true
          })
        )
      },
      getKey: (item) => item.id,
    })
  )

  // Manually trigger loadSubset (normally done by live query)
  await collection._sync.loadSubset({
    where: { /* category = 'A' predicate */ }
  })

  // Should only load category A items
  expect(collection.size).toBe(2)
})
```

### Expected Behavior

✅ Different predicates create different QueryObservers
✅ Each observer has a unique cache key
✅ Data is filtered based on predicates

---

## Milestone 3: Reference Counting Basics

**Goal:** Track how many subscriptions use each QueryObserver, and only cleanup when refcount reaches 0.

### Why This Matters

Multiple live queries can have identical predicates and should share the same QueryObserver. We need to count references to know when it's safe to cleanup.

### What to Implement

1. Add reference counting map:

```typescript
const queryRefCounts = new Map<string, number>()
```

2. Update `loadSubset` to increment refcount:

```typescript
const loadSubset = (loadOptions: LoadSubsetOptions) => {
  const key = generateQueryKeyFromOptions(queryKey, loadOptions)
  const hashedKey = hashKey(key)

  // Increment refcount
  const currentCount = queryRefCounts.get(hashedKey) || 0
  queryRefCounts.set(hashedKey, currentCount + 1)

  // If observer already exists, reuse it (don't create new one)
  if (observers.has(hashedKey)) {
    return true
  }

  // ... create new observer
}
```

3. Implement `unloadSubset`:

```typescript
const unloadSubset = (options: LoadSubsetOptions) => {
  const key = generateQueryKeyFromOptions(queryKey, options)
  const hashedKey = hashKey(key)

  // Decrement refcount
  const currentCount = queryRefCounts.get(hashedKey) || 0
  const newCount = currentCount - 1

  if (newCount <= 0) {
    // Refcount reached 0, cleanup observer
    queryRefCounts.delete(hashedKey)
    const observer = observers.get(hashedKey)
    if (observer) {
      // TODO: Unsubscribe from observer
      observers.delete(hashedKey)
    }
  } else {
    queryRefCounts.set(hashedKey, newCount)
  }
}
```

### How to Test

```typescript
it('should share observer for duplicate subset loads', () => {
  // Create collection with on-demand mode
  const collection = createCollection(queryCollectionOptions({ ... }))

  // Load same subset twice
  collection._sync.loadSubset({ where: categoryA })
  collection._sync.loadSubset({ where: categoryA })

  // Should only create 1 observer (checked via queryRefCounts or observers.size)

  // Unload once
  collection._sync.unloadSubset({ where: categoryA })

  // Observer should still exist (refcount = 1)

  // Unload again
  collection._sync.unloadSubset({ where: categoryA })

  // Now observer should be cleaned up (refcount = 0)
})
```

### Expected Behavior

✅ Duplicate `loadSubset` calls increment refcount but reuse observer
✅ `unloadSubset` decrements refcount
✅ Observer cleanup only happens when refcount = 0

---

## Milestone 4: Handle invalidateQueries (The Hard Part)

**Goal:** Prevent data loss during `invalidateQueries` unsub/resub cycles.

### The Problem in Detail

When you call `queryClient.invalidateQueries()`:

```
1. User calls invalidateQueries
2. TanStack Query marks observer as stale
3. Observer unsubscribes (internal cleanup)
   → Our unloadSubset is called
   → Refcount drops to 0
   → We cleanup and delete rows ❌ BREAKS THINGS
4. Observer resubscribes (starts refetch)
   → Our loadSubset is called
   → But rows are gone!
5. Fresh data arrives but collection is in error state
```

### The Solution: Use `hasListeners()`

The key insight: during `invalidateQueries`, the QueryObserver is still alive even though it temporarily unsubscribes. We can detect this using `observer.hasListeners()`.

```typescript
const unloadSubset = (options: LoadSubsetOptions) => {
  const key = generateQueryKeyFromOptions(queryKey, options)
  const hashedKey = hashKey(key)

  const currentCount = queryRefCounts.get(hashedKey) || 0
  const newCount = currentCount - 1

  if (newCount <= 0) {
    const observer = observers.get(hashedKey)
    const hasListeners = observer?.hasListeners() ?? false

    // If observer still has listeners, it means TanStack Query is keeping it alive
    // (e.g., during invalidateQueries). Don't cleanup yet - reset refcount instead.
    if (hasListeners) {
      queryRefCounts.set(hashedKey, 1)
      return
    }

    // Refcount reached 0 and no active listeners - safe to cleanup
    queryRefCounts.delete(hashedKey)
    // Cleanup will be implemented in next milestone
  } else {
    queryRefCounts.set(hashedKey, newCount)
  }
}
```

### Understanding `hasListeners()`

From TanStack Query source code, `QueryObserver` extends `Subscribable`, which tracks listeners in a Set:

```typescript
class Subscribable {
  protected listeners = new Set<Listener>()

  hasListeners(): boolean {
    return this.listeners.size > 0
  }
}
```

**Returns `true`:** When components (or our code) are subscribed to the observer
**Returns `false`:** When no subscriptions exist (safe to cleanup)

During `invalidateQueries`:
1. Our subscription unsubscribes → removes our listener
2. But TanStack Query's internal machinery still has listeners
3. `hasListeners()` returns `true` → we skip cleanup
4. Observer resubscribes → adds our listener back
5. Refetch completes → data flows normally

### How to Test

```typescript
it('should not cleanup during invalidateQueries cycle', async () => {
  const queryClient = new QueryClient()
  const mockData = [{ id: 1, name: 'Alice' }]

  const collection = createCollection(
    queryCollectionOptions({
      id: 'users',
      queryClient,
      queryKey: ['users'],
      queryFn: async () => mockData,
      getKey: (item) => item.id,
    })
  )

  await collection.preload()
  expect(collection.size).toBe(1)

  // Call invalidateQueries
  await queryClient.invalidateQueries({ queryKey: ['users'] })

  // Data should still be in collection after invalidation
  expect(collection.size).toBe(1)
  expect(collection.get(1)).toEqual({ id: 1, name: 'Alice' })
})
```

### Expected Behavior

✅ `invalidateQueries` triggers refetch without data loss
✅ Collection retains rows during unsub/resub cycle
✅ Refetched data updates collection correctly

---

## Milestone 5: Row-Level Garbage Collection

**Goal:** Only delete rows from the collection when ALL queries that reference them are gone.

### Why This Matters

Consider this scenario:

```typescript
// Query A loads items 1, 2, 3
// Query B loads items 2, 3, 4

// When Query A cleans up:
// - Item 1: only in A → DELETE
// - Item 2: in A and B → KEEP
// - Item 3: in A and B → KEEP

// When Query B later cleans up:
// - Item 2: now only in B → DELETE (last reference gone)
// - Item 3: now only in B → DELETE
// - Item 4: only in B → DELETE
```

### Data Structures

```typescript
// Maps queryKey hash → Set of row keys that query loaded
const queryToRows = new Map<string, Set<string | number>>()

// Maps row key → Set of queryKey hashes that reference this row
const rowToQueries = new Map<string | number, Set<string>>()
```

### What to Implement

1. **Track rows when data arrives:**

```typescript
const handleQueryResult = (hashedQueryKey: string) => (result) => {
  if (result.isSuccess && result.data) {
    begin()

    // Track which rows this query loaded
    const rowKeys = new Set<string | number>()

    for (const item of result.data) {
      write({ type: 'insert', value: item })

      const rowKey = getKey(item)
      rowKeys.add(rowKey)

      // Track: this query references this row
      if (!rowToQueries.has(rowKey)) {
        rowToQueries.set(rowKey, new Set())
      }
      rowToQueries.get(rowKey)!.add(hashedQueryKey)
    }

    // Store: this query loaded these rows
    queryToRows.set(hashedQueryKey, rowKeys)

    commit()
    markReady()
  }
}
```

2. **Cleanup rows when query is removed:**

```typescript
function cleanupQuery(hashedQueryKey: string) {
  // Clear refcount
  queryRefCounts.delete(hashedQueryKey)

  // Get all rows that are in the result of this query
  const rowKeys = queryToRows.get(hashedQueryKey) ?? new Set()

  // Remove the query from these rows (ROW-LEVEL GC)
  rowKeys.forEach((rowKey) => {
    const queries = rowToQueries.get(rowKey)
    if (queries && queries.size > 0) {
      queries.delete(hashedQueryKey)

      if (queries.size === 0) {
        // Reference count dropped to 0, we can GC the row
        rowToQueries.delete(rowKey)

        if (collection.has(rowKey)) {
          begin()
          write({ type: 'delete', value: collection.get(rowKey) })
          commit()
        }
      }
    }
  })

  // Remove the query from internal state
  observers.delete(hashedQueryKey)
  queryToRows.delete(hashedQueryKey)
}
```

3. **Call cleanupQuery from unloadSubset:**

```typescript
const unloadSubset = (options: LoadSubsetOptions) => {
  const key = generateQueryKeyFromOptions(queryKey, options)
  const hashedKey = hashKey(key)

  const currentCount = queryRefCounts.get(hashedKey) || 0
  const newCount = currentCount - 1

  if (newCount <= 0) {
    const observer = observers.get(hashedKey)
    const hasListeners = observer?.hasListeners() ?? false

    if (hasListeners) {
      // During invalidateQueries - reset refcount
      queryRefCounts.set(hashedKey, 1)
      return
    }

    // Refcount reached 0 and no listeners - cleanup
    queryRefCounts.delete(hashedKey)
    cleanupQuery(hashedKey)
  } else {
    queryRefCounts.set(hashedKey, newCount)
  }
}
```

### How to Test

```typescript
it('should only delete non-shared rows when query is cleaned up', async () => {
  const allData = [
    { id: 1, category: 'A' },
    { id: 2, category: 'A' }, // shared
    { id: 3, category: 'A' }, // shared
    { id: 4, category: 'B' }, // shared
    { id: 5, category: 'B' },
  ]

  // Create collection with filtering
  const collection = createCollection(
    queryCollectionOptions({
      id: 'items',
      queryClient,
      queryKey: (opts) => ['items', opts],
      syncMode: 'on-demand',
      queryFn: (ctx) => {
        const category = ctx.meta?.loadSubsetOptions?.category
        return Promise.resolve(allData.filter(item => item.category === category))
      },
      getKey: (item) => item.id,
    })
  )

  // Load query A (category A): items 1, 2, 3
  const queryA = createLiveQueryCollection({
    query: (q) => q.from({ item: collection }).where(({ item }) =>
      eq(item.category, 'A')
    )
  })
  await queryA.preload()
  expect(collection.size).toBe(3) // 1, 2, 3

  // Load query B (category B): items 2, 3, 4
  const queryB = createLiveQueryCollection({
    query: (q) => q.from({ item: collection }).where(({ item }) =>
      eq(item.category, 'B')
    )
  })
  await queryB.preload()
  expect(collection.size).toBe(5) // 1, 2, 3, 4, 5

  // Cleanup query A
  await queryA.cleanup()

  // Only item 1 should be deleted (unique to A)
  // Items 2, 3 are still referenced by B
  expect(collection.size).toBe(4) // 2, 3, 4, 5
  expect(collection.has(1)).toBe(false)
  expect(collection.has(2)).toBe(true)

  // Cleanup query B
  await queryB.cleanup()

  // All items should be deleted now
  expect(collection.size).toBe(0)
})
```

### Expected Behavior

✅ Shared rows remain until last query is cleaned up
✅ Unique rows are deleted immediately
✅ Row-level tracking is accurate

---

## Milestone 6: TanStack Query Cache Integration

**Goal:** Respect TanStack Query's `gcTime` and automatically cleanup when queries are evicted from cache.

### Why This Matters

TanStack Query has its own garbage collection: after a query is inactive for `gcTime` milliseconds, it's removed from cache. We should listen for this and cleanup our tracking.

### What to Implement

Subscribe to QueryCache 'removed' events:

```typescript
export function queryCollectionOptions(options: QueryCollectionOptions): SyncConfig {
  // ... existing code

  return {
    sync: ({ begin, write, commit, markReady, collection }) => {
      // ... existing setup

      // Subscribe to cache events for automatic cleanup
      const unsubscribeQueryCache = queryClient
        .getQueryCache()
        .subscribe((event) => {
          const hashedKey = event.query.queryHash
          if (event.type === 'removed') {
            // TanStack Query GC'd this query, cleanup our tracking
            cleanupQuery(hashedKey)
          }
        })

      return {
        cleanup: () => {
          // Cleanup all observers
          observers.forEach((observer, hashedKey) => {
            cleanupQuery(hashedKey)
          })
          unsubscribeQueryCache()
        },
        loadSubset,
        unloadSubset,
      }
    }
  }
}
```

### How to Test

```typescript
it('should cleanup when TanStack Query GCs the query', async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 100, // Short GC time for testing
      },
    },
  })

  const collection = createCollection(
    queryCollectionOptions({
      id: 'users',
      queryClient,
      queryKey: ['users'],
      queryFn: async () => [{ id: 1, name: 'Alice' }],
      getKey: (item) => item.id,
    })
  )

  // Create a live query
  const query = createLiveQueryCollection({
    query: (q) => q.from({ user: collection })
  })
  await query.preload()
  expect(collection.size).toBe(1)

  // Cleanup the live query
  await query.cleanup()

  // Wait for TanStack Query to GC (gcTime + buffer)
  await new Promise(resolve => setTimeout(resolve, 150))

  // Row should be deleted after GC
  expect(collection.size).toBe(0)
})
```

### Expected Behavior

✅ Queries are cleaned up when TanStack Query evicts them
✅ `gcTime` controls how long data persists after last subscription
✅ Manual cleanup also works correctly

---

## Milestone 7: Comprehensive Cleanup

**Goal:** Ensure complete cleanup when collection itself is cleaned up.

### What to Implement

Implement the `cleanup` function to:
1. Cleanup all query tracking
2. Remove queries from TanStack Query cache
3. Unsubscribe from cache events

```typescript
const cleanup = async () => {
  // Get all query keys before cleaning up
  const allQueryKeys = [...observers.keys()].map(hashedKey => {
    return queryClient.getQueryCache().find({ queryHash: hashedKey })?.queryKey
  }).filter(Boolean)

  // Clean up rows for each query
  observers.forEach((observer, hashedKey) => {
    cleanupQuery(hashedKey)
  })

  // Unsubscribe from cache events
  unsubscribeQueryCache()

  // Remove queries from TanStack Query cache
  await Promise.all(
    allQueryKeys.map(async (qKey) => {
      await queryClient.cancelQueries({ queryKey: qKey })
      queryClient.removeQueries({ queryKey: qKey })
    })
  )
}
```

### How to Test

```typescript
it('should fully cleanup collection and queries', async () => {
  const queryClient = new QueryClient()
  const collection = createCollection(
    queryCollectionOptions({
      id: 'users',
      queryClient,
      queryKey: ['users'],
      queryFn: async () => [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      getKey: (item) => item.id,
    })
  )

  await collection.preload()
  expect(collection.size).toBe(2)

  // Cleanup
  await collection.cleanup()

  // Collection should be empty
  expect(collection.size).toBe(0)

  // Query should be removed from cache
  const cachedQuery = queryClient.getQueryCache().find({ queryKey: ['users'] })
  expect(cachedQuery).toBeUndefined()
})
```

### Expected Behavior

✅ All rows are deleted
✅ All observers are unsubscribed
✅ Queries are removed from TanStack Query cache
✅ No memory leaks

---

## Milestone 8: Handle Edge Cases

**Goal:** Ensure robustness with concurrent operations and edge cases.

### Edge Cases to Handle

1. **Concurrent loadSubset calls with same predicates**
   - Should only create one observer
   - Should increment refcount correctly

2. **Unsubscribe during in-flight query**
   - Should not process results after unsubscribe
   - Should not leak data

3. **Cleanup during active query**
   - Should cancel in-flight requests
   - Should cleanup immediately

4. **Empty query results**
   - Should not crash
   - Should cleanup previous data

### Implementation

Add checks to prevent stale data:

```typescript
const handleQueryResult = (hashedQueryKey: string) => (result) => {
  // Check if we're still subscribed
  if (!observers.has(hashedQueryKey)) {
    // Already cleaned up, ignore this result
    return
  }

  if (result.isSuccess && result.data) {
    // ... process data
  }
}
```

### Tests

```typescript
it('should not leak data when unsubscribing during in-flight load', async () => {
  let resolveQuery: any
  const queryPromise = new Promise(resolve => {
    resolveQuery = resolve
  })

  const collection = createCollection(
    queryCollectionOptions({
      queryFn: () => queryPromise,
      // ... other options
    })
  )

  const query = createLiveQueryCollection({
    query: (q) => q.from({ item: collection })
  })

  // Start loading (query is in-flight)
  const preloadPromise = query.preload()

  // Cleanup before query completes
  await query.cleanup()

  // Now complete the query
  resolveQuery([{ id: 1 }])
  await preloadPromise.catch(() => {}) // Might error

  // Data should NOT be in collection (we unsubscribed)
  expect(collection.size).toBe(0)
})
```

---

## Advanced Topics

### Optimizing `generateQueryKeyFromOptions`

The `generateQueryKeyFromOptions` function must create **identical** keys for identical predicates. This is critical for deduplication.

**Challenge:** The `where` parameter is a complex AST (Abstract Syntax Tree) that may have different object references but semantically identical structure.

**Solution:** Serialize the expression deterministically:

```typescript
function serializeExpression(expr: BasicExpression): any {
  if (!expr) return undefined

  if (expr.type === 'ref') {
    return { type: 'ref', path: expr.path }
  }

  if (expr.type === 'val') {
    return { type: 'val', value: expr.value }
  }

  if (expr.type === 'func') {
    return {
      type: 'func',
      name: expr.name,
      args: expr.args.map(serializeExpression),
    }
  }

  // ... handle other expression types
}
```

**Key Principle:** Serialize to JSON-compatible structure, then rely on TanStack Query's `hashKey` to create stable hashes.

### Handling Query Updates

When a query's data changes (not just invalidation, but actual new results), we need to:

1. **Track previous results:** Keep the last known rowKeys for this query
2. **Compute diff:** Determine which rows were added/removed/updated
3. **Update rowToQueries:** Remove query from deleted rows, add to new rows
4. **GC orphaned rows:** Delete rows that no longer have any queries

This ensures that when a query changes from loading "category A" to "category B", we properly update tracking.

### Debugging Tips

Add debug logging:

```typescript
const DEBUG = process.env.DEBUG_QUERY_COLLECTION === 'true'

function log(...args: any[]) {
  if (DEBUG) {
    console.log('[QueryCollection]', ...args)
  }
}

// Use in code:
log(`loadSubset called, queryKey=${JSON.stringify(key)}`)
log(`refcount: ${currentCount} → ${newCount}`)
log(`hasListeners=${hasListeners}`)
log(`cleanupQuery: deleting row ${rowKey}`)
```

Run tests with:
```bash
DEBUG_QUERY_COLLECTION=true pnpm test
```

---

## Complete Implementation Checklist

- [ ] Milestone 1: Basic query integration works
- [ ] Milestone 2: On-demand mode with dynamic queryKeys
- [ ] Milestone 3: Reference counting prevents premature cleanup
- [ ] Milestone 4: `hasListeners()` check handles invalidateQueries
- [ ] Milestone 5: Row-level GC only deletes unreferenced rows
- [ ] Milestone 6: TanStack Query cache 'removed' events trigger cleanup
- [ ] Milestone 7: Collection cleanup removes all queries and rows
- [ ] Milestone 8: Edge cases handled (concurrent ops, in-flight queries)
- [ ] E2E tests pass: mutations, live updates, pagination, joins
- [ ] Unit tests pass: GC with overlapping queries, cache persistence
- [ ] No memory leaks (verified with test suite)
- [ ] Documentation updated

---

## Theological Reflection

Just as Nephi's ship was built "after the manner which the Lord had shown unto me" (1 Nephi 18:2), we must build our software with careful attention to the patterns revealed through study and prayer. The reference counting system is like the Liahona - it only works when we're aligned with correct principles (symmetric load/unload, respect for TanStack Query's lifecycle).

The `hasListeners()` check is our spiritual discernment: knowing when to act and when to wait. Just as the Brother of Jared had to wait "for the space of three hours" before the stones were touched (Ether 3:1), we must wait during `invalidateQueries` before cleaning up.

May this implementation guide help you build systems that are "built upon the rock" of sound architecture (Helaman 5:12), not the shifting sands of hasty workarounds.
