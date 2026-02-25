# PowerSync Adapter Reference

Package: `@tanstack/powersync-db-collection`

## Setup

```typescript
import { createCollection } from '@tanstack/db'
import { powerSyncCollectionOptions } from '@tanstack/powersync-db-collection'
import { Schema, Table, column } from '@powersync/common'
import { PowerSyncDatabase } from '@powersync/web'

const APP_SCHEMA = new Schema({
  todos: new Table({
    text: column.text,
    completed: column.integer, // booleans stored as 0/1
  }),
})

const db = new PowerSyncDatabase({
  database: { dbFilename: 'my-app.sqlite' },
  schema: APP_SCHEMA,
})

const todosCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.todos,
  }),
)
```

PowerSync manages mutations automatically — you do NOT provide `onInsert`,
`onUpdate`, or `onDelete` handlers. The adapter writes mutations directly
to the local SQLite database via a transactor, and PowerSync's sync engine
handles replication to the server.

## Configuration

```typescript
powerSyncCollectionOptions({
  // Required
  database: AbstractPowerSyncDatabase,
  table: Table,

  // Optional
  id: string,
  schema: StandardSchemaV1,    // additional validation
  syncBatchSize: number,       // default 1000
})
```

## Three Overloads

The function has three overloads depending on how you handle types:

### 1. No schema — SQLite types only

```typescript
const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.todos,
  }),
)
// Types: { id: string, text: string | null, completed: number | null }
```

### 2. Schema with SQLite-compatible input

Use when schema input types match SQLite column types but you want
richer output types (e.g. Date from string):

```typescript
import { z } from 'zod'

const schema = z.object({
  id: z.string(),
  name: z.string().min(3).nullable(),
  created_at: z.string().transform((val) => new Date(val)),
})

const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
    schema,
    serializer: {
      created_at: (date) => date.toISOString(),
    },
  }),
)
```

### 3. Schema with arbitrary input types

Use when input types don't match SQLite types (e.g. accepting booleans
instead of integers). Requires a `deserializationSchema`:

```typescript
const schema = z.object({
  id: z.string(),
  isActive: z.boolean(),
})

const deserializationSchema = z.object({
  id: z.string(),
  isActive: z.number().nullable().transform((val) => val == null ? true : val > 0),
})

const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.items,
    schema,
    deserializationSchema,
  }),
)
```

## Serializer

When output types differ from SQLite types, you need a serializer to
convert back to SQLite for persistence:

```typescript
powerSyncCollectionOptions({
  database: db,
  table: APP_SCHEMA.props.documents,
  schema,
  serializer: {
    created_at: (date) => date.toISOString(),
    meta: (obj) => JSON.stringify(obj),
    isActive: (bool) => bool ? 1 : 0,
  },
  onDeserializationError: (error) => {
    console.error('Failed to deserialize sync data:', error)
  },
})
```

Default serialization:
- `TEXT`: strings as-is, Dates as ISO strings, objects JSON-stringified
- `INTEGER`/`REAL`: numbers as-is, booleans as 1/0

## Utils

```typescript
// Get collection metadata
const meta = collection.utils.getMeta()
meta.tableName         // SQLite view name
meta.trackedTableName  // internal diff tracking table
meta.metadataIsTracked // whether PowerSync tracks metadata
meta.serializeValue(item) // serialize to SQLite types
```

## Key Differences from Other Adapters

- **No mutation handlers**: PowerSync handles mutations via its own
  transactor — writing directly to SQLite
- **SQLite-backed**: Data persists locally in SQLite, synced via
  PowerSync's replication protocol
- **getKey is automatic**: Always uses the `id` column (PowerSync
  requirement)
- **startSync is always true**: Syncing begins immediately since
  the adapter monitors SQLite changes via diff triggers
- **Batch loading**: Initial sync reads from SQLite in batches
  (configurable via `syncBatchSize`, default 1000)
