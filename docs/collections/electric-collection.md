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

It might not always be feasible to return transactions identifiers from your API. In that case, you can use a custom match function.

```js
onInsert: async ({ transaction }) => {
  const item = transaction.mutations[0].modified
  await api.todos.create(item) // API doesn't return txid
  
  return {
    matchStream: (stream) => matchStream(
      stream,
      ['insert'],
      (msg) => msg.value.id === item.id,
      3000 // timeout fallback
    )
  }
}
```

## Using a proxy with Electric

Electric is typically deployed behind a proxy server that handles shape configuration, authentication and authorization. This provides better security and allows you to control what data users can access without exposing Electric to the client.


Here is an example proxy implementation using TanStack Starter:

```js
import { createServerFileRoute } from "@tanstack/react-start/server"

// Electric URL
const baseUrl = 'http://.../v1/shape'

const serve = async ({ request }: { request: Request }) => {
	// ...check user authorization
  
	const url = new URL(request.url)
  const originUrl = new URL(baseUrl)

  // passthrough parameters from electric client
  url.searchParams.forEach((value, key) => {
    if (
      [
        "live",
        "handle",
        "offset",
        "cursor",
      ].includes(key)
    ) {
      originUrl.searchParams.set(key, value)
    }
  })

  // the shape parameters
  originUrl.searchParams.set("table", "todos")
  // originUrl.searchParams.set("where", "completed = true")
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


## Utility Methods

The collection provides these utility methods via `collection.utils`:

- `awaitTxId(txid, timeout?)`: Manually wait for a specific transaction ID to be synchronized

```typescript
todosCollection.utils.awaitTxId(12345)
```

This is useful when you need to ensure a mutation has been synchronized before proceeding with other operations.

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
