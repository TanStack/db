---
title: Query Collection
---

# Query Collection

Query collections provide seamless integration between TanStack DB and TanStack Query, enabling automatic synchronization between your local database and remote data sources.

## Overview

The `@tanstack/query-db-collection` package allows you to create collections that:
- Automatically sync with remote data via TanStack Query
- Support optimistic updates with automatic rollback on errors
- Handle persistence through customizable mutation handlers
- Provide direct write capabilities as an escape hatch for advanced scenarios

## Installation

```bash
npm install @tanstack/query-db-collection @tanstack/query-core @tanstack/db
```

## Basic Usage

```typescript
import { QueryClient } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const queryClient = new QueryClient()

const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => {
      const response = await fetch('/api/todos')
      return response.json()
    },
    queryClient,
    getKey: (item) => item.id,
  })
)
```

## Configuration Options

The `queryCollectionOptions` function accepts the following options:

### Required Options

- `queryKey`: The query key for TanStack Query
- `queryFn`: Function that fetches data from the server
- `queryClient`: TanStack Query client instance
- `getKey`: Function to extract the unique key from an item

### Query Options

- `enabled`: Whether the query should automatically run (default: `true`)
- `refetchInterval`: Refetch interval in milliseconds
- `retry`: Retry configuration for failed queries
- `retryDelay`: Delay between retries
- `staleTime`: How long data is considered fresh
- `meta`: Optional metadata that will be passed to the query function context

### Collection Options

- `id`: Unique identifier for the collection
- `schema`: Schema for validating items
- `sync`: Custom sync configuration
- `startSync`: Whether to start syncing immediately (default: `true`)

### Persistence Handlers

- `onInsert`: Handler called before insert operations
- `onUpdate`: Handler called before update operations
- `onDelete`: Handler called before delete operations

## Persistence Handlers

You can define handlers that are called when mutations occur. These handlers can persist changes to your backend and control whether the query should refetch after the operation:

```typescript
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: fetchTodos,
    queryClient,
    getKey: (item) => item.id,
    
    onInsert: async ({ transaction }) => {
      const newItems = transaction.mutations.map(m => m.modified)
      await api.createTodos(newItems)
      // Returning nothing or { refetch: true } will trigger a refetch
      // Return { refetch: false } to skip automatic refetch
    },
    
    onUpdate: async ({ transaction }) => {
      const updates = transaction.mutations.map(m => ({
        id: m.key,
        changes: m.changes
      }))
      await api.updateTodos(updates)
    },
    
    onDelete: async ({ transaction }) => {
      const ids = transaction.mutations.map(m => m.key)
      await api.deleteTodos(ids)
    }
  })
)
```

### Controlling Refetch Behavior

By default, after any persistence handler (`onInsert`, `onUpdate`, or `onDelete`) completes successfully, the query will automatically refetch to ensure the local state matches the server state.

You can control this behavior by returning an object with a `refetch` property:

```typescript
onInsert: async ({ transaction }) => {
  await api.createTodos(transaction.mutations.map(m => m.modified))
  
  // Skip the automatic refetch
  return { refetch: false }
}
```

This is useful when:
- You're confident the server state matches what you sent
- You want to avoid unnecessary network requests
- You're handling state updates through other mechanisms (like WebSockets)

## Utility Methods

The collection provides these utility methods via `collection.utils`:

- `refetch()`: Manually trigger a refetch of the query

## Direct Writes (Advanced)

Direct writes are an escape hatch for scenarios where the normal query/mutation flow doesn't fit your needs. They allow you to write directly to the synced data store, bypassing the optimistic update system and query refetch mechanism.

### Understanding the Data Stores

Query Collections maintain two data stores:
1. **Synced Data Store** - The authoritative state synchronized with the server via `queryFn`
2. **Optimistic Mutations Store** - Temporary changes that are applied optimistically before server confirmation

Normal collection operations (insert, update, delete) create optimistic mutations that are:
- Applied immediately to the UI
- Sent to the server via persistence handlers
- Rolled back automatically if the server request fails
- Replaced with server data when the query refetches

Direct writes bypass this system entirely and write directly to the synced data store, making them ideal for handling real-time updates from alternative sources.

### When to Use Direct Writes

Direct writes should be used when:
- You need to sync real-time updates from WebSockets or server-sent events
- You're dealing with large datasets where refetching everything is too expensive
- You receive incremental updates or server-computed field updates
- You need to implement complex pagination or partial data loading scenarios

### Individual Write Operations

```typescript
// Insert a new item directly to the synced data store
todosCollection.utils.writeInsert({ id: '1', text: 'Buy milk', completed: false })

// Update an existing item in the synced data store
todosCollection.utils.writeUpdate({ id: '1', completed: true })

// Delete an item from the synced data store
todosCollection.utils.writeDelete('1')

// Upsert (insert or update) in the synced data store
todosCollection.utils.writeUpsert({ id: '1', text: 'Buy milk', completed: false })
```

These operations:
- Write directly to the synced data store
- Do NOT create optimistic mutations
- Do NOT trigger automatic query refetches
- Update the TanStack Query cache immediately
- Are immediately visible in the UI

### Batch Operations

The `writeBatch` method allows you to perform multiple operations atomically. Any write operations called within the callback will be collected and executed as a single transaction:

```typescript
todosCollection.utils.writeBatch(() => {
  todosCollection.utils.writeInsert({ id: '1', text: 'Buy milk' })
  todosCollection.utils.writeInsert({ id: '2', text: 'Walk dog' })
  todosCollection.utils.writeUpdate({ id: '3', completed: true })
  todosCollection.utils.writeDelete('4')
})
```

### Real-World Example: WebSocket Integration

```typescript
// Handle real-time updates from WebSocket without triggering full refetches
ws.on('todos:update', (changes) => {
  todosCollection.utils.writeBatch(() => {
    changes.forEach(change => {
      switch (change.type) {
        case 'insert':
          todosCollection.utils.writeInsert(change.data)
          break
        case 'update':
          todosCollection.utils.writeUpdate(change.data)
          break
        case 'delete':
          todosCollection.utils.writeDelete(change.id)
          break
      }
    })
  })
})
```

### Example: Incremental Updates

```typescript
// Handle server responses after mutations without full refetch
const createTodo = async (todo) => {
  // Optimistically add the todo
  const tempId = crypto.randomUUID()
  todosCollection.insert({ ...todo, id: tempId })
  
  try {
    // Send to server
    const serverTodo = await api.createTodo(todo)
    
    // Sync the server response (with server-generated ID and timestamps)
    // without triggering a full collection refetch
    todosCollection.utils.writeBatch(() => {
      todosCollection.utils.writeDelete(tempId)
      todosCollection.utils.writeInsert(serverTodo)
    })
  } catch (error) {
    // Rollback happens automatically
    throw error
  }
}
```

### Example: Large Dataset Pagination

```typescript
// Load additional pages without refetching existing data
const loadMoreTodos = async (page) => {
  const newTodos = await api.getTodos({ page, limit: 50 })
  
  // Add new items without affecting existing ones
  todosCollection.utils.writeBatch(() => {
    newTodos.forEach(todo => {
      todosCollection.utils.writeInsert(todo)
    })
  })
}
```

## Important Behaviors

### Full State Sync

The query collection treats the `queryFn` result as the **complete state** of the collection. This means:

- Items present in the collection but not in the query result will be deleted
- Items in the query result but not in the collection will be inserted
- Items present in both will be updated if they differ

### Empty Array Behavior

When `queryFn` returns an empty array, **all items in the collection will be deleted**. This is because the collection interprets an empty array as "the server has no items".

```typescript
// This will delete all items in the collection
queryFn: async () => []
```

### Handling Partial/Incremental Fetches

Since the query collection expects `queryFn` to return the complete state, you can handle partial fetches by merging new data with existing data:

```typescript
const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async ({ queryKey }) => {
      // Get existing data from cache
      const existingData = queryClient.getQueryData(queryKey) || []
      
      // Fetch only new/updated items (e.g., changes since last sync)
      const lastSyncTime = localStorage.getItem('todos-last-sync')
      const newData = await fetch(`/api/todos?since=${lastSyncTime}`).then(r => r.json())
      
      // Merge new data with existing data
      const existingMap = new Map(existingData.map(item => [item.id, item]))
      
      // Apply updates and additions
      newData.forEach(item => {
        existingMap.set(item.id, item)
      })
      
      // Handle deletions if your API provides them
      if (newData.deletions) {
        newData.deletions.forEach(id => existingMap.delete(id))
      }
      
      // Update sync time
      localStorage.setItem('todos-last-sync', new Date().toISOString())
      
      // Return the complete merged state
      return Array.from(existingMap.values())
    },
    queryClient,
    getKey: (item) => item.id,
  })
)
```

This pattern allows you to:
- Fetch only incremental changes from your API
- Merge those changes with existing data
- Return the complete state that the collection expects
- Avoid the performance overhead of fetching all data every time

### Direct Writes and Query Sync

Direct writes update the collection immediately and also update the TanStack Query cache. However, they do not prevent the normal query sync behavior. If your `queryFn` returns data that conflicts with your direct writes, the query data will take precedence.

To handle this properly:
1. Use `{ refetch: false }` in your persistence handlers when using direct writes
2. Set appropriate `staleTime` to prevent unnecessary refetches
3. Design your `queryFn` to be aware of incremental updates (e.g., only fetch new data)

## Complete Direct Write API Reference

All direct write methods are available on `collection.utils`:

- `writeInsert(data)`: Insert one or more items directly
- `writeUpdate(data)`: Update one or more items directly
- `writeDelete(keys)`: Delete one or more items directly
- `writeUpsert(data)`: Insert or update one or more items directly
- `writeBatch(callback)`: Perform multiple operations atomically
- `refetch()`: Manually trigger a refetch of the query
