---
name: tanstack-db-rxdb
description: |
  RxDBCollection with RxDB integration.
  Use for reactive local databases, offline persistence, and RxDB sync protocols.
---

# RxDBCollection

RxDBCollection integrates RxDB with TanStack DB, enabling reactive local databases with various storage backends. Changes in RxDB automatically sync to the in-memory collection, and mutations are persisted via RxDB's document API.

## Common Patterns

### Basic Setup

```tsx
import { createCollection } from '@tanstack/react-db'
import { rxdbCollectionOptions } from '@tanstack/rxdb-db-collection'
import { createRxDatabase, addRxPlugin } from 'rxdb'
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode'
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie'

// Enable dev mode (optional, for development)
addRxPlugin(RxDBDevModePlugin)

// Create RxDB database
const rxdb = await createRxDatabase({
  name: 'myapp',
  storage: getRxStorageDexie(),
})

// Add collection to RxDB
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
        createdAt: { type: 'string' },
      },
      required: ['id', 'text', 'completed'],
    },
  },
})

// Create TanStack DB collection
const todoCollection = createCollection(
  rxdbCollectionOptions({
    rxCollection: rxdb.todos,
  }),
)
```

### With Schema Validation

```tsx
import { z } from 'zod'

const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  completed: z.boolean(),
  createdAt: z.string().transform((v) => new Date(v)),
})

type Todo = z.output<typeof todoSchema>

const todoCollection = createCollection(
  rxdbCollectionOptions<Todo>({
    rxCollection: rxdb.todos,
    schema: todoSchema,
  }),
)
```

### Explicit Type Without Schema

```tsx
interface Todo {
  id: string
  text: string
  completed: boolean
  createdAt: string
}

const todoCollection = createCollection(
  rxdbCollectionOptions<Todo>({
    rxCollection: rxdb.todos,
  }),
)
```

## How It Works

1. **Initial Sync**: On collection creation, existing RxDB documents are batched into the in-memory collection using cursor-based pagination
2. **Live Updates**: RxDB's observable stream (`rxCollection.$`) pushes INSERT/UPDATE/DELETE events to the collection
3. **Mutations**:
   - `insert` uses `rxCollection.bulkUpsert()`
   - `update` uses `doc.incrementalPatch()`
   - `delete` uses `rxCollection.bulkRemove()`

## Key Behaviors

### Primary Key

RxDB primary keys must be strings. The collection automatically uses RxDB's `primaryPath`:

```tsx
// RxDB schema
schema: {
  primaryKey: 'id', // This becomes getKey
  // ...
}

// TanStack DB automatically uses:
getKey: (item) => item.id
```

### RxDB Fields Stripped

Internal RxDB fields (`_rev`, `_attachments`, `_deleted`, `_meta`) are automatically stripped from documents before they enter the TanStack DB collection.

### Sync Batching

Control how many documents sync at once during initial load:

```tsx
const todoCollection = createCollection(
  rxdbCollectionOptions({
    rxCollection: rxdb.todos,
    syncBatchSize: 500, // Default: 1000
  }),
)
```

## Configuration Options

```tsx
rxdbCollectionOptions({
  // Required
  rxCollection: RxCollection, // RxDB collection instance

  // Optional
  schema?: StandardSchema,    // Validation/transform schema (Zod, Valibot, etc.)
  syncBatchSize?: number,     // Docs per batch during initial sync (default: 1000)
})
```

## Type Resolution Priority

1. **Schema inference** (highest): If `schema` is provided, types are inferred from it
2. **Explicit type**: Generic parameter `rxdbCollectionOptions<Todo>(...)`

```tsx
// Option 1: Schema inference
const collection = createCollection(
  rxdbCollectionOptions({
    rxCollection: rxdb.todos,
    schema: todoSchema, // Types inferred from schema
  }),
)

// Option 2: Explicit type
const collection = createCollection(
  rxdbCollectionOptions<Todo>({
    rxCollection: rxdb.todos,
  }),
)
```

## RxDB Storage Options

RxDB supports multiple storage backends:

```tsx
// IndexedDB (browser)
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie'
const storage = getRxStorageDexie()

// Memory (testing)
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
const storage = getRxStorageMemory()

// SQLite (React Native, Electron)
import { getRxStorageSQLite } from 'rxdb-premium/plugins/storage-sqlite'
const storage = getRxStorageSQLite({ sqliteBasics: SQLite })

// LokiJS (faster writes, memory-heavy)
import { getRxStorageLoki } from 'rxdb/plugins/storage-loki'
const storage = getRxStorageLoki()
```

## Common Patterns

### With RxDB Replication

RxDB collections can sync with remote servers:

```tsx
import { replicateRxCollection } from 'rxdb/plugins/replication'

// Set up RxDB replication
const replication = replicateRxCollection({
  collection: rxdb.todos,
  replicationIdentifier: 'todos-replication',
  push: {
    handler: async (docs) => {
      await api.todos.sync(docs)
      return []
    },
  },
  pull: {
    handler: async (lastCheckpoint) => {
      return api.todos.changes(lastCheckpoint)
    },
  },
})

// TanStack DB collection automatically sees replicated changes
const todoCollection = createCollection(
  rxdbCollectionOptions({
    rxCollection: rxdb.todos,
  }),
)
```

### Multiple Collections

```tsx
// Add multiple RxDB collections
await rxdb.addCollections({
  todos: { schema: todoRxSchema },
  projects: { schema: projectRxSchema },
  tags: { schema: tagRxSchema },
})

// Create TanStack DB collections for each
const todoCollection = createCollection(
  rxdbCollectionOptions({ rxCollection: rxdb.todos }),
)
const projectCollection = createCollection(
  rxdbCollectionOptions({ rxCollection: rxdb.projects }),
)
const tagCollection = createCollection(
  rxdbCollectionOptions({ rxCollection: rxdb.tags }),
)

// Now use joins across collections
const todosWithProjects = useLiveQuery((db) =>
  db.todos
    .leftJoin(
      db.projects,
      (todo) => todo.projectId,
      (project) => project.id,
    )
    .select(todo, (project) => ({
      ...todo,
      projectName: project?.name,
    })),
)
```

### Cleanup

RxDB subscriptions are tracked for proper cleanup:

```tsx
import { OPEN_RXDB_SUBSCRIPTIONS } from '@tanstack/rxdb-db-collection'

// Check active subscriptions (useful for testing)
const subs = OPEN_RXDB_SUBSCRIPTIONS.get(rxdb.todos)
console.log('Active subscriptions:', subs?.size)

// Cleanup when unmounting
todoCollection.cleanup()
```

## RxDB Schema Requirements

RxDB has specific schema requirements:

```tsx
const rxSchema = {
  version: 0, // Schema version for migrations
  primaryKey: 'id', // Must be string type
  type: 'object',
  properties: {
    id: {
      type: 'string',
      maxLength: 100, // Required for primary key
    },
    // ... other fields
  },
  required: ['id'], // Primary key must be required
}
```

## Detailed References

| Reference                        | When to Use                           |
| -------------------------------- | ------------------------------------- |
| `references/storage-backends.md` | Choosing and configuring RxDB storage |
| `references/replication.md`      | RxDB replication patterns             |
| `references/migrations.md`       | Schema versioning and migrations      |
