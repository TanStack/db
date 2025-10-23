# PowerSync Integration: Schema Types and Transformations

Hi! Thanks for the detailed explanation and the POC. I think there's a misunderstanding about how `TInput`/`TOutput` work in TanStack DB schemas, and the good news is that you **can** support arbitrary TOutput transformations (like `Date` objects) with your PowerSync integration!

## TL;DR

**TOutput should always be the rich JavaScript types that users want to work with** (e.g., `Date` objects). Your PowerSync integration layer is responsible for:
- Deserializing SQLite types → TOutput when syncing TO TanStack DB
- Serializing TOutput → SQLite types when persisting mutations FROM TanStack DB

You don't need to constrain TOutput to match SQLite types.

---

## Understanding TInput and TOutput

Let me clarify the data flow:

### TInput: What Users Provide for Mutations

When users call `collection.insert()` or `collection.update()`, they provide data in the **TInput** format. The schema validates and transforms this into **TOutput**.

```typescript
// Example schema
const schema = z.object({
  id: z.string(),
  created_at: z.string().transform(val => new Date(val))
})

// TInput: { id: string, created_at: string }
// TOutput: { id: string, created_at: Date }

// User inserts with TInput
collection.insert({
  id: "1",
  created_at: "2023-01-01T00:00:00.000Z"  // string
})

// Collection stores as TOutput
collection.get("1")
// Result: { id: "1", created_at: Date }  // Date object
```

### TOutput: What Gets Stored and Read from Collection

**All data in the collection is stored as TOutput.** This includes:
1. Data synced via `write()`
2. Data from user mutations (after validation)
3. Data in `PendingMutation.modified`

Looking at the source code:

```typescript
// packages/db/src/collection/sync.ts:93
write: (message: Omit<ChangeMessage<TOutput>, 'key'>) => void
```

The `write()` function expects **TOutput**, not SQLite types.

```typescript
// packages/db/src/collection/mutations.ts:179
const mutation: PendingMutation<TOutput, 'insert'> = {
  mutationId: crypto.randomUUID(),
  original: {},
  modified: validatedData,  // This is TOutput
  // ...
}
```

**PendingMutations store TOutput**, which is the in-memory representation.

---

## How PowerSync Integration Should Work

Your integration has two responsibilities:

### 1. Syncing FROM SQLite TO TanStack DB

When reading from SQLite and syncing to the collection, **deserialize to TOutput before calling write()**:

```typescript
// Your PowerSync sync implementation
const sync: SyncConfig = {
  sync: ({ write, begin, commit }) => {
    // Read from SQLite
    const sqliteRows = db.execute("SELECT * FROM documents")

    begin()
    for (const row of sqliteRows) {
      // SQLite gives you: { id: "1", created_at: "2023-01-01T00:00:00.000Z" }

      // Option A: If you have a schema, use validateData to transform
      const transformed = collection.validateData(row, 'insert')
      // Result: { id: "1", created_at: Date }

      write({
        type: 'insert',
        value: transformed  // TOutput with Date object
      })

      // Option B: If no schema, you need to manually transform
      // const transformed = {
      //   ...row,
      //   created_at: new Date(row.created_at)
      // }
      // write({ type: 'insert', value: transformed })
    }
    commit()
  }
}
```

### 2. Persisting FROM TanStack DB TO SQLite

When handling mutations (onInsert/onUpdate/onDelete), **serialize TOutput to SQLite types**:

```typescript
const collection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: APP_SCHEMA.props.documents,
    schema: z.object({
      id: z.string(),
      name: z.string(),
      created_at: z.string().transform(val => new Date(val))
    }),

    // In your mutation handler, serialize before writing to SQLite
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0]
      const item = mutation.modified  // This is TOutput: { created_at: Date }

      // Serialize to SQLite types
      const sqliteData = {
        id: item.id,
        name: item.name,
        created_at: item.created_at.toISOString()  // Date → string
      }

      // Write to SQLite
      await db.execute(
        "INSERT INTO documents (id, name, created_at) VALUES (?, ?, ?)",
        [sqliteData.id, sqliteData.name, sqliteData.created_at]
      )

      // Add to upload queue
      await uploadQueue.enqueue(mutation)
    }
  })
)
```

---

## Real Examples from Other Integrations

All existing integrations follow this pattern. Let me show you:

### Example 1: Manual Sync (packages/query-db-collection/src/manual-sync.ts)

```typescript
// Line 145-150
case 'insert': {
  const resolved = ctx.collection.validateData(op.data, 'insert')
  ctx.write({
    type: 'insert',
    value: resolved  // TOutput (with Date objects if schema transforms)
  })
  break
}
```

The manual sync validates data to get TOutput, then writes it to the collection.

### Example 2: RxDB Integration (packages/rxdb-db-collection/src/rxdb.ts)

```typescript
// Line 189-191
write({
  type: 'insert',
  value: stripRxdbFields(clone(d))  // Application-level objects
})
```

RxDB handles its own serialization internally. By the time it reaches `write()`, it's already in application types.

### Example 3: Schema Validation Test (packages/db/tests/collection-schema.test.ts)

This test demonstrates exactly what you want to do:

```typescript
// Line 14-43
const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  created_at: z.string().transform((val) => new Date(val)),  // string → Date
  updated_at: z.string().transform((val) => new Date(val)),
})

const collection = createCollection({
  getKey: (item) => item.id,
  schema: userSchema,
  sync: { sync: () => {} },
})

// Test insert validation
const insertData = {
  id: '1',
  name: 'John Doe',
  email: 'john@example.com',
  created_at: '2023-01-01T00:00:00.000Z',  // Input: string
  updated_at: '2023-01-01T00:00:00.000Z',
}

const validatedInsert = collection.validateData(insertData, 'insert')

// Verify that the data has been transformed
expect(validatedInsert.created_at).toBeInstanceOf(Date)  // ✅ It's a Date!
expect(validatedInsert.updated_at).toBeInstanceOf(Date)
```

The schema successfully transforms strings to Dates, and that's what gets stored in the collection.

---

## Addressing Your Specific Concerns

> **"If we want to return a Date when reading, TOutput should be Date."**

✅ Correct! TOutput should be Date.

> **"Developers must provide an ISO string when inserting—this is not ideal, but manageable."**

✅ This is actually perfect! Users provide strings (TInput), schema transforms to Date (TOutput).

```typescript
// User-friendly API
collection.insert({
  id: "1",
  created_at: "2023-01-01T00:00:00.000Z"  // String is fine
})

// Gets transformed to Date automatically
collection.get("1").created_at  // Returns: Date object
```

> **"Incoming sync data is a string; we need to validate/convert it before writing. The schema can help, but handling validation failures is tricky."**

✅ Use `collection.validateData()` before calling `write()`:

```typescript
sync: ({ write, begin, commit }) => {
  begin()
  for (const sqliteRow of sqliteData) {
    try {
      // This transforms string → Date using the schema
      const validated = collection.validateData(sqliteRow, 'insert')
      write({ type: 'insert', value: validated })
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        // Handle validation failure - maybe skip this row, log it, etc.
        console.error('Invalid data from SQLite:', error.issues)
        continue
      }
      throw error
    }
  }
  commit()
}
```

> **"The main blocker is PendingMutations: we can't directly write a Date (or other arbitrary types) from the mutation to SQLite"**

✅ This is where you serialize! PendingMutations have Date objects, but you serialize when writing to SQLite:

```typescript
onInsert: async ({ transaction }) => {
  const mutation = transaction.mutations[0]
  const item = mutation.modified  // TOutput: { created_at: Date }

  // Serialize just for SQLite
  const sqliteRow = {
    ...item,
    created_at: item.created_at.toISOString()  // Date → string
  }

  await db.execute("INSERT INTO ...", sqliteRow)
}
```

> **"The schema doesn't convert it back to TInput."**

✅ Correct - and it doesn't need to! **You handle serialization in your integration layer**, not in the schema. The schema is for user-facing transformations, not storage serialization.

---

## Recommended Architecture

Here's how I'd structure your PowerSync integration:

```typescript
// Helper function to serialize TOutput → SQLite
function serializeForSQLite(item: TOutput): SQLiteRow {
  return {
    ...item,
    created_at: item.created_at instanceof Date
      ? item.created_at.toISOString()
      : item.created_at,
    // Handle other type conversions as needed
  }
}

// Helper function to deserialize SQLite → TOutput
function deserializeFromSQLite(row: SQLiteRow, collection: Collection): TOutput {
  // Use the collection's schema to transform
  return collection.validateData(row, 'insert')
}

export function powerSyncCollectionOptions(config) {
  return {
    ...config,

    sync: {
      sync: ({ write, begin, commit, collection }) => {
        // Read from SQLite
        const rows = config.database.execute(...)

        begin()
        for (const row of rows) {
          // Deserialize: SQLite → TOutput
          const deserialized = deserializeFromSQLite(row, collection)
          write({ type: 'insert', value: deserialized })
        }
        commit()
      }
    },

    onInsert: async ({ transaction }) => {
      const item = transaction.mutations[0].modified  // TOutput

      // Serialize: TOutput → SQLite
      const sqliteRow = serializeForSQLite(item)

      // Write to SQLite
      await config.database.execute(
        "INSERT INTO ...",
        sqliteRow
      )
    },

    // Similar for onUpdate, onDelete
  }
}
```

---

## Summary

You asked:
> "Let me know if you have suggestions/feedback or if I've misunderstood any part of the TanStackDB schema handling!"

**Key points:**

1. ✅ **TOutput should be rich JavaScript types** (Date, etc.) - this is what users see
2. ✅ **TInput is what users provide** for mutations (can be strings that transform to Date)
3. ✅ **Your integration handles serialization**, not the schema:
   - When syncing TO collection: `SQLite types` → (deserialize) → `TOutput` → `write()`
   - When persisting FROM collection: `mutation.modified` (TOutput) → (serialize) → `SQLite types`
4. ✅ **PendingMutations store TOutput** - you serialize when writing to SQLite
5. ✅ **Use `collection.validateData()`** to transform SQLite data before calling `write()`

The limitation you described is self-imposed! You **can** support arbitrary TOutput transformations - you just need to handle serialization in your PowerSync adapter layer, similar to how RxDB and Electric do it.

---

## Example: Full Date Support

Here's a complete example showing Date support:

```typescript
// User-friendly schema
const schema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.string().transform(val => new Date(val)),  // TInput: string, TOutput: Date
  updated_at: z.string().transform(val => new Date(val)),
})

const collection = createCollection(
  powerSyncCollectionOptions({
    database: powerSyncDB,
    table: APP_SCHEMA.props.documents,
    schema,

    sync: {
      sync: ({ write, begin, commit, collection }) => {
        // Sync FROM SQLite
        powerSyncDB.watch('documents', (changes) => {
          begin()
          for (const change of changes) {
            // SQLite row: { id: "1", created_at: "2023-01-01T00:00:00.000Z" }
            // validateData transforms string → Date
            const transformed = collection.validateData(change, 'insert')
            // Now: { id: "1", created_at: Date }

            write({ type: 'insert', value: transformed })
          }
          commit()
        })
      }
    },

    onInsert: async ({ transaction }) => {
      const item = transaction.mutations[0].modified
      // item.created_at is a Date here (TOutput)

      // Serialize for SQLite
      const sqliteRow = {
        ...item,
        created_at: item.created_at.toISOString(),  // Date → string
        updated_at: item.updated_at.toISOString(),
      }

      // Write to SQLite
      await powerSyncDB.execute(
        "INSERT INTO documents (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [sqliteRow.id, sqliteRow.name, sqliteRow.created_at, sqliteRow.updated_at]
      )
    }
  })
)

// Users get a great API:
collection.insert({
  id: "1",
  name: "My Doc",
  created_at: "2023-01-01T00:00:00.000Z"  // String input is fine
})

// Reads return Date objects:
const doc = collection.get("1")
console.log(doc.created_at instanceof Date)  // true ✅
console.log(doc.created_at.getFullYear())    // 2023
```

---

Hope this clarifies things! Your POC looks great, and with this approach you can provide the best DX (Date objects, custom types) while still syncing through SQLite. Let me know if you have questions!
