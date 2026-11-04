---
title: TrailBase Collection
---

TrailBase collections provide seamless integration between TanStack DB and [TrailBase](https://trailbase.io), enabling real-time data synchronization with TrailBase's self-hosted application backend.

## Overview

[TrailBase](https://trailbase.io) is an easy-to-self-host, single-executable application backend with built-in SQLite, a V8 JS runtime, auth, admin UIs and sync functionality.

The `@tanstack/trailbase-db-collection` package allows you to create collections that:
- Automatically sync data from TrailBase Record APIs
- Support real-time subscriptions when `enable_subscriptions` is enabled
- Handle optimistic updates with automatic rollback on errors
- Provide parse/serialize functions for data transformation

## Installation

```bash
npm install @tanstack/trailbase-db-collection @tanstack/react-db trailbase
```

## Basic Usage

```typescript
import { createCollection } from '@tanstack/react-db'
import { trailBaseCollectionOptions } from '@tanstack/trailbase-db-collection'
import { initClient } from 'trailbase'

const trailBaseClient = initClient(`https://your-trailbase-instance.com`)

type Todo = { id: string; text: string; completed: boolean }

const todosCollection = createCollection(
  trailBaseCollectionOptions<Todo>({
    id: 'todos',
    client: trailBaseClient,
    recordApi: trailBaseClient.records('todos'),
    getKey: (item) => item.id,
    parse: {},
    serialize: {},
  })
)
```

## Configuration Options

The `trailBaseCollectionOptions` function accepts the following options:

### Required Options

- `id`: Unique identifier for the collection
- `client`: The TrailBase client the record API comes from. Each transaction's writes go through its `execute` as one TrailBase transaction, so they commit together or not at all.
- `recordApi`: TrailBase Record API instance created via `trailBaseClient.records()`
- `getKey`: Function to extract the unique key from an item
- `parse`: Object mapping field names to parsing functions that transform data coming from TrailBase. Use `{}` when the record and the item have the same shape.
- `serialize`: Object mapping field names to serialization functions that transform data going to TrailBase. An update that removes a field (for example `draft.tags = undefined`) sends `null`, which clears the column, without calling that field's function. A `NOT NULL` column rejects such an update. Use `{}` when the record and the item have the same shape.

### Optional Options

- `syncMode`: `eager` (the default) loads every record at startup, and `on-demand` loads the records that queries ask for

## Data Transformation

TrailBase uses different data formats for storage (e.g., Unix timestamps). Use `parse` and `serialize` to handle these transformations:

```typescript
type SelectTodo = {
  id: string
  text: string
  created_at: number // Unix timestamp from TrailBase
  completed: boolean
}

type Todo = {
  id: string
  text: string
  created_at: Date // JavaScript Date for app usage
  completed: boolean
}

const todosCollection = createCollection(
  trailBaseCollectionOptions<Todo, SelectTodo>({
    id: 'todos',
    client: trailBaseClient,
    recordApi: trailBaseClient.records('todos'),
    getKey: (item) => item.id,
    // Transform TrailBase data to application format
    parse: {
      created_at: (ts) => new Date(ts * 1000),
    },
    // Transform application data to TrailBase format
    serialize: {
      created_at: (date) => Math.floor(date.valueOf() / 1000),
    },
  })
)
```

## Real-time Subscriptions

TrailBase supports real-time subscriptions when enabled on the server. The collection automatically subscribes to changes and updates in real-time:

```typescript
type Todo = { id: string; text: string; completed: boolean }

const todosCollection = createCollection(
  trailBaseCollectionOptions<Todo>({
    id: 'todos',
    client: trailBaseClient,
    recordApi: trailBaseClient.records('todos'),
    getKey: (item) => item.id,
    parse: {},
    serialize: {},
    // Real-time updates work automatically when
    // enable_subscriptions is set in TrailBase config
  })
)

// Changes from other clients will automatically update
// the collection in real-time
```

## Writes and Transactions

The adapter persists inserts, updates, and deletes itself, so it takes no `onInsert`, `onUpdate`, or `onDelete` handler. Each transaction goes to TrailBase as one `client.execute` call, so its writes commit together or not at all. A write settles when its change event arrives through the subscription:

```typescript
// One transaction: TrailBase saves both updates or neither.
const tx = todosCollection.update([firstId, secondId], (drafts) => {
  for (const draft of drafts) draft.completed = true
})
await tx.when('settled')
```

If TrailBase rejects the transaction, `tx.when('settled')` rejects with its error, and the optimistic changes roll back.

## Complete Example

```typescript
import { createCollection, useLiveQuery } from '@tanstack/react-db'
import { not } from '@tanstack/db'
import { trailBaseCollectionOptions } from '@tanstack/trailbase-db-collection'
import { initClient } from 'trailbase'

const trailBaseClient = initClient(`https://your-trailbase-instance.com`)

type SelectTodo = {
  id: string
  text: string
  completed: boolean
  created_at: number
}

type Todo = {
  id: string
  text: string
  completed: boolean
  created_at: Date
}

// Create collection
export const todosCollection = createCollection(
  trailBaseCollectionOptions<Todo, SelectTodo>({
    id: 'todos',
    client: trailBaseClient,
    recordApi: trailBaseClient.records('todos'),
    getKey: (item) => item.id,
    parse: {
      created_at: (ts) => new Date(ts * 1000),
    },
    serialize: {
      created_at: (date) => Math.floor(date.valueOf() / 1000),
    },
  })
)

// Use in component
function TodoList() {
  const { data: todos } = useLiveQuery({
    query: (q) =>
      q
        .from({ todo: todosCollection })
        .where(({ todo }) => not(todo.completed))
        .orderBy(({ todo }) => todo.created_at, 'desc'),
  })

  const addTodo = (text: string) => {
    todosCollection.insert({
      id: crypto.randomUUID(),
      text,
      completed: false,
      created_at: new Date(),
    })
  }

  return (
    <div>
      {todos.map((todo) => (
        <div key={todo.id}>{todo.text}</div>
      ))}
    </div>
  )
}
```

## Learn More

- [TrailBase Documentation](https://trailbase.io/documentation/)
- [TrailBase Record APIs](https://trailbase.io/documentation/apis_record/)
- [Optimistic Mutations](../guides/mutations.md)
- [Live Queries](../guides/live-queries.md)
