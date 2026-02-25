# ElectricSQL Adapter Reference

Package: `@tanstack/electric-db-collection`

## Setup

```typescript
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'

const todosCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    shapeOptions: {
      url: '/api/todos',
    },
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const newItem = transaction.mutations[0].modified
      const response = await api.todos.create(newItem)
      return { txid: response.txid }
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const response = await api.todos.update({
        where: { id: original.id },
        data: changes,
      })
      return { txid: response.txid }
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const response = await api.todos.delete(original.id)
      return { txid: response.txid }
    },
  }),
)
```

Source: docs/collections/electric-collection.md, examples/react/todo/src/lib/collections.ts

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

Source: packages/electric-db-collection/src/electric.ts:141-218

## Synchronization Strategies

Handlers persist mutations to the backend and wait for Electric to sync
the changes back. This prevents UI glitches where optimistic updates
would flash off then on.

### Strategy 1: Return txid (Recommended)

The backend returns a PostgreSQL transaction ID. The client waits for
that txid to appear in the Electric sync stream:

```typescript
onInsert: async ({ transaction }) => {
  const newItem = transaction.mutations[0].modified
  const response = await api.todos.create(newItem)
  return { txid: response.txid }
},
```

For multiple mutations, return an array of txids:

```typescript
onUpdate: async ({ transaction }) => {
  const txids = await Promise.all(
    transaction.mutations.map(async (mutation) => {
      const response = await api.todos.update(mutation.original.id, mutation.changes)
      return response.txid
    }),
  )
  return { txid: txids }
},
```

Source: examples/react/todo/src/lib/collections.ts:32-68

### Strategy 2: awaitMatch (custom matching)

For cases where txids aren't available, use `awaitMatch` to wait for a
specific message pattern in the sync stream:

```typescript
import { isChangeMessage } from '@tanstack/electric-db-collection'

onInsert: async ({ transaction, collection }) => {
  const newItem = transaction.mutations[0].modified
  await api.todos.create(newItem)

  await collection.utils.awaitMatch(
    (message) => {
      return isChangeMessage(message) &&
             message.headers.operation === 'insert' &&
             message.value.text === newItem.text
    },
    5000, // timeout in ms (default: 3000)
  )
},
```

Source: docs/collections/electric-collection.md — Using Custom Match Functions

### Strategy 3: Simple timeout (prototyping only)

For quick prototyping when timing is predictable:

```typescript
onInsert: async ({ transaction }) => {
  const newItem = transaction.mutations[0].modified
  await api.todos.create(newItem)
  await new Promise((resolve) => setTimeout(resolve, 2000))
},
```

Source: docs/collections/electric-collection.md — Using Simple Timeout

## Backend Txid Generation

The backend must generate the txid INSIDE the same SQL transaction as
the mutation. Using `RETURNING` or querying within `sql.begin()` ensures
this:

```typescript
// Server-side code
async function generateTxId(tx) {
  // ::xid cast strips off the epoch to match Electric's replication stream
  const result = await tx.execute(
    sql`SELECT pg_current_xact_id()::xid::text as txid`
  )
  const txid = result.rows[0]?.txid
  if (txid === undefined) {
    throw new Error('Failed to get transaction ID')
  }
  return parseInt(txid, 10)
}

async function createTodo(data) {
  let txid
  const result = await sql.begin(async (tx) => {
    txid = await generateTxId(tx)
    const [todo] = await tx`INSERT INTO todos ${tx(data)} RETURNING *`
    return todo
  })
  return { todo: result, txid }
}
```

**Critical**: Querying `pg_current_xact_id()` OUTSIDE the mutation
transaction returns a different txid. `awaitTxId` then waits for a
txid that never arrives — it stalls forever.

Source: docs/collections/electric-collection.md — Debugging section

## Utils

```typescript
// Wait for a specific txid in the sync stream (default timeout: 5000ms)
await collection.utils.awaitTxId(12345)
await collection.utils.awaitTxId(12345, 10000)  // custom timeout

// Wait for a custom condition in the sync stream (default timeout: 3000ms)
await collection.utils.awaitMatch(
  (message) => isChangeMessage(message) && message.value.id === newId,
  5000,  // custom timeout
)
```

Source: packages/electric-db-collection/src/electric.ts:646-715

## ShapeStream Options

```typescript
electricCollectionOptions({
  shapeOptions: {
    url: '/api/todos',          // URL to your Electric proxy
    params: { table: 'todos' }, // shape parameters
    parser: {
      // Custom PostgreSQL type parsers
      timestamptz: (date: string) => new Date(date),
    },
  },
})
```

The `url` should typically point to YOUR proxy server, not directly to
Electric. The proxy handles auth and shape configuration.

Source: examples/react/todo/src/lib/collections.ts:22-29

## Sync Modes

| Mode              | Behavior                                                   |
| ----------------- | ---------------------------------------------------------- |
| `eager` (default) | Syncs all data, collection ready after initial sync        |
| `on-demand`       | Syncs incrementally when queried                           |
| `progressive`     | Syncs query subset immediately, full dataset in background |

Source: packages/electric-db-collection/src/electric.ts:119-134

## Helper Functions

```typescript
import {
  isChangeMessage,
  isControlMessage,
} from '@tanstack/electric-db-collection'

// Use in awaitMatch to filter message types
await collection.utils.awaitMatch(
  (msg) => isChangeMessage(msg) && msg.headers.operation === 'insert',
)
```

Source: packages/electric-db-collection/src/electric.ts:56

## Debug Logging

Enable Electric debug logging in the browser console:

```javascript
localStorage.debug = 'ts/db:electric'
```

This shows when mutations start waiting for txids and when txids
arrive from Electric's sync stream.

Source: docs/collections/electric-collection.md — Debugging section
