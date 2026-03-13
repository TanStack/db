---
name: tanstack-db-powersync
description: |
  PowerSyncCollection with PowerSync integration.
  Use for offline-first apps, SQLite persistence, and bidirectional sync.
---

# PowerSyncCollection

PowerSyncCollection integrates PowerSync with TanStack DB, enabling offline-first applications with SQLite persistence and bidirectional sync. Changes in the local SQLite database automatically sync to the in-memory collection, and mutations are persisted to SQLite.

## Common Patterns

### Basic Setup

```tsx
import { createCollection } from '@tanstack/react-db'
import { powerSyncCollectionOptions } from '@tanstack/powersync-db-collection'
import { PowerSyncDatabase, Schema, column, Table } from '@powersync/web'

// Define PowerSync schema
const APP_SCHEMA = new Schema({
  todos: new Table({
    text: column.text,
    completed: column.integer, // SQLite uses integer for boolean
    created_at: column.text,
  }),
})

// Create PowerSync database
const db = new PowerSyncDatabase({
  database: { dbFilename: 'app.sqlite' },
  schema: APP_SCHEMA,
})

// Create TanStack DB collection
const todoCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.todos,
  }),
)
```

### With Schema Validation

```tsx
import { z } from 'zod'

// Zod schema for validation and transforms
const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  completed: z.number().transform((v) => v > 0), // Integer to boolean
  created_at: z.string().transform((v) => new Date(v)),
})

const todoCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.todos,
    schema: todoSchema,
  }),
)
```

### Custom Serialization

When your schema transforms types, provide serializers to convert back to SQLite:

```tsx
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.number().transform((v) => v > 0), // Output: boolean
  created_at: z.string().transform((v) => new Date(v)), // Output: Date
})

const todoCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.todos,
    schema: todoSchema,
    serializer: {
      // Convert boolean back to integer for SQLite
      completed: (value: boolean) => (value ? 1 : 0),
      // Convert Date back to ISO string for SQLite
      created_at: (value: Date) => value.toISOString(),
    },
  }),
)
```

### Arbitrary Input Types

For full type flexibility with custom input and output types:

```tsx
// Schema accepts booleans as input, outputs booleans
const schema = z.object({
  id: z.string(),
  is_active: z.boolean(),
})

// Deserialization schema converts SQLite integers to booleans
const deserializationSchema = z.object({
  id: z.string(),
  is_active: z
    .number()
    .nullable()
    .transform((v) => (v == null ? true : v > 0)),
})

const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.items,
    schema,
    deserializationSchema, // Required when input differs from SQLite types
    serializer: {
      is_active: (value: boolean) => (value ? 1 : 0),
    },
  }),
)
```

## Type System

PowerSyncCollection has three type overloads:

### 1. No Schema (Default)

Input and output types match SQLite column types directly:

```tsx
const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.todos,
  }),
)
// Type: { id: string, text: string | null, completed: number | null }
```

### 2. Schema with SQLite-Compatible Input

Schema validates/transforms but input types remain SQLite-compatible:

```tsx
const schema = z.object({
  id: z.string(),
  text: z.string().nullable(),
  completed: z.number().transform((v) => v > 0),
})

const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.todos,
    schema,
  }),
)
// Input: { id: string, text: string | null, completed: number | null }
// Output: { id: string, text: string | null, completed: boolean }
```

### 3. Schema with Arbitrary Types

Full type flexibility with custom input and output types:

```tsx
const schema = z.object({
  id: z.string(),
  is_active: z.boolean(), // Input and output are boolean
})

const deserializationSchema = z.object({
  id: z.string(),
  is_active: z.number().transform((v) => v > 0),
})

const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.items,
    schema,
    deserializationSchema,
  }),
)
// Input: { id: string, is_active: boolean }
// Output: { id: string, is_active: boolean }
```

## Sync Batching

Control how many rows sync at once during initial load:

```tsx
const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.todos,
    syncBatchSize: 500, // Default: 100
  }),
)
```

## Utility Methods

```tsx
// Get table metadata
const meta = todoCollection.utils.getMeta()
// {
//   tableName: 'todos',
//   trackedTableName: '__todos_tracking_a1b2c3d4',
//   metadataIsTracked: boolean,
//   serializeValue: (value) => SQLiteValue
// }

// Serialize a value for SQLite storage
const sqliteValue = meta.serializeValue({
  text: 'Hello',
  completed: true,
  created_at: new Date(),
})
```

## How It Works

1. **Initial Sync**: On collection creation, existing SQLite rows are batched into the in-memory collection
2. **Diff Triggers**: PowerSync diff triggers monitor the SQLite table for changes
3. **Live Updates**: INSERT/UPDATE/DELETE in SQLite automatically sync to the collection
4. **Mutations**: `collection.insert/update/delete` write to SQLite via PowerSyncTransactor
5. **Conflict Resolution**: PowerSync handles server conflicts via its sync protocol

## Configuration Options

```tsx
powerSyncCollectionOptions({
  // Required
  database: PowerSyncDatabase,    // PowerSync database instance
  table: Table,                   // Table from PowerSync schema

  // Optional
  schema?: StandardSchema,        // Validation/transform schema
  deserializationSchema?: Schema, // Schema for SQLite → output conversion
  serializer?: {                  // Custom output → SQLite converters
    [column: string]: (value) => SQLiteValue,
  },
  syncBatchSize?: number,         // Rows per batch during initial sync (default: 100)
  onDeserializationError?: (error) => void, // Handle validation errors
})
```

## PowerSync Schema Types

| Column Type      | SQLite Type | TypeScript Type  |
| ---------------- | ----------- | ---------------- |
| `column.text`    | TEXT        | `string \| null` |
| `column.integer` | INTEGER     | `number \| null` |
| `column.real`    | REAL        | `number \| null` |

**Note:** PowerSync always adds an `id` column (TEXT PRIMARY KEY) automatically.

## Common Patterns

### Boolean Fields

SQLite doesn't have a boolean type. Use integer with transforms:

```tsx
// PowerSync schema
const schema = new Schema({
  todos: new Table({
    completed: column.integer, // 0 or 1
  }),
})

// Zod schema with transform
const todoSchema = z.object({
  id: z.string(),
  completed: z.number().transform((v) => v > 0),
})

// Serializer to convert back
const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: schema.props.todos,
    schema: todoSchema,
    serializer: {
      completed: (v: boolean) => (v ? 1 : 0),
    },
  }),
)
```

### Date Fields

Store dates as ISO strings in SQLite:

```tsx
// PowerSync schema
const schema = new Schema({
  events: new Table({
    event_date: column.text, // ISO string
  }),
})

// Zod schema with transform
const eventSchema = z.object({
  id: z.string(),
  event_date: z.string().transform((v) => new Date(v)),
})

// Serializer
const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: schema.props.events,
    schema: eventSchema,
    serializer: {
      event_date: (v: Date) => v.toISOString(),
    },
  }),
)
```

## Detailed References

| Reference                       | When to Use                               |
| ------------------------------- | ----------------------------------------- |
| `references/type-transforms.md` | Schema transforms, serialization patterns |
| `references/sync-lifecycle.md`  | Understanding the sync flow               |
| `references/offline-first.md`   | Offline-first patterns, conflict handling |
