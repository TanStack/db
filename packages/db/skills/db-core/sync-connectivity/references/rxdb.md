# RxDB Adapter Reference

Package: `@tanstack/rxdb-db-collection`

## Setup

```typescript
import { createRxDatabase, addRxPlugin } from 'rxdb/plugins/core'
import { getRxStorageLocalstorage } from 'rxdb/plugins/storage-localstorage'
import { createCollection } from '@tanstack/react-db'
import { rxdbCollectionOptions } from '@tanstack/rxdb-db-collection'

type Todo = { id: string; text: string; completed: boolean }

const db = await createRxDatabase({
  name: 'my-todos',
  storage: getRxStorageLocalstorage(),
})

await db.addCollections({
  todos: {
    schema: {
      title: 'todos',
      version: 0,
      type: 'object',
      primaryKey: 'id',
      properties: {
        id: { type: 'string', maxLength: 100 },
        text: { type: 'string' },
        completed: { type: 'boolean' },
      },
      required: ['id', 'text', 'completed'],
    },
  },
})

const todosCollection = createCollection(
  rxdbCollectionOptions({
    rxCollection: db.todos,
    startSync: true,
  }),
)
```

Source: docs/collections/rxdb-collection.md — Setup steps 1-4

## Configuration

```typescript
rxdbCollectionOptions({
  // Required
  rxCollection: RxCollection<T>,

  // Optional
  id: string,
  schema: StandardSchemaV1,  // additional validation on top of RxDB schema
  startSync: boolean,        // default: true
  syncBatchSize: number,     // default 1000
})
```

Source: docs/collections/rxdb-collection.md — Configuration Options

## Two Overloads

### 1. No schema — types from RxDB collection

```typescript
const collection = createCollection(
  rxdbCollectionOptions({
    rxCollection: db.todos,
  }),
)
```

Types are inferred from the RxDB collection's document type.

### 2. With schema — additional validation

```typescript
import { z } from 'zod'

const schema = z.object({
  id: z.string(),
  text: z.string().min(1),
  completed: z.boolean(),
})

const collection = createCollection(
  rxdbCollectionOptions({
    rxCollection: db.todos,
    schema,
  }),
)
```

Provide EITHER an explicit type via the generic OR a schema, not both.

Source: packages/rxdb-db-collection/src/rxdb.ts:88-102

## How Sync Works

The adapter syncs between the local RxDB collection and the in-memory
TanStack DB collection. This is NOT client-server sync — RxDB handles
that separately via its own replication plugins.

1. **Subscribe first**: Subscribes to the RxDB collection's change
   stream (`rxCollection.$`) and buffers events during initial load
2. **Initial fetch**: Reads documents from RxDB storage in batches,
   sorted by last-write-time (`_meta.lwt`), directly from the storage
   engine (bypasses RxDB document cache for efficiency)
3. **Buffer replay**: After initial fetch, replays buffered events
   and calls `markReady()`

Source: packages/rxdb-db-collection/src/rxdb.ts:130-250

## How Mutations Work

Default mutation handlers forward writes to the RxDB collection:

- **Insert**: `rxCollection.bulkUpsert(newItems)` for batch efficiency
- **Update**: `rxCollection.findOne(id).exec()` then
  `doc.incrementalPatch(changes)` for each mutation
- **Delete**: `rxCollection.bulkRemove(ids)` with collected IDs

Source: packages/rxdb-db-collection/src/rxdb.ts:270-311

## Syncing with Backends

Replication is configured entirely on the RxDB side using RxDB's
replication plugins. TanStack DB automatically picks up changes:

```typescript
import { replicateRxCollection } from 'rxdb/plugins/replication'

const replicationState = replicateRxCollection({
  collection: db.todos,
  pull: { handler: myPullHandler },
  push: { handler: myPushHandler },
})
```

Supported backends via RxDB plugins: CouchDB, MongoDB, Supabase,
REST APIs, GraphQL, WebRTC (P2P), and more.

Source: docs/collections/rxdb-collection.md — Syncing with Backends

## Key Differences from Other Adapters

- **Default mutation handlers**: The adapter provides insert, update,
  and delete handlers that write to RxDB. You don't need to write them.
- **getKey is automatic**: Uses the RxDB schema's `primaryPath`
  (always a string in RxDB)
- **RxDB fields stripped**: Internal RxDB fields (`_rev`, `_meta`,
  `_deleted`, `_attachments`) are automatically removed from documents
  before they enter TanStack DB
- **Observable-driven**: Uses RxJS Observable subscription for live
  changes, cleaned up on collection disposal
- **Storage-engine direct**: Initial sync queries the storage engine
  directly rather than going through the RxDB query layer
- **Data is intentionally duplicated**: RxDB stores durably on disk,
  TanStack DB stores in memory for fast queries and reactivity

Source: docs/collections/rxdb-collection.md — FAQ
