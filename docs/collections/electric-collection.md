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

- `onInsert`: Handler called before insert operations
- `onUpdate`: Handler called before update operations  
- `onDelete`: Handler called before delete operations

## Persistence Handlers

Handlers can be defined to run on mutations. They are useful to send mutations to the backend and confirming them once Electric delivers the corresponding transactions. Until confirmation, TanStack DB blocks sync data for the collection to prevent race conditions. To avoid any delays, it’s important to use a matching strategy.

The most reliable strategy is for the backend to include the transaction ID (txid) in its response, allowing the client to match each mutation with Electric’s transaction identifiers for precise confirmation. If no strategy is provided, client mutations are automatically confirmed after three seconds.

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
    
    onInsert: async ({ transaction }) => {
      const newItem = transaction.mutations[0].modified
      const response = await api.todos.create(newItem)
      
      return { txid: response.txid }
    },
    
    // you can also implement onUpdate and onDelete handlers
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

For more advanced use cases, you can create custom actions that can do multiple mutations across collections transactionally. In this case, you need to explicitly await for the transaction ID using `utils.awaitTxId()`.

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
    
    await todosCollection.utils.awaitTxId(response.txid)
  }
})
```

## Utility Methods

The collection provides these utility methods via `collection.utils`:

- `awaitTxId(txid, timeout?)`: Manually wait for a specific transaction ID to be synchronized

```typescript
todosCollection.utils.awaitTxId(12345)
```

This is useful when you need to ensure a mutation has been synchronized before proceeding with other operations.

## Debugging

### Common Issue: awaitTxId Stalls or Times Out

A frequent issue developers encounter is that `awaitTxId` (or the transaction's `isPersisted.promise`) stalls indefinitely, eventually timing out with no error messages. The data persists correctly to the database, but the optimistic mutation never resolves.

**Root Cause:** This happens when the transaction ID (txid) returned from your API doesn't match the actual transaction ID of the mutation in Postgres. This mismatch occurs when you query `pg_current_xact_id()` **outside** the same transaction that performs the mutation.

### Enable Debug Logging

To diagnose txid issues, enable debug logging in your browser console:

```javascript
localStorage.debug = '*'
```

This will show you when mutations start waiting for txids and when txids arrive from Electric's sync stream.

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
