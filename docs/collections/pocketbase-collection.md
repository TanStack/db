---
title: PocketBase Collection
---

# PocketBase Collection

PocketBase collections provide seamless integration between TanStack DB and [PocketBase](https://pocketbase.io), enabling real-time data synchronization with PocketBase's open-source backend.

## Overview

[PocketBase](https://pocketbase.io) is an open-source backend consisting of an embedded database (SQLite), real-time subscriptions, built-in auth, file storage, and an admin dashboard.

The `@tanstack/pocketbase-db-collection` package allows you to create collections that:
- Automatically sync data from PocketBase collections
- Support real-time subscriptions for live updates
- Handle optimistic updates with automatic rollback on errors
- Provide built-in mutation handlers for create, update, and delete operations

## Installation

```bash
npm install @tanstack/pocketbase-db-collection @tanstack/react-db pocketbase
```

## Basic Usage

```typescript
import { createCollection } from '@tanstack/react-db'
import { pocketbaseCollectionOptions } from '@tanstack/pocketbase-db-collection'
import PocketBase from 'pocketbase'

const pb = new PocketBase('https://your-pocketbase-instance.com')

// Authenticate if needed
await pb.collection("users").authWithPassword('test@example.com', '1234567890');

const todosCollection = createCollection(
  pocketbaseCollectionOptions({
    recordService: pb.collection('todos'),
  })
)
```

## Configuration Options

The `pocketbaseCollectionOptions` function accepts the following options:

### Required Options

- `recordService`: PocketBase RecordService instance created via `pb.collection(collectionName)`

### Optional Options

- `id`: Unique identifier for the collection
- `schema`: [Standard Schema](https://standardschema.dev) compatible schema (e.g., Zod, Effect) for client-side validation

## Real-time Subscriptions

PocketBase supports real-time subscriptions out of the box. The collection automatically subscribes to changes and updates in real-time:

```typescript
const todosCollection = createCollection(
  pocketbaseCollectionOptions({
    recordService: pb.collection('todos'),
  })
)

// Changes from other clients will automatically update
// the collection in real-time via PocketBase subscriptions
```

The sync implementation subscribes to all records (`*`) and handles `create`, `update`, and `delete` events automatically.

## Mutations

The collection provides built-in mutation handlers that persist changes to PocketBase:

```typescript
// Insert a new record
const tx = todosCollection.insert({
  id: 'todo-1',
  text: 'Buy milk',
  completed: false,
})
await tx.isPersisted.promise

// Update a record
const updateTx = todosCollection.update('todo-1', (draft) => {
  draft.completed = true
})
await updateTx.isPersisted.promise

// Delete a record
const deleteTx = todosCollection.delete('todo-1')
await deleteTx.isPersisted.promise
```

## Data Types

PocketBase records must have an `id` field (string) and can include any other fields. The `collectionId` and `collectionName` fields from PocketBase's `RecordModel` are automatically excluded:

```typescript
type Todo = {
  id: string // Required - PocketBase uses string IDs
  text: string
  completed: boolean
  // You can add any other fields from your PocketBase collection
}

const todosCollection = createCollection(
  pocketbaseCollectionOptions<Todo>({
    recordService: pb.collection('todos'),
  })
)
```

## Complete Example

```typescript
import { createCollection } from '@tanstack/react-db'
import { pocketbaseCollectionOptions } from '@tanstack/pocketbase-db-collection'
import PocketBase from 'pocketbase'
import { z } from 'zod'

const pb = new PocketBase('https://your-pocketbase-instance.com')

// Authenticate
await pb.collection('users').authWithPassword('user@example.com', 'password')

// Define schema
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  created: z.string(),
  updated: z.string(),
})

type Todo = z.infer<typeof todoSchema>

// Create collection
export const todosCollection = createCollection(
  pocketbaseCollectionOptions({
    id: 'todos',
    recordService: pb.collection('todos'),
    schema: todoSchema,
  })
)

// Use in component
function TodoList() {
  const { data: todos } = useLiveQuery((q) =>
    q.from({ todo: todosCollection })
      .where(({ todo }) => !todo.completed)
      .orderBy(({ todo }) => todo.created, 'desc')
  )

  const addTodo = (text: string) => {
    todosCollection.insert({
      id: crypto.randomUUID(),
      text,
      completed: false,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
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

## Error Handling

The collection handles errors gracefully:
- If the initial fetch fails, the subscription is automatically cleaned up
- Mutations that fail will automatically rollback optimistic updates
- The collection is marked as ready even if the initial fetch fails to avoid blocking the application

## Cleanup

The collection automatically unsubscribes from PocketBase when cleaned up:

```typescript
// Cleanup is called automatically when the collection is no longer needed
await todosCollection.cleanup()
```

This ensures no memory leaks and properly closes the real-time subscription connection.

## Learn More

- [PocketBase Documentation](https://pocketbase.io/docs/)
- [PocketBase JavaScript SDK](https://github.com/pocketbase/js-sdk)
- [Optimistic Mutations](../guides/mutations.md)
- [Live Queries](../guides/live-queries.md)

