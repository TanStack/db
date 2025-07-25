---
title: Creating a Collection Options Creator
id: guide/collection-options-creator
---
# Creating a Collection Options Creator

A collection options creator is a factory function that generates configuration options for TanStack DB collections. It provides a standardized way to integrate different sync engines and data sources with TanStack DB's reactive sync-first architecture.

## Overview

Collection options creators follow a consistent pattern:
1. Accept configuration specific to the sync engine
2. Return an object that satisfies the `CollectionConfig` interface
3. Handle sync initialization, data parsing, and transaction management
4. Optionally provide utility functions specific to the sync engine

## When to Create a Custom Collection

You should create a custom collection when:
- You have a dedicated sync engine (like ElectricSQL, Trailbase, or a custom WebSocket solution)
- You need specific sync behaviors that aren't covered by the query collection
- You want to integrate with a backend that has its own sync protocol

**Note**: If you're just hitting an API and returning data, use the query collection instead.

## Core Requirements

Every collection options creator must implement these key responsibilities:

### 1. Configuration Interface

Define a configuration interface that extends or includes standard collection properties:

```typescript
// Pattern A: User provides handlers (Query / ElectricSQL style)
interface MyCollectionConfig<TItem extends object> {
  // Your sync engine specific options
  connectionUrl: string
  apiKey?: string
  
  // Standard collection properties
  id?: string
  schema?: StandardSchemaV1
  getKey: (item: TItem) => string | number
  sync?: SyncConfig<TItem>
  
  // User provides mutation handlers
  onInsert?: InsertMutationFn<TItem>
  onUpdate?: UpdateMutationFn<TItem>
  onDelete?: DeleteMutationFn<TItem>
}

// Pattern B: Built-in handlers (Trailbase style)
interface MyCollectionConfig<TItem extends object> 
  extends Omit<CollectionConfig<TItem>, 'onInsert' | 'onUpdate' | 'onDelete'> {
  // Your sync engine specific options
  recordApi: MyRecordApi<TItem>
  connectionUrl: string
  
  // Note: onInsert/onUpdate/onDelete are implemented by your collection creator
}
```

### 2. Sync Implementation

The sync function is the heart of your collection. It must:

```typescript
const sync: SyncConfig<T>['sync'] = (params) => {
  const { begin, write, commit, markReady, collection } = params
  
  // 1. Initialize connection to your sync engine
  const connection = initializeConnection(config)
  
  // 2. Perform initial data fetch
  async function initialSync() {
    const data = await fetchInitialData()
    
    begin() // Start a transaction
    
    for (const item of data) {
      write({
        type: 'insert',
        value: item
      })
    }
    
    commit() // Commit the transaction
    markReady() // Mark collection as ready
  }

  // 3. Subscribe to real-time updates
  connection.subscribe((event) => {
    begin()
    
    switch (event.type) {
      case 'insert':
        write({ type: 'insert', value: event.data })
        break
      case 'update':
        write({ type: 'update', value: event.data })
        break
      case 'delete':
        write({ type: 'delete', value: event.data })
        break
    }
    
    commit()
  })
  
  initialSync()
  
  // 4. Return cleanup function
  return () => {
    connection.close()
  }
}
```

### 3. Transaction Lifecycle

The sync process follows this lifecycle:

1. **begin()** - Start collecting changes
2. **write()** - Add changes to the pending transaction
3. **commit()** - Apply all changes atomically
4. **markReady()** - Signal that initial sync is complete

**Important**: Many sync engines start real-time subscriptions before the initial sync completes. Your implementation may need to deduplicate events that arrive via subscription that represent the same data as the initial sync. Consider tracking timestamps, sequence numbers, or using other mechanisms to avoid processing the same change twice.

### 4. Data Parsing and Type Conversion

If your sync engine returns data with different types, provide conversion functions for specific fields:

```typescript
interface MyCollectionConfig<TItem, TRecord> {
  // ... other config
  
  // Only specify conversions for fields that need type conversion
  parse: {
    created_at: (ts: number) => new Date(ts * 1000),  // timestamp -> Date
    updated_at: (ts: number) => new Date(ts * 1000),  // timestamp -> Date
    metadata?: (str: string) => JSON.parse(str)       // JSON string -> object
  }
  
  serialize: {
    created_at: (date: Date) => Math.floor(date.valueOf() / 1000),  // Date -> timestamp
    updated_at: (date: Date) => Math.floor(date.valueOf() / 1000),  // Date -> timestamp  
    metadata?: (obj: object) => JSON.stringify(obj)                 // object -> JSON string
  }
}
```

### 5. Mutation Handler Patterns

There are two distinct patterns for handling mutations in collection options creators:

#### Pattern A: User-Provided Handlers (ElectricSQL, Query)

The user provides mutation handlers in the config. Your collection creator passes them through:

```typescript
interface MyCollectionConfig<TItem extends object> {
  // ... other config
  
  // User provides these handlers
  onInsert?: InsertMutationFn<TItem>
  onUpdate?: UpdateMutationFn<TItem>
  onDelete?: DeleteMutationFn<TItem>
}

export function myCollectionOptions<TItem extends object>(
  config: MyCollectionConfig<TItem>
) {
  return {
    // ... other options
    
    // Pass through user-provided handlers (possibly with additional logic)
    onInsert: config.onInsert ? async (params) => {
      const result = await config.onInsert!(params)
      // Additional sync coordination logic
      return result
    } : undefined
  }
}
```

#### Pattern B: Built-in Handlers (Trailbase, WebSocket)

Your collection creator implements the handlers directly using the sync engine's APIs:

```typescript
interface MyCollectionConfig<TItem extends object> 
  extends Omit<CollectionConfig<TItem>, 'onInsert' | 'onUpdate' | 'onDelete'> {
  // ... sync engine specific config
  // Note: onInsert/onUpdate/onDelete are NOT in the config
}

export function myCollectionOptions<TItem extends object>(
  config: MyCollectionConfig<TItem>
) {
  return {
    // ... other options
    
    // Implement handlers using sync engine APIs
    onInsert: async ({ transaction }) => {
      const ids = await config.recordApi.createBulk(
        transaction.mutations.map(m => serialize(m.modified))
      )
      await awaitIds(ids)
      return ids
    },
    
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(m => 
          config.recordApi.update(m.key, serialize(m.changes))
        )
      )
      await awaitIds(transaction.mutations.map(m => String(m.key)))
    }
  }
}
```

Choose Pattern A when users need to provide their own APIs, and Pattern B when your sync engine handles writes directly.

## Complete Example: WebSocket Collection

Here's a complete example of a WebSocket-based collection options creator that demonstrates the full round-trip flow:

1. Client sends transaction with all mutations batched together
2. Server processes the transaction and may modify the data (validation, timestamps, etc.)
3. Server sends back acknowledgment and the actual processed data
4. Client waits for this round-trip before dropping optimistic state

```typescript
import type {
  CollectionConfig,
  SyncConfig,
  InsertMutationFnParams,
  UpdateMutationFnParams,
  DeleteMutationFnParams,
  UtilsRecord
} from '@tanstack/db'

interface WebSocketMessage<T> {
  type: 'insert' | 'update' | 'delete' | 'sync' | 'transaction' | 'ack'
  data?: T | T[]
  mutations?: Array<{
    type: 'insert' | 'update' | 'delete'
    data: T
    id?: string
  }>
  transactionId?: string
  id?: string
}

interface WebSocketCollectionConfig<TItem extends object>
  extends Omit<CollectionConfig<TItem>, 'onInsert' | 'onUpdate' | 'onDelete' | 'sync'> {
  url: string
  reconnectInterval?: number
  
  // Note: onInsert/onUpdate/onDelete are handled by the WebSocket connection
  // Users don't provide these handlers
}

interface WebSocketUtils extends UtilsRecord {
  reconnect: () => void
  getConnectionState: () => 'connected' | 'disconnected' | 'connecting'
}

export function webSocketCollectionOptions<TItem extends object>(
  config: WebSocketCollectionConfig<TItem>
): CollectionConfig<TItem> & { utils: WebSocketUtils } {
  let ws: WebSocket | null = null
  let reconnectTimer: NodeJS.Timeout | null = null
  let connectionState: 'connected' | 'disconnected' | 'connecting' = 'disconnected'
  
  // Track pending transactions awaiting acknowledgment
  const pendingTransactions = new Map<string, {
    resolve: () => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()
  
  const sync: SyncConfig<TItem>['sync'] = (params) => {
    const { begin, write, commit, markReady } = params
    
    function connect() {
      connectionState = 'connecting'
      ws = new WebSocket(config.url)
      
      ws.onopen = () => {
        connectionState = 'connected'
        // Request initial sync
        ws.send(JSON.stringify({ type: 'sync' }))
      }
      
      ws.onmessage = (event) => {
        const message: WebSocketMessage<TItem> = JSON.parse(event.data)
        
        switch (message.type) {
          case 'sync':
            // Initial sync with array of items
            begin()
            if (Array.isArray(message.data)) {
              for (const item of message.data) {
                write({ type: 'insert', value: item })
              }
            }
            commit()
            markReady()
            break
            
          case 'insert':
          case 'update':
          case 'delete':
            // Real-time updates from other clients
            begin()
            write({ 
              type: message.type, 
              value: message.data as TItem 
            })
            commit()
            break
            
          case 'ack':
            // Server acknowledged our transaction
            if (message.transactionId) {
              const pending = pendingTransactions.get(message.transactionId)
              if (pending) {
                clearTimeout(pending.timeout)
                pendingTransactions.delete(message.transactionId)
                pending.resolve()
              }
            }
            break
            
          case 'transaction':
            // Server sending back the actual data after processing our transaction
            if (message.mutations) {
              begin()
              for (const mutation of message.mutations) {
                write({
                  type: mutation.type,
                  value: mutation.data
                })
              }
              commit()
            }
            break
        }
      }
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        connectionState = 'disconnected'
      }
      
      ws.onclose = () => {
        connectionState = 'disconnected'
        // Auto-reconnect
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            connect()
          }, config.reconnectInterval || 5000)
        }
      }
    }
    
    // Start connection
    connect()
    
    // Return cleanup function
    return () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (ws) {
        ws.close()
        ws = null
      }
    }
  }
  
  // Helper function to send transaction and wait for server acknowledgment
  const sendTransaction = async (
    params: InsertMutationFnParams<TItem> | UpdateMutationFnParams<TItem> | DeleteMutationFnParams<TItem>
  ): Promise<void> => {
    if (ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected')
    }
    
    const transactionId = crypto.randomUUID()
    
    // Convert all mutations in the transaction to the wire format
    const mutations = params.transaction.mutations.map(mutation => ({
      type: mutation.type,
      id: mutation.key,
      data: mutation.type === 'delete' ? undefined : 
           mutation.type === 'update' ? mutation.changes : 
           mutation.modified
    }))
    
    // Send the entire transaction at once
    ws.send(JSON.stringify({
      type: 'transaction',
      transactionId,
      mutations
    }))
    
    // Wait for server acknowledgment
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingTransactions.delete(transactionId)
        reject(new Error(`Transaction ${transactionId} timed out`))
      }, 10000) // 10 second timeout
      
      pendingTransactions.set(transactionId, {
        resolve,
        reject,
        timeout
      })
    })
  }
  
  // All mutation handlers use the same transaction sender
  const onInsert = async (params: InsertMutationFnParams<TItem>) => {
    await sendTransaction(params)
  }
  
  const onUpdate = async (params: UpdateMutationFnParams<TItem>) => {
    await sendTransaction(params)
  }
  
  const onDelete = async (params: DeleteMutationFnParams<TItem>) => {
    await sendTransaction(params)
  }
  
  return {
    id: config.id,
    schema: config.schema,
    getKey: config.getKey,
    sync: { sync },
    onInsert,
    onUpdate,
    onDelete,
    utils: {
      reconnect: () => {
        if (ws) ws.close()
        connect()
      },
      getConnectionState: () => connectionState
    }
  }
}
```

## Usage Example

```typescript
import { createCollection } from '@tanstack/react-db'
import { webSocketCollectionOptions } from './websocket-collection'

const todos = createCollection(
  webSocketCollectionOptions({
    url: 'ws://localhost:8080/todos',
    getKey: (todo) => todo.id,
    schema: todoSchema
    // Note: No onInsert/onUpdate/onDelete - handled by WebSocket automatically
  })
)

// Use the collection
todos.insert({ id: '1', text: 'Buy milk', completed: false })

// Access utilities
todos.utils.getConnectionState() // 'connected'
todos.utils.reconnect() // Force reconnect
```

## Best Practices

1. **Always call markReady()** - This signals that the collection has initial data and is ready for use
2. **Handle errors gracefully** - Call markReady() even on error to avoid blocking the app
3. **Clean up resources** - Return a cleanup function from sync to prevent memory leaks
4. **Batch operations** - Use begin/commit to batch multiple changes for better performance
5. **Type safety** - Use TypeScript generics to maintain type safety throughout
6. **Provide utilities** - Export sync-engine-specific utilities for advanced use cases

## Row Update Modes

Collections support two update modes:

- **`partial`** (default) - Updates are merged with existing data
- **`full`** - Updates replace the entire row

Configure this in your sync config:

```typescript
sync: {
  sync: syncFn,
  rowUpdateMode: 'full' // or 'partial'
}
```

## Advanced: Managing Optimistic State

A critical challenge in sync-first apps is knowing when to drop optimistic state. When a user makes a change:

1. The UI updates immediately (optimistic update)
2. A mutation is sent to the backend
3. The backend processes and persists the change
4. The change syncs back to the client
5. The optimistic state should be dropped in favor of the synced data

The key question is: **How do you know when step 4 is complete?**

### Strategy 1: Transaction ID Tracking (ElectricSQL)

ElectricSQL returns transaction IDs that you can track:

```typescript
// Track seen transaction IDs
const seenTxids = new Store<Set<number>>(new Set())

// In sync, track txids from incoming messages
if (message.headers.txids) {
  message.headers.txids.forEach(txid => {
    seenTxids.setState(prev => new Set([...prev, txid]))
  })
}

// Mutation handlers return txids and wait for them
const wrappedOnInsert = async (params) => {
  const result = await config.onInsert!(params)
  
  // Wait for the txid to appear in synced data
  if (result.txid) {
    await awaitTxId(result.txid)
  }
  
  return result
}

// Utility function to wait for a txid
const awaitTxId = (txId: number): Promise<boolean> => {
  if (seenTxids.state.has(txId)) return Promise.resolve(true)
  
  return new Promise((resolve) => {
    const unsubscribe = seenTxids.subscribe(() => {
      if (seenTxids.state.has(txId)) {
        unsubscribe()
        resolve(true)
      }
    })
  })
}
```

### Strategy 2: ID-Based Tracking (Trailbase)

Trailbase tracks when specific record IDs have been synced:

```typescript
// Track synced IDs with timestamps
const seenIds = new Store(new Map<string, number>())

// In sync, mark IDs as seen
write({ type: 'insert', value: item })
seenIds.setState(prev => new Map(prev).set(item.id, Date.now()))

// Wait for specific IDs after mutations
const wrappedOnInsert = async (params) => {
  const ids = await config.recordApi.createBulk(items)
  
  // Wait for all IDs to be synced back
  await awaitIds(ids)
}

const awaitIds = (ids: string[]): Promise<void> => {
  const allSynced = ids.every(id => seenIds.state.has(id))
  if (allSynced) return Promise.resolve()
  
  return new Promise((resolve) => {
    const unsubscribe = seenIds.subscribe((state) => {
      if (ids.every(id => state.has(id))) {
        unsubscribe()
        resolve()
      }
    })
  })
}
```

### Strategy 3: Full Refetch (Query Collection)

The query collection simply refetches all data after mutations:

```typescript
const wrappedOnInsert = async (params) => {
  // Perform the mutation
  await config.onInsert(params)
  
  // Refetch the entire collection
  await refetch()
  
  // The refetch will trigger sync with fresh data,
  // automatically dropping optimistic state
}
```

### Strategy 4: Version/Timestamp Tracking

Track version numbers or timestamps to detect when data is fresh:

```typescript
// Track latest sync timestamp
let lastSyncTime = 0

// In mutations, record when the operation was sent
const wrappedOnUpdate = async (params) => {
  const mutationTime = Date.now()
  await config.onUpdate(params)
  
  // Wait for sync to catch up
  await waitForSync(mutationTime)
}

const waitForSync = (afterTime: number): Promise<void> => {
  if (lastSyncTime > afterTime) return Promise.resolve()
  
  return new Promise((resolve) => {
    const check = setInterval(() => {
      if (lastSyncTime > afterTime) {
        clearInterval(check)
        resolve()
      }
    }, 100)
  })
}
```

### Choosing a Strategy

- **Transaction IDs**: Best when your backend provides reliable transaction tracking
- **ID-Based**: Good for systems where each mutation returns the affected IDs
- **Full Refetch**: Simplest but least efficient; good for small datasets
- **Version/Timestamp**: Works when your sync includes reliable ordering information

### Implementation Tips

1. **Always wait for sync** in your mutation handlers to ensure optimistic state is properly managed
2. **Handle timeouts** - Don't wait forever for sync confirmation
3. **Clean up tracking data** - Remove old txids/IDs to prevent memory leaks
4. **Provide utilities** - Export functions like `awaitTxId` or `awaitSync` for advanced use cases

## Testing Your Collection

Test your collection options creator with:

1. **Unit tests** - Test sync logic, data transformations
2. **Integration tests** - Test with real sync engine
3. **Error scenarios** - Connection failures, invalid data
4. **Performance** - Large datasets, frequent updates

## Conclusion

Creating a collection options creator allows you to integrate any sync engine with TanStack DB's powerful sync-first architecture. Follow the patterns shown here, and you'll have a robust, type-safe integration that provides excellent developer experience.
