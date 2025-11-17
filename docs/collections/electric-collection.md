---
title: Electric Collection
---

# Electric Collection

Electric collections provide seamless integration between TanStack DB and ElectricSQL, enabling real-time data synchronization with your Postgres database through Electric's sync engine.

## Overview

The `@tanstack/electric-db-collection` package allows you to create collections that:
- Automatically sync data from Postgres via Electric shapes
- Support optimistic updates with transaction matching and automatic rollback on errors
- Handle persistence through customizable mutation handlers

## Installation

```bash
npm install @tanstack/electric-db-collection @tanstack/react-db
```

## Basic Usage

```typescript
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'

const todosCollection = createCollection(
  electricCollectionOptions({
    shapeOptions: {
      url: '/api/todos',
    },
    getKey: (item) => item.id,
  })
)
```

## Configuration Options

The `electricCollectionOptions` function accepts the following options:

### Required Options

- `shapeOptions`: Configuration for the ElectricSQL ShapeStream
  - `url`: The URL of your proxy to Electric

- `getKey`: Function to extract the unique key from an item

### Optional

- `id`: Unique identifier for the collection
- `schema`: Schema for validating items. Any Standard Schema compatible schema
- `sync`: Custom sync configuration

### Persistence Handlers

Handlers are called before mutations to persist changes to your backend:

- `onInsert`: Handler called before insert operations
- `onUpdate`: Handler called before update operations
- `onDelete`: Handler called before delete operations

Each handler should manually call `await collection.utils.awaitTxId(txid)` to wait for synchronization. For cases where your API cannot return txids, use the `awaitMatch` utility function.

## Persistence Handlers & Synchronization

Handlers persist mutations to the backend and wait for Electric to sync the changes back. This prevents UI glitches where optimistic updates would be removed and then re-added. TanStack DB blocks sync data until the mutation is confirmed, ensuring smooth user experience.

### 1. Using Txid (Recommended)

The recommended approach uses PostgreSQL transaction IDs (txids) for precise matching. The backend returns a txid, and the client manually waits for that specific txid to appear in the Electric stream.

```typescript
const todosCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (item) => item.id,
    shapeOptions: {
      url: '/api/todos',
      params: { table: 'todos' },
    },

    onInsert: async ({ transaction, collection }) => {
      const newItem = transaction.mutations[0].modified
      const response = await api.todos.create(newItem)

      // Manually wait for txid to sync
      await collection.utils.awaitTxId(response.txid)
    },

    onUpdate: async ({ transaction, collection }) => {
      const { original, changes } = transaction.mutations[0]
      const response = await api.todos.update({
        where: { id: original.id },
        data: changes
      })

      // Manually wait for txid to sync
      await collection.utils.awaitTxId(response.txid)
    }
  })
)
```

### 2. Using Custom Match Functions

For cases where txids aren't available, use the `awaitMatch` utility function to wait for synchronization with custom matching logic:

```typescript
import { isChangeMessage } from '@tanstack/electric-db-collection'

const todosCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    getKey: (item) => item.id,
    shapeOptions: {
      url: '/api/todos',
      params: { table: 'todos' },
    },

    onInsert: async ({ transaction, collection }) => {
      const newItem = transaction.mutations[0].modified
      await api.todos.create(newItem)

      // Use awaitMatch utility for custom matching
      await collection.utils.awaitMatch(
        (message) => {
          return isChangeMessage(message) &&
                 message.headers.operation === 'insert' &&
                 message.value.text === newItem.text
        },
        5000 // timeout in ms (optional, defaults to 3000)
      )
    }
  })
)
```

### 3. Using Simple Timeout

For quick prototyping or when you're confident about timing, you can use a simple timeout. This is crude but works as almost always the data will be synced back in under 2 seconds:

```typescript
const todosCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    getKey: (item) => item.id,
    shapeOptions: {
      url: '/api/todos',
      params: { table: 'todos' },
    },

    onInsert: async ({ transaction }) => {
      const newItem = transaction.mutations[0].modified
      await api.todos.create(newItem)

      // Simple timeout approach
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  })
)
```

On the backend, you can extract the `txid` for a transaction by querying Postgres directly.

```ts
async function generateTxId(tx) {
  // The ::xid cast strips off the epoch, giving you the raw 32-bit value
  // that matches what PostgreSQL sends in logical replication streams
  // (and then exposed through Electric which we'll match against
  // in the client).
  const result = await tx.execute(
    sql`SELECT pg_current_xact_id()::xid::text as txid`
  )
  const txid = result.rows[0]?.txid

  if (txid === undefined) {
    throw new Error(`Failed to get transaction ID`)
  }

  return parseInt(txid as string, 10)
}
```

### Electric Proxy Example

Electric is typically deployed behind a proxy server that handles shape configuration, authentication and authorization. This provides better security and allows you to control what data users can access without exposing Electric to the client.


Here is an example proxy implementation using TanStack Starter:

```js
import { createServerFileRoute } from "@tanstack/react-start/server"
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client"

// Electric URL
const baseUrl = 'http://.../v1/shape'

const serve = async ({ request }: { request: Request }) => {
  // ...check user authorization  
  const url = new URL(request.url)
  const originUrl = new URL(baseUrl)

  // passthrough parameters from electric client
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // set shape parameters 
  // full spec: https://github.com/electric-sql/electric/blob/main/website/electric-api.yaml
  originUrl.searchParams.set("table", "todos")
  // Where clause to filter rows in the table (optional).
  // originUrl.searchParams.set("where", "completed = true")
  
  // Select the columns to sync (optional)
  // originUrl.searchParams.set("columns", "id,text,completed")

  const response = await fetch(originUrl)
  const headers = new Headers(response.headers)
  headers.delete("content-encoding")
  headers.delete("content-length")

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export const ServerRoute = createServerFileRoute("/api/todos").methods({
  GET: serve,
})
```

## Optimistic Updates with Explicit Transactions

For more advanced use cases, you can create custom actions that can do multiple mutations across collections transactionally. You can use the utility methods to wait for synchronization with different strategies:

### Using Txid Strategy

```typescript
const addTodoAction = createOptimisticAction({
  onMutate: ({ text }) => {
    // optimistically insert with a temporary ID
    const tempId = crypto.randomUUID()
    todosCollection.insert({
      id: tempId,
      text,
      completed: false,
      created_at: new Date(),
    })
    
    // ... mutate other collections
  },
  
  mutationFn: async ({ text }) => {
    const response = await api.todos.create({
      data: { text, completed: false }
    })
    
    // Wait for the specific txid
    await todosCollection.utils.awaitTxId(response.txid)
  }
})
```

### Using Custom Match Function

```typescript
import { isChangeMessage } from '@tanstack/electric-db-collection'

const addTodoAction = createOptimisticAction({
  onMutate: ({ text }) => {
    const tempId = crypto.randomUUID()
    todosCollection.insert({
      id: tempId,
      text,
      completed: false,
      created_at: new Date(),
    })
  },
  
  mutationFn: async ({ text }) => {
    await api.todos.create({
      data: { text, completed: false }
    })
    
    // Wait for matching message
    await todosCollection.utils.awaitMatch(
      (message) => {
        return isChangeMessage(message) && 
               message.headers.operation === 'insert' &&
               message.value.text === text
      }
    )
  }
})
```

## Utility Methods

The collection provides these utility methods via `collection.utils`:

### `awaitTxId(txid, timeout?)`

Manually wait for a specific transaction ID to be synchronized:

```typescript
// Wait for specific txid
await todosCollection.utils.awaitTxId(12345)

// With custom timeout (default is 30 seconds)
await todosCollection.utils.awaitTxId(12345, 10000)
```

This is useful when you need to ensure a mutation has been synchronized before proceeding with other operations.

### `awaitMatch(matchFn, timeout?)`

Manually wait for a custom match function to find a matching message:

```typescript
import { isChangeMessage } from '@tanstack/electric-db-collection'

// Wait for a specific message pattern
await todosCollection.utils.awaitMatch(
  (message) => {
    return isChangeMessage(message) &&
           message.headers.operation === 'insert' &&
           message.value.text === 'New Todo'
  },
  5000 // timeout in ms
)
```

### Helper Functions

The package exports helper functions for use in custom match functions:

- `isChangeMessage(message)`: Check if a message is a data change (insert/update/delete)
- `isControlMessage(message)`: Check if a message is a control message (up-to-date, must-refetch)

```typescript
import { isChangeMessage, isControlMessage } from '@tanstack/electric-db-collection'

// Use in custom match functions
const matchFn = (message) => {
  if (isChangeMessage(message)) {
    return message.headers.operation === 'insert'
  }
  return false
}
```

## Debugging

### Common Issue: awaitTxId Stalls or Times Out

A frequent issue developers encounter is that `awaitTxId` (or the transaction's `isPersisted.promise`) stalls indefinitely, eventually timing out with no error messages. The data persists correctly to the database, but the optimistic mutation never resolves.

**Root Cause:** This happens when the transaction ID (txid) returned from your API doesn't match the actual transaction ID of the mutation in Postgres. This mismatch occurs when you query `pg_current_xact_id()` **outside** the same transaction that performs the mutation.

### Enable Debug Logging

To diagnose txid issues, enable debug logging in your browser console:

```javascript
localStorage.debug = 'ts/db:electric'
```

This will show you when mutations start waiting for txids and when txids arrive from Electric's sync stream.

This is powered by the [debug](https://www.npmjs.com/package/debug) package.

**When txids DON'T match (common bug):**
```
ts/db:electric awaitTxId called with txid 124
ts/db:electric new txids synced from pg [123]
// Stalls forever - 124 never arrives!
```

In this example, the mutation happened in transaction 123, but you queried `pg_current_xact_id()` in a separate transaction (124) that ran after the mutation. The client waits for 124 which will never arrive.

**When txids DO match (correct):**
```
ts/db:electric awaitTxId called with txid 123
ts/db:electric new txids synced from pg [123]
ts/db:electric awaitTxId found match for txid 123
// Resolves immediately!
```

### The Solution: Query txid Inside the Transaction

You **must** call `pg_current_xact_id()` inside the same transaction as your mutation:

**❌ Wrong - txid queried outside transaction:**
```typescript
// DON'T DO THIS
async function createTodo(data) {
  const txid = await generateTxId(sql) // Wrong: separate transaction

  await sql.begin(async (tx) => {
    await tx`INSERT INTO todos ${tx(data)}`
  })

  return { txid } // This txid won't match!
}
```

**✅ Correct - txid queried inside transaction:**
```typescript
// DO THIS
async function createTodo(data) {
  let txid!: Txid

  const result = await sql.begin(async (tx) => {
    // Call generateTxId INSIDE the transaction
    txid = await generateTxId(tx)

    const [todo] = await tx`
      INSERT INTO todos ${tx(data)}
      RETURNING *
    `
    return todo
  })

  return { todo: result, txid } // txid matches the mutation
}

async function generateTxId(tx: any): Promise<Txid> {
  const result = await tx`SELECT pg_current_xact_id()::xid::text as txid`
  const txid = result[0]?.txid

  if (txid === undefined) {
    throw new Error(`Failed to get transaction ID`)
  }

  return parseInt(txid, 10)
}
```

See working examples in:
- `examples/react/todo/src/routes/api/todos.ts`
- `examples/react/todo/src/api/server.ts`
