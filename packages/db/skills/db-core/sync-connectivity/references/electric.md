# ElectricSQL Adapter Reference

Package: `@tanstack/electric-db-collection`

## Setup

```typescript
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'

const todosCollection = createCollection(
  electricCollectionOptions({
    shapeOptions: {
      url: 'http://localhost:3000/v1/shape',
      params: { table: 'todos' },
    },
    getKey: (todo) => todo.id,
    onInsert: async ({ transaction }) => {
      const item = transaction.mutations[0].modified
      const result = await sql`
        INSERT INTO todos (id, text, completed)
        VALUES (${item.id}, ${item.text}, ${item.completed})
        RETURNING pg_current_xact_id()::text AS txid
      `
      return { txid: Number(result[0].txid) }
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const result = await sql`
        UPDATE todos SET ${sql(changes)}
        WHERE id = ${original.id}
        RETURNING pg_current_xact_id()::text AS txid
      `
      return { txid: Number(result[0].txid) }
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const result = await sql`
        DELETE FROM todos WHERE id = ${original.id}
        RETURNING pg_current_xact_id()::text AS txid
      `
      return { txid: Number(result[0].txid) }
    },
  }),
)
```

## Configuration

```typescript
electricCollectionOptions({
  // Required
  shapeOptions: ShapeStreamOptions, // Electric shape definition
  getKey: (item: T) => string | number,

  // Optional
  id: string,
  schema: StandardSchemaV1,
  syncMode: 'eager' | 'on-demand' | 'progressive',

  // Handlers — return MatchingStrategy to hold optimistic state
  onInsert: (params) =>
    Promise<{ txid: number | number[]; timeout?: number } | void>,
  onUpdate: (params) =>
    Promise<{ txid: number | number[]; timeout?: number } | void>,
  onDelete: (params) =>
    Promise<{ txid: number | number[]; timeout?: number } | void>,
})
```

## Txid Matching

Handlers return `{ txid }` to tell Electric how long to hold optimistic
state. The collection waits until the sync stream contains a message with
that txid before dropping optimistic state.

```typescript
// Handler returns txid
onInsert: async ({ transaction }) => {
  const result = await sql`
    INSERT INTO todos ... RETURNING pg_current_xact_id()::text AS txid
  `
  return { txid: Number(result[0].txid), timeout: 10000 }
}
```

**Critical**: `pg_current_xact_id()` must be in the SAME SQL transaction
as the mutation. Using `RETURNING` guarantees this. A separate query
runs in its own transaction and returns a different txid.

## Utils

```typescript
// Wait for a specific txid to appear in the sync stream
await collection.utils.awaitTxId(txid: number, timeout?: number)

// Wait for a custom condition in the sync stream
await collection.utils.awaitMatch(
  (message) => isChangeMessage(message) && message.value.id === newId,
  timeout,
)
```

## Sync Modes

| Mode              | Behavior                                                   |
| ----------------- | ---------------------------------------------------------- |
| `eager` (default) | Syncs all data, collection ready after initial sync        |
| `on-demand`       | Syncs incrementally when queried                           |
| `progressive`     | Syncs query subset immediately, full dataset in background |

## Helper Functions

```typescript
import {
  isChangeMessage,
  isControlMessage,
} from '@tanstack/electric-db-collection'

// Use in awaitMatch to filter message types
await collection.utils.awaitMatch(
  (msg) => isChangeMessage(msg) && msg.value.text === 'target',
)
```
