---
name: tanstack-db-electric
description: |
  ElectricSQL integration with TanStack DB.
  Use for real-time Postgres sync, shapes, txid matching, proxy setup, and debugging.
---

# Electric Integration

Electric collections enable real-time sync between TanStack DB and Postgres via ElectricSQL. Data streams automatically from your database to the client, with optimistic mutations that confirm via transaction ID matching.

## Common Patterns

### Basic Setup

```tsx
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'

const todoCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (item) => item.id,

    shapeOptions: {
      url: '/api/todos', // Your Electric proxy
    },

    onInsert: async ({ transaction }) => {
      const newItem = transaction.mutations[0].modified
      const response = await api.todos.create(newItem)
      return { txid: response.txid }
    },

    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const response = await api.todos.update(original.id, changes)
      return { txid: response.txid }
    },

    onDelete: async ({ transaction }) => {
      const response = await api.todos.delete(
        transaction.mutations[0].original.id,
      )
      return { txid: response.txid }
    },
  }),
)
```

### Txid Matching (Recommended)

Return txid from handlers to wait for sync confirmation:

```tsx
onInsert: async ({ transaction }) => {
  const response = await api.todos.create(transaction.mutations[0].modified)
  return { txid: response.txid } // Wait for this txid in Electric stream
}
```

**Backend txid extraction (Postgres):**

```typescript
async function createTodo(data: TodoInput, tx: Transaction) {
  // Query txid INSIDE the same transaction as the mutation
  const result = await tx.execute(
    sql`SELECT pg_current_xact_id()::xid::text as txid`,
  )
  const txid = parseInt(result.rows[0].txid, 10)

  await tx.execute(sql`INSERT INTO todos ${tx(data)}`)

  return { txid }
}
```

**Critical:** `pg_current_xact_id()` must be called INSIDE the same transaction as the mutation, not before or after.

### Custom Match Functions

When txids aren't available, use custom matching:

```tsx
import { isChangeMessage } from '@tanstack/electric-db-collection'

onInsert: async ({ transaction, collection }) => {
  const newItem = transaction.mutations[0].modified
  await api.todos.create(newItem)

  // Wait for matching message in stream
  await collection.utils.awaitMatch(
    (message) => {
      return (
        isChangeMessage(message) &&
        message.headers.operation === 'insert' &&
        message.value.text === newItem.text
      )
    },
    5000, // timeout ms (optional, default 3000)
  )
}
```

### Simple Timeout (Prototyping)

For quick prototyping when you're confident about timing:

```tsx
onInsert: async ({ transaction }) => {
  await api.todos.create(transaction.mutations[0].modified)
  await new Promise((resolve) => setTimeout(resolve, 2000))
}
```

### Electric Proxy Setup

Electric should run behind a proxy for security and shape configuration:

```typescript
// TanStack Start example: routes/api/todos.ts
import { createServerFileRoute } from '@tanstack/react-start/server'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

const ELECTRIC_URL = 'http://localhost:3000/v1/shape'

const serve = async ({ request }: { request: Request }) => {
  // Check user authorization here
  const url = new URL(request.url)
  const originUrl = new URL(ELECTRIC_URL)

  // Pass through Electric protocol params
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Set shape parameters (server-controlled, not client)
  originUrl.searchParams.set('table', 'todos')
  // originUrl.searchParams.set('where', 'user_id = $1')
  // originUrl.searchParams.set('columns', 'id,text,completed')

  const response = await fetch(originUrl)
  const headers = new Headers(response.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export const ServerRoute = createServerFileRoute('/api/todos').methods({
  GET: serve,
})
```

### Custom Actions with Electric

```tsx
import { createOptimisticAction } from '@tanstack/react-db'

const addTodo = createOptimisticAction<{ text: string }>({
  onMutate: ({ text }) => {
    todoCollection.insert({
      id: crypto.randomUUID(),
      text,
      completed: false,
      created_at: new Date(),
    })
  },
  mutationFn: async ({ text }) => {
    const response = await api.todos.create({ text, completed: false })
    await todoCollection.utils.awaitTxId(response.txid)
  },
})
```

### Utility Methods

```tsx
// Wait for specific transaction ID
await todoCollection.utils.awaitTxId(12345)
await todoCollection.utils.awaitTxId(12345, 10000) // with timeout

// Wait for custom match
await todoCollection.utils.awaitMatch(
  (message) => isChangeMessage(message) && message.value.id === '123',
  5000,
)

// Helper functions
import {
  isChangeMessage,
  isControlMessage,
} from '@tanstack/electric-db-collection'

isChangeMessage(message) // insert/update/delete
isControlMessage(message) // up-to-date/must-refetch
```

## Debugging

### Enable Debug Logging

```javascript
// Browser console
localStorage.debug = 'ts/db:electric'
```

### Common Issue: awaitTxId Stalls

**Symptom:** `awaitTxId` hangs forever, data persists but optimistic state never resolves.

**Cause:** Txid queried outside the mutation's transaction.

```
// Debug output showing mismatch:
ts/db:electric awaitTxId called with txid 124
ts/db:electric new txids synced from pg [123]  // ← 124 never arrives!

// Debug output when working:
ts/db:electric awaitTxId called with txid 123
ts/db:electric new txids synced from pg [123]
ts/db:electric awaitTxId found match for txid 123
```

**Fix:** Query `pg_current_xact_id()` INSIDE the same transaction:

```typescript
// ❌ WRONG
async function createTodo(data) {
  const txid = await generateTxId(sql) // Separate transaction!
  await sql.begin(async (tx) => {
    await tx`INSERT INTO todos ${tx(data)}`
  })
  return { txid } // Won't match!
}

// ✅ CORRECT
async function createTodo(data) {
  let txid: number
  await sql.begin(async (tx) => {
    txid = await generateTxId(tx) // Same transaction
    await tx`INSERT INTO todos ${tx(data)}`
  })
  return { txid }
}
```

## Shape Configuration

Shapes define what data syncs to the client:

| Parameter | Description                    | Example             |
| --------- | ------------------------------ | ------------------- |
| `table`   | Postgres table name            | `todos`             |
| `where`   | Row filter clause              | `user_id = $1`      |
| `columns` | Columns to sync (default: all) | `id,text,completed` |

**Important:** Configure shapes server-side in your proxy, not client-side, for security.

## Detailed References

| Reference                     | When to Use                                   |
| ----------------------------- | --------------------------------------------- |
| `references/txid-matching.md` | Transaction ID patterns, backend setup        |
| `references/shapes.md`        | Shape configuration, filtering, security      |
| `references/proxy-setup.md`   | Electric proxy patterns, authentication       |
| `references/debugging.md`     | Debug logging, common issues, troubleshooting |
