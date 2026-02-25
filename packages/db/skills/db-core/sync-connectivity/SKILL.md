---
name: db-core/sync-connectivity
description: >
  Managing data synchronization between collections and backends. Covers
  sync modes (eager, on-demand, progressive). SyncConfig interface (begin,
  write, commit, markReady, truncate). Electric txid tracking with
  awaitTxId/awaitMatch. Query direct writes (writeInsert, writeUpdate,
  writeDelete, writeUpsert, writeBatch). PowerSync SQLite persistence.
  RxDB Observable-driven sync. TrailBase event streaming.
  @tanstack/offline-transactions (OfflineExecutor, outbox, IndexedDB,
  localStorage). Leader election, online detection,
  collection options creator pattern.
type: sub-skill
library: db
library_version: '0.5.29'
sources:
  - 'TanStack/db:docs/collections/electric-collection.md'
  - 'TanStack/db:docs/collections/query-collection.md'
  - 'TanStack/db:docs/guides/collection-options-creator.md'
  - 'TanStack/db:packages/db/src/collection/sync.ts'
---

# Sync & Connectivity

## Setup

Every collection has a sync configuration that connects it to a data
source. The adapter options creators handle this — you rarely write
`SyncConfig` directly unless building a custom adapter.

```typescript
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'

const todosCollection = createCollection(
  electricCollectionOptions({
    shapeOptions: {
      url: '/api/todos',
    },
    getKey: (todo) => todo.id,
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const response = await api.todos.update({
        where: { id: original.id },
        data: changes,
      })
      // Return txid so optimistic state holds until Electric syncs it
      return { txid: response.txid }
    },
  }),
)
```

## Core Patterns

### Sync modes

| Mode              | When to use                           | How it works                                                    |
| ----------------- | ------------------------------------- | --------------------------------------------------------------- |
| `eager` (default) | < 10k rows of relatively static data  | Loads entire collection upfront                                 |
| `on-demand`       | > 50k rows, search interfaces         | Loads only what active queries request                          |
| `progressive`     | Need immediate results + full dataset | Loads query subset first, then syncs full dataset in background |

```typescript
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const productsCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['products'],
    queryFn: async (ctx) => {
      // On-demand: ctx.meta.loadSubsetOptions contains query predicates
      const params = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions)
      return api.getProducts(params)
    },
    syncMode: 'on-demand',
    getKey: (p) => p.id,
  }),
)
```

### Electric txid tracking

With ElectricSQL, track the transaction ID to prevent optimistic state
flash — hold optimistic state until the sync stream catches up:

```typescript
electricCollectionOptions({
  shapeOptions: { url: '/api/todos' },
  getKey: (t) => t.id,
  onInsert: async ({ transaction }) => {
    const newItem = transaction.mutations[0].modified
    const response = await api.todos.create(newItem)
    // Hold optimistic state until Electric streams this txid
    return { txid: response.txid }
  },
})
```

### Query collection direct writes

For query-backed collections, you can update the local collection without
a full refetch using direct write methods:

```typescript
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const collection = createCollection(
  queryCollectionOptions({
    queryKey: ['items'],
    queryFn: () => api.getItems(),
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const item = transaction.mutations[0].modified
      const saved = await api.createItem(item)
      // Write the server response directly instead of refetching
      collection.utils.writeUpsert(saved)
    },
  }),
)
```

Direct write methods: `writeInsert`, `writeUpdate`, `writeDelete`,
`writeUpsert`, `writeBatch`.

### Building a custom sync adapter

Implement the `SyncConfig` interface. Key requirement: subscribe to
changes BEFORE the initial fetch to prevent race conditions.

```typescript
function myCollectionOptions<T>(config: MyConfig<T>) {
  return {
    getKey: config.getKey,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        const eventBuffer: Array<any> = []
        let initialSyncDone = false

        // 1. Subscribe to live changes FIRST
        const unsub = config.subscribe((event) => {
          if (!initialSyncDone) {
            eventBuffer.push(event)
            return
          }
          begin()
          write({ key: event.key, type: event.type, value: event.data })
          commit()
        })

        // 2. Then fetch initial data
        config.fetchAll().then((items) => {
          begin()
          for (const item of items) {
            write({ key: config.getKey(item), type: 'insert', value: item })
          }
          commit()

          // 3. Flush buffered events
          initialSyncDone = true
          if (eventBuffer.length > 0) {
            begin()
            for (const event of eventBuffer) {
              write({ key: event.key, type: event.type, value: event.data })
            }
            commit()
          }

          // 4. ALWAYS call markReady
          markReady()
        })

        return () => unsub()
      },
    },
  }
}
```

### Offline transactions

For apps that need offline support, `@tanstack/offline-transactions`
provides a persistent outbox integrated with the TanStack DB transaction
model:

```typescript
import {
  startOfflineExecutor,
  IndexedDBAdapter,
  WebLocksLeader,
} from '@tanstack/offline-transactions'

const executor = startOfflineExecutor({
  storage: new IndexedDBAdapter({ dbName: 'my-app-offline' }),
  leaderElection: new WebLocksLeader(),
  retryPolicy: { maxRetries: 5, backoff: 'exponential' },
})
```

Only adopt offline transactions when you genuinely need offline support.
It adds complexity — PowerSync and RxDB handle their own local
persistence, which is a separate concern from offline transaction queuing.

## References

- [references/electric.md](references/electric.md) — ElectricSQL adapter: config, txid matching, awaitTxId/awaitMatch, sync modes
- [references/query.md](references/query.md) — TanStack Query adapter: config, refetch, direct writes, query state, on-demand mode
- [references/powersync.md](references/powersync.md) — PowerSync adapter: SQLite persistence, schema overloads, serializer, deserialization
- [references/rxdb.md](references/rxdb.md) — RxDB adapter: Observable-driven sync, storage-engine direct reads, automatic mutations
- [references/trailbase.md](references/trailbase.md) — TrailBase adapter: event streaming, bidirectional type conversions, cursor pagination

## Common Mistakes

### CRITICAL — Electric txid queried outside mutation transaction

The backend must generate the txid INSIDE the same SQL transaction as the
mutation. The handler itself calls an API — the bug is in server code.

Wrong (server-side):

```typescript
// Server: txid queried OUTSIDE the mutation transaction
async function createTodo(data) {
  const txid = await generateTxId(sql) // separate transaction!
  await sql.begin(async (tx) => {
    await tx`INSERT INTO todos ${tx(data)}`
  })
  return { txid } // This txid won't match the mutation
}
```

Correct (server-side):

```typescript
// Server: txid queried INSIDE the mutation transaction
async function createTodo(data) {
  let txid
  const result = await sql.begin(async (tx) => {
    txid = await generateTxId(tx) // same transaction!
    const [todo] = await tx`INSERT INTO todos ${tx(data)} RETURNING *`
    return todo
  })
  return { todo: result, txid }
}

async function generateTxId(tx) {
  // ::xid cast strips epoch to match Electric's replication stream
  const result = await tx`SELECT pg_current_xact_id()::xid::text as txid`
  return parseInt(result[0].txid, 10)
}
```

Client handler (correct):

```typescript
onInsert: async ({ transaction }) => {
  const newItem = transaction.mutations[0].modified
  const response = await api.todos.create(newItem)
  return { txid: response.txid }
},
```

`pg_current_xact_id()` must be queried INSIDE the same SQL transaction
as the mutation. A separate query runs in its own transaction, returning a
different txid. The client's `awaitTxId` then waits for a txid that never
arrives in the sync stream — it stalls forever.

Source: docs/collections/electric-collection.md — Debugging txid section

### CRITICAL — Not calling markReady() in custom sync implementation

Wrong:

```typescript
sync: ({ begin, write, commit }) => {
  fetchData().then((items) => {
    begin()
    items.forEach((item) => write({ type: 'insert', value: item }))
    commit()
    // Forgot markReady() — collection stays in 'loading' forever
  })
}
```

Correct:

```typescript
sync: ({ begin, write, commit, markReady }) => {
  fetchData()
    .then((items) => {
      begin()
      items.forEach((item) => write({ type: 'insert', value: item }))
      commit()
      markReady()
    })
    .catch(() => {
      markReady() // Call even on error
    })
}
```

`markReady()` transitions the collection from `loading` to `ready`. Without
it, live queries never resolve and `useLiveSuspenseQuery` hangs in Suspense
forever. Always call `markReady()`, even on error.

Source: docs/guides/collection-options-creator.md

### CRITICAL — queryFn returning partial data without merging

Wrong:

```typescript
queryCollectionOptions({
  queryFn: async () => {
    // Only returns items modified since last fetch
    return api.getModifiedSince(lastFetchTime)
  },
})
```

Correct:

```typescript
queryCollectionOptions({
  queryFn: async () => {
    // Returns the complete current state
    return api.getAllItems()
  },
})
```

`queryFn` result is treated as the complete server state. Returning only
new/changed items causes all non-returned items to be deleted from the
collection. For incremental fetches, use direct writes (`writeUpsert`,
`writeBatch`) instead.

Source: docs/collections/query-collection.md — Handling Partial/Incremental Fetches

### HIGH — Race condition: subscribing after initial fetch loses changes

Wrong:

```typescript
sync: ({ begin, write, commit, markReady }) => {
  // Fetch first
  fetchAll().then((items) => {
    begin()
    items.forEach((item) => write({ type: 'insert', value: item }))
    commit()
    markReady()
  })
  // Subscribe after — changes during fetch are lost
  subscribe((event) => {
    begin()
    write({ type: event.type, value: event.data })
    commit()
  })
}
```

Correct:

```typescript
sync: ({ begin, write, commit, markReady }) => {
  const buffer: any[] = []
  let ready = false

  // Subscribe FIRST, buffer events during initial fetch
  const unsub = subscribe((event) => {
    if (!ready) {
      buffer.push(event)
      return
    }
    begin()
    write({ type: event.type, value: event.data })
    commit()
  })

  fetchAll().then((items) => {
    begin()
    items.forEach((item) => write({ type: 'insert', value: item }))
    commit()
    ready = true
    buffer.forEach((event) => {
      begin()
      write({ type: event.type, value: event.data })
      commit()
    })
    markReady()
  })

  return () => unsub()
}
```

Subscribe to live changes before the initial fetch. Buffer events during
the fetch, then replay them. Otherwise changes that occur during the
initial fetch window are silently lost.

Source: docs/guides/collection-options-creator.md — Race condition prevention

### HIGH — write() called without begin() in sync implementation

Wrong:

```typescript
sync: ({ write, commit, markReady }) => {
  fetchAll().then((items) => {
    items.forEach((item) => write({ type: 'insert', value: item }))
    commit()
    markReady()
  })
}
```

Correct:

```typescript
sync: ({ begin, write, commit, markReady }) => {
  fetchAll().then((items) => {
    begin()
    items.forEach((item) => write({ type: 'insert', value: item }))
    commit()
    markReady()
  })
}
```

Sync data must be written within a transaction: `begin()` → `write()` →
`commit()`. Calling `write()` without `begin()` throws
`NoPendingSyncTransactionWriteError`.

Source: packages/db/src/collection/sync.ts:110

### MEDIUM — Direct writes overridden by next query sync

Wrong:

```typescript
// Write directly, but next queryFn execution overwrites it
collection.utils.writeInsert(newItem)
// queryFn runs on refetch interval → returns server state without newItem
// newItem disappears
```

Correct:

```typescript
// Option 1: Ensure server has the item before next refetch
await api.createItem(newItem)
collection.utils.writeInsert(newItem)

// Option 2: Coordinate with staleTime to delay refetch
queryCollectionOptions({
  staleTime: 30000, // 30s before refetch
})
```

Direct writes update the collection immediately, but the next `queryFn`
execution returns the complete server state, overwriting direct writes.
Either ensure the server has the data before the next refetch, or
coordinate `staleTime` to delay it.

Source: docs/collections/query-collection.md — Direct Writes and Query Sync
