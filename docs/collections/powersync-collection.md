---
title: PowerSync Collection
---

# PowerSync Collection

PowerSync collections provide seamless integration between TanStack DB and [PowerSync](https://powersync.com), enabling automatic synchronization between your in-memory TanStack DB collections and PowerSync's SQLite database. This gives you offline-ready persistence, real-time sync capabilities, and powerful conflict resolution.

## Overview

The `@tanstack/powersync-db-collection` package allows you to create collections that:

- Automatically mirror the state of an underlying PowerSync SQLite database
- Reactively update when PowerSync records change
- Support optimistic mutations with rollback on error
- Provide persistence handlers to keep PowerSync in sync with TanStack DB transactions
- Use PowerSync's efficient SQLite-based storage engine
- Work with PowerSync's real-time sync features for offline-first scenarios
- Leverage PowerSync's built-in conflict resolution and data consistency guarantees
- Enable real-time synchronization with PostgreSQL, MongoDB and MySQL backends

## 1. Installation

Install the PowerSync collection package along with your preferred framework integration.
PowerSync currently works with Web, React Native and Node.js. The examples below use the Web SDK.
See the PowerSync quickstart [docs](https://docs.powersync.com/installation/quickstart-guide) for more details.

```bash
npm install @tanstack/powersync-db-collection @powersync/web @journeyapps/wa-sqlite
```

### 2. Create a PowerSync Database and Schema

```ts
import { Schema, Table, column } from "@powersync/web"

// Define your schema
const APP_SCHEMA = new Schema({
  documents: new Table({
    name: column.text,
    author: column.text,
    created_at: column.text,
    archived: column.integer,
  }),
})

// Initialize PowerSync database
const db = new PowerSyncDatabase({
  database: {
    dbFilename: "app.sqlite",
  },
  schema: APP_SCHEMA,
})
```

### 3. (optional) Configure Sync with a Backend

```ts
import {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from "@powersync/web"

// TODO implement your logic here
class Connector implements PowerSyncBackendConnector {
  fetchCredentials: () => Promise<PowerSyncCredentials | null>

  /** Upload local changes to the app backend.
   *
   * Use {@link AbstractPowerSyncDatabase.getCrudBatch} to get a batch of changes to upload.
   *
   * Any thrown errors will result in a retry after the configured wait period (default: 5 seconds).
   */
  uploadData: (database: AbstractPowerSyncDatabase) => Promise<void>
}

// Configure the client to connect to a PowerSync service and your backend
db.connect(new Connector())
```

### 4. Create a TanStack DB Collection

There are two main ways to create a collection: using type inference or using schema validation. Type inference will infer collection types from the underlying PowerSync SQLite tables. Schema validation can be used for additional input/output validations and type transforms.

#### Option 1: Using Table Type Inference

The collection types are automatically inferred from the PowerSync schema table definition. The table is used to construct a default standard schema validator which is used internally to validate collection operations.

Collection mutations accept SQLite types and queries report data with SQLite types.

```ts
import { createCollection } from "@tanstack/react-db"
import { powerSyncCollectionOptions } from "@tanstack/powersync-db-collection"

const documentsCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
  })
)

/** Note: The types for input and output are defined as this */
// Used for mutations like `insert` or `update`
type DocumentCollectionInput = {
  id: string
  name: string | null
  author: string | null
  created_at: string | null // SQLite TEXT
  archived: number | null // SQLite integer
}
// The type of query/data results
type DocumentCollectionOutput = DocumentCollectionInput
```

The standard PowerSync SQLite types map to these TypeScript types:

| PowerSync Column Type | TypeScript Type  | Description                                                          |
| --------------------- | ---------------- | -------------------------------------------------------------------- |
| `column.text`         | `string \| null` | Text values, commonly used for strings, JSON, dates (as ISO strings) |
| `column.integer`      | `number \| null` | Integer values, also used for booleans (0/1)                         |
| `column.real`         | `number \| null` | Floating point numbers                                               |

Note: All PowerSync column types are nullable by default.

#### Option 2: SQLite Types with Schema Validation

Additional validations for collection mutations can be performed with a custom schema. The Schema below asserts that
the `name`, `author` and `created_at` fields are required as input. `name` also has an additional string length check.

Note: The input and output types specified in this example still satisfy the underlying SQLite types. An additional `deserializationSchema` is required if the typing differs. See the examples below for more details.

The application logic (including the backend) should enforce that all incoming synced data passes validation with the `schema`. Failing to validate data will result in inconsistency of the collection data. This is a fatal error! An `onDeserializationError` handler must be provided to react to this case.

```ts
import { createCollection } from "@tanstack/react-db"
import { powerSyncCollectionOptions } from "@tanstack/powersync-db-collection"
import { z } from "zod"

// Schema validates SQLite types but adds constraints
const schema = z.object({
  id: z.string(),
  name: z.string().min(3, { message: "Should be at least 3 characters" }),
  author: z.string(),
  created_at: z.string(), // SQLite TEXT for dates
  archived: z.number(),
})

const documentsCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
    schema,
    onDeserializationError: (error) => {
      // Present fatal error
    },
  })
)

/** Note: The types for input and output are defined as this */
// Used for mutations like `insert` or `update`
type DocumentCollectionInput = {
  id: string
  name: string
  author: string
  created_at: string // SQLite TEXT
  archived: number // SQLite integer
}
// The type of query/data results
type DocumentCollectionOutput = DocumentCollectionInput
```

#### Option 3: Transform SQLite Input Types to Rich Output Types

You can transform SQLite types to richer types (like Date objects) while keeping SQLite-compatible input types:

Note: The Transformed types are provided by TanStackDB to the PowerSync SQLite persister. These types need to be serialized in
order to be persisted to SQLite. Most types are converted by default. For custom types, override the serialization by providing a
`serializer` param.

The example below uses `nullable` columns, this is not a requirement.

The application logic (including the backend) should enforce that all incoming synced data passes validation with the `schema`. Failing to validate data will result in inconsistency of the collection data. This is a fatal error! An `onDeserializationError` handler must be provided to react to this case.

```ts
const schema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  created_at: z
    .string()
    .nullable()
    .transform((val) => (val ? new Date(val) : null)), // Transform SQLite TEXT to Date
  archived: z
    .number()
    .nullable()
    .transform((val) => (val != null ? val > 0 : null)), // Transform SQLite INTEGER to boolean
})

const documentsCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
    schema,
    onDeserializationError: (error) => {
      // Present fatal error
    },
    // Optional: custom column serialization
    serializer: {
      // Dates are serialized by default, this is just an example
      created_at: (value) => (value ? value.toISOString() : null),
    },
  })
)

/** Note: The types for input and output are defined as this */
// Used for mutations like `insert` or `update`
type DocumentCollectionInput = {
  id: string
  name: string | null
  author: string | null
  created_at: string | null // SQLite TEXT
  archived: number | null
}
// The type of query/data results
type DocumentCollectionOutput = {
  id: string
  name: string | null
  author: string | null
  created_at: Date | null // JS Date instance
  archived: boolean | null // JS boolean
}
```

#### Option 4: Custom Input/Output Types with Deserialization

The input and output types can be completely decoupled from the internal SQLite types. This can be used to accept rich values for input mutations.
We require an additional `deserializationSchema` in order to validate and transform incoming synced (SQLite) updates. This schema should convert the incoming SQLite update to the output type.

The application logic (including the backend) should enforce that all incoming synced data passes validation with the `deserializationSchema`. Failing to validate data will result in inconsistency of the collection data. This is a fatal error! An `onDeserializationError` handler must be provided to react to this case.

```ts
// Our input/output types use Date and boolean
const schema = z.object({
  id: z.string(),
  name: z.string(),
  author: z.string(),
  created_at: z.date(), // Accept Date objects as input
  archived: z.boolean(), // Accept Booleans as input
})

// Schema to transform from SQLite types to our output types
const deserializationSchema = z.object({
  id: z.string(),
  name: z.string(),
  author: z.string(),
  created_at: z
    .string()
    .transform((val) => (new Date(val))), // SQLite TEXT to Date
  archived: z
    .number()
    .transform((val) => (val > 0), // SQLite INTEGER to Boolean
})

const documentsCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
    schema,
    deserializationSchema,
    onDeserializationError: (error) => {
      // Present fatal error
    },
  })
)

/** Note: The types for input and output are defined as this */
// Used for mutations like `insert` or `update`
type DocumentCollectionInput = {
  id: string
  name: string
  author: string
  created_at: Date
  archived: boolean
}
// The type of query/data results
type DocumentCollectionOutput = DocumentCollectionInput
```

## Features

### Offline-First

PowerSync collections are offline-first by default. All data is stored locally in a SQLite database, allowing your app to work without an internet connection. Changes are automatically synced when connectivity is restored.

### Real-Time Sync

When connected to a PowerSync backend, changes are automatically synchronized in real-time across all connected clients. The sync process handles:

- Bi-directional sync with the server
- Conflict resolution
- Queue management for offline changes
- Automatic retries on connection loss

### Working with Rich JavaScript Types

PowerSync collections support rich JavaScript types like `Date`, `Boolean`, and custom objects while maintaining SQLite compatibility. The collection handles serialization and deserialization automatically:

```typescript
import { z } from "zod"
import { Schema, Table, column } from "@powersync/web"
import { createCollection } from "@tanstack/react-db"
import { powerSyncCollectionOptions } from "@tanstack/powersync-db-collection"

// Define PowerSync SQLite schema
const APP_SCHEMA = new Schema({
  tasks: new Table({
    title: column.text,
    due_date: column.text, // Stored as ISO string in SQLite
    completed: column.integer, // Stored as 0/1 in SQLite
    metadata: column.text, // Stored as JSON string in SQLite
  }),
})

// Define rich types schema
const taskSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  due_date: z
    .string()
    .nullable()
    .transform((val) => (val ? new Date(val) : null)), // Convert to Date
  completed: z
    .number()
    .nullable()
    .transform((val) => (val != null ? val > 0 : null)), // Convert to boolean
  metadata: z
    .string()
    .nullable()
    .transform((val) => (val ? JSON.parse(val) : null)), // Parse JSON
})

// Create collection with rich types
const tasksCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.tasks,
    schema: taskSchema,
  })
)

// Work with rich types in your code
await tasksCollection.insert({
  id: crypto.randomUUID(),
  title: "Review PR",
  due_date: "2025-10-30T10:00:00Z", // String input is automatically converted to Date
  completed: 0, // Number input is automatically converted to boolean
  metadata: JSON.stringify({ priority: "high" }),
})

// Query returns rich types
const task = tasksCollection.get("task-1")
console.log(task.due_date instanceof Date) // true
console.log(typeof task.completed) // "boolean"
console.log(task.metadata.priority) // "high"
```

### Type Safety with Rich Types

The collection maintains type safety throughout:

```typescript
type TaskInput = {
  id: string
  title: string | null
  due_date: string | null // Accept ISO string for mutations
  completed: number | null // Accept 0/1 for mutations
  metadata: string | null // Accept JSON string for mutations
}

type TaskOutput = {
  id: string
  title: string | null
  due_date: Date | null // Get Date object in queries
  completed: boolean | null // Get boolean in queries
  metadata: {
    priority: string
    [key: string]: any
  } | null
}

// TypeScript enforces correct types:
tasksCollection.insert({
  due_date: new Date(), // Error: Type 'Date' is not assignable to type 'string'
})

const task = tasksCollection.get("task-1")
task.due_date.getTime() // OK - TypeScript knows this is a Date
```

### Optimistic Updates

Updates to the collection are applied optimistically to the local state first, then synchronized with PowerSync and the backend. If an error occurs during sync, the changes are automatically rolled back.

## Configuration Options

The `powerSyncCollectionOptions` function accepts the following options:

```ts
interface PowerSyncCollectionConfig<TTable extends Table, TSchema> {
  // Required options
  database: PowerSyncDatabase
  table: Table

  // Schema validation and type transformation
  schema?: StandardSchemaV1
  deserializationSchema?: StandardSchemaV1 // Required for custom input types
  onDeserializationError?: (error: StandardSchemaV1.FailureResult) => void // Required for custom input types

  // Optional Custom serialization
  serializer?: {
    [Key in keyof TOutput]?: (value: TOutput[Key]) => SQLiteCompatibleType
  }

  // Performance tuning
  syncBatchSize?: number // Control batch size for initial sync, defaults to 1000
}
```

## Advanced Transactions

When you need more control over transaction handling, such as batching multiple operations or handling complex transaction scenarios, you can use PowerSync's transaction system directly with TanStack DB transactions.

```ts
import { createTransaction } from "@tanstack/react-db"
import { PowerSyncTransactor } from "@tanstack/powersync-db-collection"

// Create a transaction that won't auto-commit
const batchTx = createTransaction({
  autoCommit: false,
  mutationFn: async ({ transaction }) => {
    // Use PowerSyncTransactor to apply the transaction to PowerSync
    await new PowerSyncTransactor({ database: db }).applyTransaction(
      transaction
    )
  },
})

// Perform multiple operations in the transaction
batchTx.mutate(() => {
  // Add multiple documents in a single transaction
  for (let i = 0; i < 5; i++) {
    documentsCollection.insert({
      id: crypto.randomUUID(),
      name: `Document ${i}`,
      content: `Content ${i}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }
})

// Commit the transaction
await batchTx.commit()

// Wait for the changes to be persisted
await batchTx.isPersisted.promise
```

This approach allows you to:

- Batch multiple operations into a single transaction
- Control when the transaction is committed
- Ensure all operations are atomic
- Wait for persistence confirmation
- Handle complex transaction scenarios
