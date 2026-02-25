# RxDB Adapter Reference

Package: `@tanstack/rxdb-db-collection`

## Setup

```typescript
import { createCollection } from '@tanstack/db'
import { rxdbCollectionOptions } from '@tanstack/rxdb-db-collection'
import { createRxDatabase, addRxPlugin } from 'rxdb'
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie'

const rxdb = await createRxDatabase({
  name: 'mydb',
  storage: getRxStorageDexie(),
})

await rxdb.addCollections({
  todos: {
    schema: {
      version: 0,
      primaryKey: 'id',
      type: 'object',
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
    rxCollection: rxdb.todos,
  }),
)
```

## Configuration

```typescript
rxdbCollectionOptions({
  // Required
  rxCollection: RxCollection<T>,

  // Optional
  id: string,
  schema: StandardSchemaV1,  // additional validation on top of RxDB schema
  syncBatchSize: number,     // default 1000
})
```

## Two Overloads

### 1. No schema — types from RxDB collection

```typescript
const collection = createCollection(
  rxdbCollectionOptions({
    rxCollection: rxdb.todos,
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
    rxCollection: rxdb.todos,
    schema,
  }),
)
```

Provide EITHER an explicit type via the generic OR a schema, not both.

## How Sync Works

The adapter syncs between the local RxDB collection and the in-memory
TanStack DB collection (not between client and server — RxDB handles
that separately via its own replication plugins).

1. **Initial fetch**: Reads documents from RxDB storage in batches,
   sorted by last-write-time (`_meta.lwt`), directly from the storage
   engine (bypasses RxDB document cache for efficiency)
2. **Live subscription**: Subscribes to the RxDB collection's change
   stream (`rxCollection.$`) to receive INSERT, UPDATE, and DELETE events
3. **Buffering**: Events during initial fetch are buffered and replayed
   after the initial load completes

## How Mutations Work

Mutations are forwarded to the RxDB collection:

- **Insert**: Uses `rxCollection.bulkUpsert()` for batch efficiency
- **Update**: Finds the document via `rxCollection.findOne()` then
  applies `incrementalPatch()` for each mutation
- **Delete**: Uses `rxCollection.bulkRemove()` with collected IDs

## Key Differences from Other Adapters

- **No mutation handlers**: Like PowerSync, the adapter handles
  mutations automatically via the RxDB collection
- **getKey is automatic**: Uses the RxDB schema's `primaryPath`
  (always a string in RxDB)
- **RxDB fields stripped**: Internal RxDB fields (`_rev`, `_meta`,
  `_deleted`, `_attachments`) are automatically removed from documents
  before they enter TanStack DB
- **Observable-driven**: Uses RxJS Observable subscription for live
  changes, cleaned up on collection disposal
- **Storage-engine direct**: Initial sync queries the storage engine
  directly rather than going through the RxDB query layer
