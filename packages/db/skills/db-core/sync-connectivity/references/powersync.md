# PowerSync Adapter Reference

Package: `@tanstack/powersync-db-collection`

## Setup

```typescript
import { Schema, Table, column } from '@powersync/web'
import { PowerSyncDatabase } from '@powersync/web'
import { createCollection } from '@tanstack/react-db'
import { powerSyncCollectionOptions } from '@tanstack/powersync-db-collection'

const APP_SCHEMA = new Schema({
  documents: new Table({
    name: column.text,
    author: column.text,
    created_at: column.text,
    archived: column.integer,
  }),
})

const db = new PowerSyncDatabase({
  database: { dbFilename: 'app.sqlite' },
  schema: APP_SCHEMA,
})

const documentsCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
  }),
)
```

PowerSync manages mutations automatically — you do NOT provide
`onInsert`, `onUpdate`, or `onDelete` handlers. The adapter writes
mutations directly to the local SQLite database via a transactor, and
PowerSync's sync engine handles replication to the server.

Source: docs/collections/powersync-collection.md — Basic Usage

## Configuration

```typescript
powerSyncCollectionOptions({
  // Required
  database: AbstractPowerSyncDatabase,
  table: Table,

  // Optional
  id: string,
  schema: StandardSchemaV1,           // additional validation
  deserializationSchema: StandardSchemaV1, // for custom input types
  onDeserializationError: (error) => void, // required with schema
  serializer: { [key]: (value) => sqliteValue },
  syncBatchSize: number,              // default 1000
})
```

Source: docs/collections/powersync-collection.md — Configuration Options

## SQLite Type Mapping

| PowerSync Column Type | TypeScript Type  |
| --------------------- | ---------------- |
| `column.text`         | `string \| null` |
| `column.integer`      | `number \| null` |
| `column.real`         | `number \| null` |

All PowerSync column types are nullable by default.

Source: docs/collections/powersync-collection.md — Type mapping table

## Option 1: Table Type Inference (no schema)

Types inferred from the PowerSync schema table definition:

```typescript
const documentsCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
  }),
)
// Input/Output: { id: string, name: string | null, author: string | null, ... }
```

Source: docs/collections/powersync-collection.md — Option 1

## Option 2: SQLite Types with Schema Validation

Schema adds constraints while keeping SQLite-compatible types:

```typescript
import { z } from 'zod'

const schema = z.object({
  id: z.string(),
  name: z.string().min(3, { message: 'Should be at least 3 characters' }),
  author: z.string(),
  created_at: z.string(),
  archived: z.number(),
})

const documentsCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
    schema,
    onDeserializationError: (error) => {
      // Handle fatal deserialization error
    },
  }),
)
```

Source: docs/collections/powersync-collection.md — Option 2

## Option 3: Transform SQLite to Rich Types

Transform SQLite types to richer JavaScript types (Date, boolean):

```typescript
const schema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  created_at: z
    .string()
    .nullable()
    .transform((val) => (val ? new Date(val) : null)),
  archived: z
    .number()
    .nullable()
    .transform((val) => (val != null ? val > 0 : null)),
})

const documentsCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
    schema,
    onDeserializationError: (error) => {
      // Handle fatal deserialization error
    },
    serializer: {
      created_at: (value) => (value ? value.toISOString() : null),
    },
  }),
)
// Input: { name: string | null, created_at: string | null, ... }
// Output: { name: string | null, created_at: Date | null, archived: boolean | null, ... }
```

Source: docs/collections/powersync-collection.md — Option 3

## Option 4: Custom Input/Output with Deserialization

Decouple input/output types completely from SQLite types. Requires a
`deserializationSchema` to convert incoming SQLite data:

```typescript
const schema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.date(),
  archived: z.boolean(),
})

const deserializationSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.string().transform((val) => new Date(val)),
  archived: z.number().transform((val) => val > 0),
})

const documentsCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
    schema,
    deserializationSchema,
    onDeserializationError: (error) => {
      // Handle fatal deserialization error
    },
  }),
)
// Input AND Output: { name: string, created_at: Date, archived: boolean, ... }
```

Source: docs/collections/powersync-collection.md — Option 4

## Serializer

When output types differ from SQLite types, provide a serializer to
convert values back to SQLite for persistence:

```typescript
serializer: {
  created_at: (value) => (value ? value.toISOString() : null),
  meta: (obj) => JSON.stringify(obj),
  isActive: (bool) => (bool ? 1 : 0),
}
```

Default serialization:

- `TEXT`: strings as-is, Dates as ISO strings, objects JSON-stringified
- `INTEGER`/`REAL`: numbers as-is, booleans as 1/0

Source: packages/powersync-db-collection/src/serialization.ts

## Utils

```typescript
const meta = collection.utils.getMeta()
meta.tableName // SQLite view name
meta.trackedTableName // internal diff tracking table
meta.metadataIsTracked // whether PowerSync tracks metadata
meta.serializeValue(item) // serialize to SQLite types
```

Source: packages/powersync-db-collection/src/definitions.ts:277-279

## Metadata Tracking

Enable metadata tracking on the PowerSync table to attach custom
metadata to operations:

```typescript
const APP_SCHEMA = new Schema({
  documents: new Table({ name: column.text }, { trackMetadata: true }),
})

// Insert with metadata
await documentsCollection.insert(
  { id: crypto.randomUUID(), name: 'Report' },
  { metadata: { source: 'web-app', userId: 'user-123' } },
).isPersisted.promise
```

Source: docs/collections/powersync-collection.md — Metadata Tracking

## Key Differences from Other Adapters

- **No user-provided mutation handlers**: PowerSync handles mutations
  via its own transactor — writing directly to SQLite
- **SQLite-backed**: Data persists locally in SQLite, synced via
  PowerSync's replication protocol
- **getKey is automatic**: Always uses the `id` column
- **startSync is always true**: Syncing begins immediately since
  the adapter monitors SQLite changes via diff triggers
- **Batch loading**: Initial sync reads from SQLite in batches
  (configurable via `syncBatchSize`, default 1000)
- **`onDeserializationError` required with schema**: Failing to
  deserialize synced data is a fatal error — must be handled
