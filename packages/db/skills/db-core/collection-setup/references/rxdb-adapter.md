# RxDB Adapter Reference

## Install

```bash
pnpm add @tanstack/rxdb-db-collection rxdb @tanstack/react-db
```

## Required Config

```typescript
import { createCollection } from '@tanstack/react-db'
import { rxdbCollectionOptions } from '@tanstack/rxdb-db-collection'

const todosCollection = createCollection(
  rxdbCollectionOptions({
    rxCollection: db.todos,
  }),
)
```

- `rxCollection` -- the underlying RxDB `RxCollection` instance

## Optional Config (with defaults)

| Option          | Default                 | Description                                                                                        |
| --------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| `id`            | (none)                  | Unique collection identifier                                                                       |
| `schema`        | (none)                  | StandardSchema validator (RxDB has its own validation; this adds TanStack DB-side validation)      |
| `startSync`     | `true`                  | Start ingesting RxDB data immediately                                                              |
| `syncBatchSize` | `1000`                  | Max documents per batch during initial sync from RxDB; only affects initial load, not live updates |
| `onInsert`      | (default: `bulkUpsert`) | Override default insert persistence                                                                |
| `onUpdate`      | (default: `patch`)      | Override default update persistence                                                                |
| `onDelete`      | (default: `bulkRemove`) | Override default delete persistence                                                                |

## Key Behavior: String Keys

RxDB primary keys are always strings. The `getKey` function is derived from the RxDB schema's `primaryKey` field automatically. All key values will be strings.

## RxDB Setup (prerequisite)

```typescript
import { createRxDatabase } from 'rxdb/plugins/core'
import { getRxStorageLocalstorage } from 'rxdb/plugins/storage-localstorage'

const db = await createRxDatabase({
  name: 'my-app',
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
```

## Backend Sync (optional, RxDB-managed)

Replication is configured directly on the RxDB collection, independent of TanStack DB. Changes from replication flow into the TanStack DB collection via RxDB's change stream automatically.

```typescript
import { replicateRxCollection } from 'rxdb/plugins/replication'

const replicationState = replicateRxCollection({
  collection: db.todos,
  pull: { handler: myPullHandler },
  push: { handler: myPushHandler },
})
```

## Data Flow

- Writes via `todosCollection.insert/update/delete` persist to RxDB
- Direct RxDB writes (or replication changes) flow into the TanStack collection via change streams
- Initial sync loads data in batches of `syncBatchSize`
- Ongoing updates stream one by one via RxDB's change feed

## Indexes

RxDB schema indexes do not affect TanStack DB query performance (queries run in-memory). Indexes may still matter if you query RxDB directly, use filtered replication, or selectively load subsets.

## Complete Example

```typescript
import { createRxDatabase } from 'rxdb/plugins/core'
import { getRxStorageLocalstorage } from 'rxdb/plugins/storage-localstorage'
import { createCollection } from '@tanstack/react-db'
import { rxdbCollectionOptions } from '@tanstack/rxdb-db-collection'
import { z } from 'zod'

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

const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  completed: z.boolean(),
})

const todosCollection = createCollection(
  rxdbCollectionOptions({
    rxCollection: db.todos,
    schema: todoSchema,
    startSync: true,
    syncBatchSize: 500,
  }),
)

// Usage
todosCollection.insert({
  id: crypto.randomUUID(),
  text: 'Buy milk',
  completed: false,
})
todosCollection.update('some-id', (draft) => {
  draft.completed = true
})
todosCollection.delete('some-id')
```
