# PowerSync Adapter Reference

## Install

```bash
pnpm add @tanstack/powersync-db-collection @powersync/web @journeyapps/wa-sqlite
```

## Required Config

```typescript
import { createCollection } from '@tanstack/react-db'
import { powerSyncCollectionOptions } from '@tanstack/powersync-db-collection'
import { Schema, Table, column, PowerSyncDatabase } from '@powersync/web'

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

- `database` -- `PowerSyncDatabase` instance
- `table` -- PowerSync `Table` from schema (provides `getKey` and type inference)

## Optional Config (with defaults)

| Option                   | Default | Description                                                                           |
| ------------------------ | ------- | ------------------------------------------------------------------------------------- |
| `schema`                 | (none)  | StandardSchema for mutation validation                                                |
| `deserializationSchema`  | (none)  | Transforms SQLite types to output types; required when input types differ from SQLite |
| `onDeserializationError` | (none)  | Fatal error handler; **required** when using `schema` or `deserializationSchema`      |
| `serializer`             | (none)  | Per-field functions to serialize output types back to SQLite                          |
| `syncBatchSize`          | `1000`  | Batch size for initial sync                                                           |

### SQLite Type Mapping

| PowerSync Column | TypeScript Type  |
| ---------------- | ---------------- |
| `column.text`    | `string \| null` |
| `column.integer` | `number \| null` |
| `column.real`    | `number \| null` |

All columns nullable by default. `id: string` is always included automatically.

## Conversions (4 patterns)

### 1. Type Inference Only (no schema)

```typescript
const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
  }),
)
// Input/Output: { id: string, name: string | null, created_at: string | null, ... }
```

### 2. Schema Validation (same SQLite types)

```typescript
const schema = z.object({
  id: z.string(),
  name: z.string().min(3),
  author: z.string(),
  created_at: z.string(),
  archived: z.number(),
})
const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
    schema,
    onDeserializationError: (error) => {
      /* fatal */
    },
  }),
)
```

### 3. Transform SQLite to Rich Output Types

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
const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
    schema,
    onDeserializationError: (error) => {
      /* fatal */
    },
    serializer: { created_at: (value) => (value ? value.toISOString() : null) },
  }),
)
// Input:  { created_at: string | null, ... }
// Output: { created_at: Date | null, archived: boolean | null, ... }
```

### 4. Custom Input + Output with deserializationSchema

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
const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
    schema,
    deserializationSchema,
    onDeserializationError: (error) => {
      /* fatal */
    },
  }),
)
// Input:  { created_at: Date, archived: boolean }
// Output: { created_at: Date, archived: boolean }
```

## Metadata Tracking

Enable on the table, then pass metadata with operations:

```typescript
const APP_SCHEMA = new Schema({
  documents: new Table({ name: column.text }, { trackMetadata: true }),
})

await collection.insert(
  { id: crypto.randomUUID(), name: 'Report' },
  { metadata: { source: 'web-app', userId: 'user-123' } },
).isPersisted.promise
```

Metadata appears as `entry.metadata` (stringified JSON) in PowerSync `CrudEntry`.

## Advanced Transactions

```typescript
import { createTransaction } from '@tanstack/react-db'
import { PowerSyncTransactor } from '@tanstack/powersync-db-collection'

const tx = createTransaction({
  autoCommit: false,
  mutationFn: async ({ transaction }) => {
    await new PowerSyncTransactor({ database: db }).applyTransaction(
      transaction,
    )
  },
})
tx.mutate(() => {
  documentsCollection.insert({
    id: crypto.randomUUID(),
    name: 'Doc 1',
    created_at: new Date().toISOString(),
  })
})
await tx.commit()
await tx.isPersisted.promise
```

## Complete Example

```typescript
import { Schema, Table, column, PowerSyncDatabase } from '@powersync/web'
import { createCollection } from '@tanstack/react-db'
import { powerSyncCollectionOptions } from '@tanstack/powersync-db-collection'
import { z } from 'zod'

const APP_SCHEMA = new Schema({
  tasks: new Table({
    title: column.text,
    due_date: column.text,
    completed: column.integer,
  }),
})
const db = new PowerSyncDatabase({
  database: { dbFilename: 'app.sqlite' },
  schema: APP_SCHEMA,
})

const taskSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  due_date: z
    .string()
    .nullable()
    .transform((val) => (val ? new Date(val) : null)),
  completed: z
    .number()
    .nullable()
    .transform((val) => (val != null ? val > 0 : null)),
})

const tasksCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.tasks,
    schema: taskSchema,
    onDeserializationError: (error) => console.error('Fatal:', error),
    syncBatchSize: 500,
  }),
)
```
