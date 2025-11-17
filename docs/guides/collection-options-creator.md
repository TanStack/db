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
- You have a dedicated sync engine (like ElectricSQL, Trailbase, Firebase, RxDB or a custom WebSocket solution)
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
  
  rowUpdateMode?: 'partial' | 'full'
  
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
  
  rowUpdateMode?: 'partial' | 'full'
  
  // Note: onInsert/onUpdate/onDelete are implemented by your collection creator
}
```

### 2. Sync Implementation

The sync function is the heart of your collection. It must:

The sync function must return a cleanup function for proper garbage collection:

```typescript
const sync: SyncConfig<T>['sync'] = (params) => {
  const { begin, write, commit, markReady, collection } = params
  
  // 1. Initialize connection to your sync engine
  const connection = initializeConnection(config)
  
  // 2. Set up real-time subscription FIRST (prevents race conditions)
  const eventBuffer: Array<any> = []
  let isInitialSyncComplete = false
  
  connection.subscribe((event) => {
    if (!isInitialSyncComplete) {
      // Buffer events during initial sync to prevent race conditions
      eventBuffer.push(event)
      return
    }
    
    // Process real-time events
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
  
  // 3. Perform initial data fetch
  async function initialSync() {
    try {
      const data = await fetchInitialData()
      
      begin() // Start a transaction
      
      for (const item of data) {
        write({
          type: 'insert',
          value: item
        })
      }
      
      commit() // Commit the transaction
      
      // 4. Process buffered events
      isInitialSyncComplete = true
      if (eventBuffer.length > 0) {
        begin()
        for (const event of eventBuffer) {
          // Deduplicate if necessary based on your sync engine
          write({ type: event.type, value: event.data })
        }
        commit()
        eventBuffer.splice(0)
      }
      
    } catch (error) {
      console.error('Initial sync failed:', error)
      throw error
    } finally {
      // ALWAYS call markReady, even on error
      markReady()
    }
  }

  initialSync()
  
  // 4. Return cleanup function
  return () => {
    connection.close()
    // Clean up any timers, intervals, or other resources
  }
}
```

### 3. Transaction Lifecycle

Understanding the transaction lifecycle is important for correct implementation.

The sync process follows this lifecycle:

1. **begin()** - Start collecting changes
2. **write()** - Add changes to the pending transaction (buffered until commit)
3. **commit()** - Apply all changes atomically to the collection state
4. **markReady()** - Signal that initial sync is complete

**Race Condition Prevention:**
Many sync engines start real-time subscriptions before the initial sync completes. Your implementation MUST deduplicate events that arrive via subscription that represent the same data as the initial sync. Consider:
- Starting the listener BEFORE initial fetch and buffering events
- Tracking timestamps, sequence numbers, or document versions
- Using read timestamps or other ordering mechanisms

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

**Type Conversion Examples:**
```typescript
// Firebase Timestamp to Date
parse: {
  createdAt: (timestamp) => timestamp?.toDate?.() || new Date(timestamp),
  updatedAt: (timestamp) => timestamp?.toDate?.() || new Date(timestamp),
}

// PostGIS geometry to GeoJSON
parse: {
  location: (wkb: string) => parseWKBToGeoJSON(wkb)
}

// JSON string to object with error handling
parse: {
  metadata: (str: string) => {
    try {
      return JSON.parse(str)
    } catch {
      return {}
    }
  }
}
```

### 5. Schemas and Type Transformations

When building a custom collection, you need to decide how to handle the relationship between your backend's storage format and the client-side types users work with in their collections.

#### Two Separate Concerns

**Backend Format** - The types your storage layer uses (SQLite, Postgres, Firebase, etc.)
- Examples: Unix timestamps, ISO strings, JSON strings, PostGIS geometries

**Client Format** - The types users work with in their TanStack DB collections
- Examples: Date objects, parsed JSON, GeoJSON

Schemas in TanStack DB define the **client format** (TInput/TOutput for mutations). How you bridge between backend and client format depends on your integration design.

#### Approach 1: Integration Provides Parse/Serialize Helpers

For backends with specific storage formats, provide `parse`/`serialize` options that users configure:

```typescript
// TrailBase example: User specifies field conversions
export function trailbaseCollectionOptions(config) {
  return {
    parse: config.parse,      // User provides field conversions
    serialize: config.serialize,

    onInsert: async ({ transaction }) => {
      const serialized = transaction.mutations.map(m =>
        serializeFields(m.modified, config.serialize)
      )
      await config.recordApi.createBulk(serialized)
    }
  }
}

// User explicitly configures conversions
const collection = createCollection(
  trailbaseCollectionOptions({
    schema: todoSchema,
    parse: {
      created_at: (ts: number) => new Date(ts * 1000)  // Unix → Date
    },
    serialize: {
      created_at: (date: Date) => Math.floor(date.valueOf() / 1000)  // Date → Unix
    }
  })
)
```

**Benefits:** Explicit control over type conversions. Integration handles applying them consistently.

#### Approach 2: User Handles Everything in QueryFn/Handlers

For simple APIs or when users want full control, they handle parsing/serialization themselves:

```typescript
// Query Collection: User handles all transformations
const collection = createCollection(
  queryCollectionOptions({
    schema: todoSchema,
    queryFn: async () => {
      const response = await fetch('/api/todos')
      const todos = await response.json()
      // User manually parses to match their schema's TOutput
      return todos.map(todo => ({
        ...todo,
        created_at: new Date(todo.created_at)  // ISO string → Date
      }))
    },
    onInsert: async ({ transaction }) => {
      // User manually serializes for their backend
      await fetch('/api/todos', {
        method: 'POST',
        body: JSON.stringify({
          ...transaction.mutations[0].modified,
          created_at: transaction.mutations[0].modified.created_at.toISOString()  // Date → ISO string
        })
      })
    }
  })
)
```

**Benefits:** Maximum flexibility, no abstraction overhead. Users see exactly what's happening.

#### Approach 3: Automatic Serialization in Handlers

If your backend has well-defined types, you can automatically serialize in mutation handlers:

```typescript
export function myCollectionOptions(config) {
  return {
    onInsert: async ({ transaction }) => {
      // Automatically serialize known types for your backend
      const serialized = transaction.mutations.map(m => ({
        ...m.modified,
        // Date objects → Unix timestamps for your backend
        created_at: m.modified.created_at instanceof Date
          ? Math.floor(m.modified.created_at.valueOf() / 1000)
          : m.modified.created_at
      }))
      await backend.insert(serialized)
    }
  }
}
```

**Benefits:** Least configuration for users. Integration handles backend format automatically.

#### Key Design Principles

1. **Schemas validate client mutations only** - They don't affect how backend data is parsed during sync
2. **TOutput is the application-facing type** - This is what users work with in their app
3. **Choose your approach based on backend constraints** - Fixed types → automatic serialization; varying types → user configuration
4. **Document your backend format clearly** - Explain what types your storage uses and how to handle them

For more on schemas from a user perspective, see the [Schemas guide](./schemas.md).

### 6. Mutation Handler Patterns

There are two distinct patterns for handling mutations in collection options creators:

#### Pattern A: User-Provided Handlers (Query, Standard)

The user provides mutation handlers in the config. Your collection creator passes them through.

**Note:** Handler return values are deprecated. Users should manually trigger refetch/sync within their handlers.

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
    rowUpdateMode: config.rowUpdateMode || 'partial',

    // Pass through user-provided handlers
    // Users handle sync coordination in their own handlers
    onInsert: config.onInsert,
    onUpdate: config.onUpdate,
    onDelete: config.onDelete
  }
}
```


#### Pattern B: Built-in Handlers (Trailbase, WebSocket, Firebase)

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
    rowUpdateMode: config.rowUpdateMode || 'partial',

    // Implement handlers using sync engine APIs
    onInsert: async ({ transaction }) => {
      // Handle provider-specific batch limits (e.g., Firestore's 500 limit)
      const chunks = chunkArray(transaction.mutations, PROVIDER_BATCH_LIMIT)

      for (const chunk of chunks) {
        const ids = await config.recordApi.createBulk(
          chunk.map(m => serialize(m.modified))
        )
        // Wait for these IDs to sync back before completing
        await awaitIds(ids)
      }
      // Handler completes after sync coordination
    },

    onUpdate: async ({ transaction }) => {
      const chunks = chunkArray(transaction.mutations, PROVIDER_BATCH_LIMIT)

      for (const chunk of chunks) {
        await Promise.all(
          chunk.map(m =>
            config.recordApi.update(m.key, serialize(m.changes))
          )
        )
      }

      // Wait for mutations to sync back
      await awaitIds(transaction.mutations.map(m => String(m.key)))
    }
  }
}
```

Many providers have batch size limits (Firestore: 500, DynamoDB: 25, etc.) so chunk large transactions accordingly.

**Key Principle:** Built-in handlers should coordinate sync internally (using `awaitIds`, `awaitTxId`, or similar) and not rely on return values. The handler completes only after sync coordination is done.

Choose Pattern A when users need to provide their own APIs, and Pattern B when your sync engine handles writes directly.

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

## Production Examples

For complete, production-ready examples, see the collection packages in the TanStack DB repository:

- **[@tanstack/query-collection](https://github.com/TanStack/db/tree/main/packages/query-collection)** - Pattern A: User-provided handlers with full refetch strategy
- **[@tanstack/trailbase-collection](https://github.com/TanStack/db/tree/main/packages/trailbase-collection)** - Pattern B: Built-in handlers with ID-based tracking  
- **[@tanstack/electric-collection](https://github.com/TanStack/db/tree/main/packages/electric-collection)** - Pattern A: Transaction ID tracking with complex sync protocols
- **[@tanstack/rxdb-collection](https://github.com/TanStack/db/tree/main/packages/rxdb-collection)** - Pattern B: Built-in handlers that bridge [RxDB](https://rxdb.info) change streams into TanStack DB's sync lifecycle

### Key Lessons from Production Collections

**From Query Collection:**
- Simplest approach: Full refetch after mutations
- Best for: APIs without real-time sync
- Pattern: User provides `onInsert/onUpdate/onDelete` handlers

**From Trailbase Collection:**  
- Shows ID-based optimistic state management
- Handles provider batch limits (chunking large operations)
- Pattern: Collection provides mutation handlers using record API

**From Electric Collection:**
- Complex transaction ID tracking for distributed sync
- Demonstrates advanced deduplication techniques
- Shows how to wrap user handlers with sync coordination

**From RxDB Collection:**
- Uses RxDB's built-in queries and change streams
- Uses `RxCollection.$` to subscribe to inserts/updates/deletes and forward them to TanStack DB with begin-write-commit
- Implements built-in mutation handlers (onInsert, onUpdate, onDelete) that call RxDB APIs (bulkUpsert, incrementalPatch, bulkRemove)

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
  // Handlers wait for server acknowledgment before completing
  const onInsert = async (params: InsertMutationFnParams<TItem>): Promise<void> => {
    await sendTransaction(params)
    // Handler completes after server confirms the transaction
  }

  const onUpdate = async (params: UpdateMutationFnParams<TItem>): Promise<void> => {
    await sendTransaction(params)
  }

  const onDelete = async (params: DeleteMutationFnParams<TItem>): Promise<void> => {
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

## Advanced: Managing Optimistic State

A critical challenge in sync-first apps is knowing when to drop optimistic state. When a user makes a change:

1. The UI updates immediately (optimistic update)
2. A mutation is sent to the backend
3. The backend processes and persists the change
4. The change syncs back to the client
5. The optimistic state should be dropped in favor of the synced data

The key question is: **How do you know when step 4 is complete?**

### Strategy 1: Built-in Provider Methods (Recommended)

Many providers offer built-in methods to wait for sync completion:

```typescript
// Firebase
await waitForPendingWrites(firestore)

// Custom WebSocket
await websocket.waitForAck(transactionId)
```

### Strategy 2: Transaction ID Tracking (ElectricSQL)

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

// Electric-specific: Wrap user handlers to coordinate txid-based sync
const wrappedOnInsert = async (params) => {
  // User handler returns { txid } for Electric collections
  const result = await config.onInsert!(params)

  // Electric-specific: Wait for the txid to appear in synced data
  if (result?.txid) {
    await awaitTxId(result.txid)
  }
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

### Strategy 3: ID-Based Tracking (Trailbase)

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

  // Wait for all IDs to be synced back before handler completes
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

### Strategy 4: Version/Timestamp Tracking

Track version numbers or timestamps to detect when data is fresh:

```typescript
// Track latest sync timestamp
let lastSyncTime = 0

// In mutations, record when the operation was sent
const wrappedOnUpdate = async (params) => {
  const mutationTime = Date.now()
  await config.onUpdate(params)

  // Wait for sync to catch up before handler completes
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

### Strategy 5: Manual Refetch (Query Collection)

The query collection pattern has users manually refetch after mutations:

```typescript
// Pattern A: User provides handlers and manages refetch
export function queryCollectionOptions<TItem>(config) {
  return {
    // ... other options

    // User provides handlers and they handle refetch themselves
    onInsert: config.onInsert,  // User calls collection.utils.refetch() in their handler
    onUpdate: config.onUpdate,
    onDelete: config.onDelete,

    utils: {
      refetch: () => {
        // Refetch implementation that syncs fresh data
        // automatically dropping optimistic state
      }
    }
  }
}

// Usage: User manually refetches in their handler
const collection = createCollection(
  queryCollectionOptions({
    onInsert: async ({ transaction, collection }) => {
      await api.createTodos(transaction.mutations.map(m => m.modified))
      // User explicitly triggers refetch
      await collection.utils.refetch()
    }
  })
)
```

### Choosing a Strategy

- **Built-in Methods**: Best when your provider offers sync completion APIs
- **Transaction IDs**: Best when your backend provides reliable transaction tracking
- **ID-Based**: Good for systems where each mutation returns the affected IDs
- **Full Refetch**: Simplest but least efficient; good for small datasets
- **Version/Timestamp**: Works when your sync includes reliable ordering information

### Implementation Tips

1. **Always wait for sync** in your mutation handlers to ensure optimistic state is properly managed
2. **Handle timeouts** - Don't wait forever for sync confirmation
3. **Clean up tracking data** - Remove old txids/IDs to prevent memory leaks
4. **Provide utilities** - Export functions like `awaitTxId` or `awaitSync` for advanced use cases

## Best Practices

1. **Always call markReady()** - This signals that the collection has initial data and is ready for use
2. **Handle errors gracefully** - Call markReady() even on error to avoid blocking the app
3. **Clean up resources** - Return a cleanup function from sync to prevent memory leaks
4. **Batch operations** - Use begin/commit to batch multiple changes for better performance
5. **Race Conditions** - Start listeners before initial fetch and buffer events
6. **Type safety** - Use TypeScript generics to maintain type safety throughout
7. **Provide utilities** - Export sync-engine-specific utilities for advanced use cases
8. **Handler return values are deprecated** - Mutation handlers should coordinate sync internally (via `await`) rather than returning values. For Electric collections, use `await collection.utils.awaitTxId(txid)` instead of returning the txid

## Testing Your Collection

Test your collection options creator with:

1. **Unit tests** - Test sync logic, data transformations
2. **Integration tests** - Test with real sync engine
3. **Error scenarios** - Connection failures, invalid data
4. **Performance** - Large datasets, frequent updates

## Conclusion

Creating a collection options creator allows you to integrate any sync engine with TanStack DB's powerful sync-first architecture. Follow the patterns shown here, and you'll have a robust, type-safe integration that provides excellent developer experience.
