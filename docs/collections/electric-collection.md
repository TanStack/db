---
title: Electric Collection
---

# Electric Collection

Electric collections provide seamless integration between TanStack DB and ElectricSQL, enabling real-time data synchronization with your Postgres database through Electric's sync engine.

## Overview

The `@tanstack/electric-db-collection` package allows you to create collections that:
- Automatically sync data from Postgres via Electric shapes
- Support optimistic updates with transaction confirmation and automatic rollback on errors
- Handle persistence through customizable mutation handlers

## Installation

```bash
npm install @tanstack/electric-db-collection @tanstack/db
```

## Basic Usage

```typescript
import { createCollection } from '@tanstack/db'	
import { electricCollectionOptions } from '@tanstack/electric-db-collection'

const todosCollection = createCollection(
  electricCollectionOptions({
    shapeOptions: {
      url: 'https://example.com/v1/shape',
      params: {
        table: 'todos',
      },
    },
    getKey: (item) => item.id,
  })
)
```

## Configuration Options

The `electricCollectionOptions` function accepts the following options:

### Required Options

- `shapeOptions`: Configuration for the ElectricSQL ShapeStream
- `getKey`: Function to extract the unique key from an item

### Shape Options

- `url`: The URL to your Electric sync service
- `params`: Shape parameters including:
  - `table`: The database table to sync
  - `where`: Optional WHERE clause for filtering (e.g., `"status = 'active'"`)
  - `columns`: Optional array of columns to sync

### Collection Options

- `id`: Unique identifier for the collection
- `schema`: Schema for validating items (any Standard Schema compatible schema)
- `sync`: Custom sync configuration

### Persistence Handlers

- `onInsert`: Handler called before insert operations
- `onUpdate`: Handler called before update operations  
- `onDelete`: Handler called before delete operations

## Persistence Handlers

You can define handlers that are called when mutations occur, for instance to persist changes to your backend. Such handlers **must return a transaction ID** (`txid`) to track when the mutation has been synchronized back from Electric:

```typescript
const todosCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (item) => item.id,

	  shapeOptions: {
      url: 'https://api.electric-sql.cloud/v1/shape',
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

### Understanding Transaction IDs

When you commit a transaction in Postgres, it gets assigned a transaction ID. Your API should return this transaction ID in the HTTP response so that the collection can automatically wait for this transaction ID to confirm the optimistic update.

Here is an example of a function to extract the transaction Id from Postgres:

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

## Shape Configuration

Electric shapes allow you to filter and control what data syncs to your collection:

### Basic Table Sync

```typescript
const todosCollection = createCollection(
  electricCollectionOptions({
    shapeOptions: {
      url: 'https://example.com/v1/shape',
      params: {
        table: 'todos',
      },
    },
    getKey: (item) => item.id,
  })
)
```

### Filtered Sync with WHERE Clause

```typescript
const activeTodosCollection = createCollection(
  electricCollectionOptions({
    shapeOptions: {
      url: 'https://example.com/v1/shape',
      params: {
        table: 'todos',
        where: "status = 'active' AND deleted_at IS NULL",
      },
    },
    getKey: (item) => item.id,
  })
)
```

### Column Selection

```typescript
const todoSummaryCollection = createCollection(
  electricCollectionOptions({
    shapeOptions: {
      url: 'https://example.com/v1/shape',
      params: {
        table: 'todos',
        columns: ['id', 'title', 'status'], // Only sync these columns
      },
    },
    getKey: (item) => item.id,
  })
)
```
