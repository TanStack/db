---
title: Dexie Collection
---

# Dexie Collection

Dexie collections provide seamless integration between TanStack DB and [Dexie.js](https://dexie.org), enabling a local-first persistence layer with efficient change monitoring and IndexedDB storage. This integration keeps an in-memory TanStack DB collection in perfect sync with a Dexie table while supporting optimistic updates, efficient syncing, and reactive live updates.

## Overview

The `@tanstack/dexie-db-collection` package allows you to create collections that:
- Automatically sync with IndexedDB through Dexie.js for offline-first persistence
- Reactively update when Dexie data changes using `liveQuery`
- Support optimistic mutations with acknowledgment tracking
- Handle efficient initial syncing with configurable batch sizes
- Provide utilities for testing and advanced integration scenarios
- Use metadata fields for efficient sync and conflict resolution

## Installation

```bash
npm install @tanstack/dexie-db-collection @tanstack/react-db
```

## Basic Usage

Create a TanStack DB collection that automatically syncs with a Dexie table:

```typescript
import { createCollection } from '@tanstack/react-db'
import { dexieCollectionOptions } from '@tanstack/dexie-db-collection'
import { z } from 'zod'

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
})

const todosCollection = createCollection(
  dexieCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (item) => item.id,
  })
)
```

This creates a collection that:
- Uses IndexedDB for persistence via Dexie
- Automatically creates a database named `app-db` with a table named `todos`
- Keeps the in-memory collection and Dexie table in sync
- Supports all standard TanStack DB operations

## Configuration Options

The `dexieCollectionOptions` function accepts the following options:

### Required Options

- `getKey`: Function to extract the unique key from an item

### Database Configuration

- `id`: Unique identifier for the collection (also used as table name if not specified)
- `dbName`: Dexie database name (default: `'app-db'`)
- `tableName` / `storeName`: Name of the Dexie table (defaults to the collection `id`)

### Schema and Validation

- `schema`: Schema for type inference and optional runtime validation (Standard Schema v1, Zod, etc.)

### Sync Configuration

- `syncBatchSize`: Batch size for initial sync (default: `1000`)
- `rowUpdateMode`: Update strategy - `'partial'` or `'full'` (default: `'partial'`)

### Timeouts

- `ackTimeoutMs`: Timeout for acknowledgment tracking (default: `2000ms`)
- `awaitTimeoutMs`: Timeout for awaiting IDs (default: `10000ms`)

### Data Transformation

- `codec`: Optional data transformation between stored and in-memory shapes

## Usage with Schema

Provide a schema for type inference and validation:

```typescript
import { z } from 'zod'

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  createdAt: z.date().optional(),
})

const todosCollection = createCollection(
  dexieCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (item) => item.id, // `item` is fully typed from schema
    dbName: 'my-todo-app',
    tableName: 'todos',
  })
)
```

When using a schema:
- The `getKey` function is fully typed
- Runtime validation is automatically applied
- Type inference works seamlessly

## Advanced Configuration

### Custom Database and Table Names

```typescript
import { z } from 'zod'

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
})

const todosCollection = createCollection(
  dexieCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    dbName: 'my-app-db',
    tableName: 'user_todos',
    getKey: (item) => item.id,
  })
)
```

### Row Update Modes

Control how updates are applied to Dexie:

```typescript
import { z } from 'zod'

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
})

const todosCollection = createCollection(
  dexieCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (item) => item.id,
    rowUpdateMode: 'full', // Use table.put for full replacement
    // rowUpdateMode: 'partial', // Use table.update for partial updates (default)
  })
)
```

### Data Transformation with Codec

Transform data between stored and in-memory formats:

```typescript
import { z } from 'zod'

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  createdAt: z.date().optional(),
})

const todosCollection = createCollection(
  dexieCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (item) => item.id,
    codec: {
      // Transform when reading from Dexie
      parse: (stored) => ({
        ...stored,
        createdAt: stored.createdAt ? new Date(stored.createdAt) : undefined,
      }),
      // Transform when writing to Dexie
      serialize: (item) => ({
        ...item,
        createdAt: item.createdAt?.toISOString(),
      }),
    },
  })
)
```

### Sync Optimization

Configure sync behavior for large datasets:

```typescript
import { z } from 'zod'

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
})

const todosCollection = createCollection(
  dexieCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (item) => item.id,
    syncBatchSize: 500, // Smaller batches for memory optimization
    ackTimeoutMs: 5000, // Longer timeout for slow devices
    awaitTimeoutMs: 15000, // Extended timeout for tests
  })
)
```

## How Syncing Works

### Initial Sync

1. **Batch Loading**: Reads Dexie rows in batches for efficient transfer
2. **Live Updates**: Uses Dexie's `liveQuery` for real-time reactive updates
3. **Change Detection**: Efficient diffing prevents unnecessary updates

## Utility Methods

The collection provides utility methods via `collection.utils`:

### Database Access

```typescript
// Get direct access to the Dexie table
const table = todosCollection.utils.getTable()
await table.where('completed').equals(true).toArray()
```

### Manual Refresh

```typescript
// Force the liveQuery to re-evaluate
todosCollection.utils.refresh()

// Trigger refresh and wait for processing
await todosCollection.utils.refetch()
```

## Live Query Integration

Dexie collections work seamlessly with live queries for reactive data access. You can create filtered, sorted views that automatically update when the underlying data changes.

### Basic Live Query Example

```typescript
import { createCollection, liveQueryCollectionOptions, eq } from '@tanstack/react-db'
import { dexieCollectionOptions } from '@tanstack/dexie-db-collection'
import { z } from 'zod'

const noteSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  isPinned: z.boolean(),
  updatedAt: z.date(),
})

// Base collection with Dexie persistence
const notesCollection = createCollection(
  dexieCollectionOptions({
    id: 'notes',
    schema: noteSchema,
    getKey: (note) => note.id,
  })
)

// Live query for pinned notes
export const pinnedNotesCollection = createCollection(
  liveQueryCollectionOptions({
    id: "pinned-notes-live",
    startSync: true,
    query: (q) =>
      q
        .from({ note: notesCollection })
        .where(({ note }) => eq(note.isPinned, true))
        .orderBy(({ note }) => note.updatedAt, "desc"),
  })
)

// Use in React component
function PinnedNotes() {
  const { data: pinnedNotes } = useLiveQuery(pinnedNotesCollection)
  
  return (
    <div>
      {pinnedNotes.map(note => (
        <div key={note.id}>{note.title}</div>
      ))}
    </div>
  )
}
```

### Advanced Live Query with Joins

```typescript
import { createCollection, liveQueryCollectionOptions, eq, gt } from '@tanstack/react-db'
import { z } from 'zod'

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
})

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  userId: z.string(),
  priority: z.number(),
  dueDate: z.date(),
})

// Base collections
const usersCollection = createCollection(
  dexieCollectionOptions({
    id: 'users',
    schema: userSchema,
    getKey: (user) => user.id,
  })
)

const tasksCollection = createCollection(
  dexieCollectionOptions({
    id: 'tasks',
    schema: taskSchema,
    getKey: (task) => task.id,
  })
)

// Live query for active user tasks
export const activeUserTasksCollection = createCollection(
  liveQueryCollectionOptions({
    id: "active-user-tasks",
    startSync: true,
    query: (q) =>
      q
        .from({ user: usersCollection })
        .join({ task: tasksCollection }, ({ user, task }) => 
          eq(user.id, task.userId)
        )
        .where(({ user }) => eq(user.isActive, true))
        .where(({ task }) => gt(task.priority, 2))
        .select(({ user, task }) => ({
          taskId: task.id,
          taskTitle: task.title,
          userName: user.name,
          priority: task.priority,
          dueDate: task.dueDate,
        }))
        .orderBy(({ task }) => task.dueDate, "asc"),
  })
)

// Use in component
function HighPriorityTasks() {
  const { data: tasks } = useLiveQuery(activeUserTasksCollection)
  
  return (
    <div>
      <h2>High Priority Tasks</h2>
      {tasks.map(task => (
        <div key={task.taskId}>
          <h3>{task.taskTitle}</h3>
          <p>Assigned to: {task.userName}</p>
          <p>Priority: {task.priority}</p>
          <p>Due: {task.dueDate}</p>
        </div>
      ))}
    </div>
  )
}
```

The live queries automatically update when:
- Notes are pinned/unpinned in the base collection
- Users' active status changes
- Tasks are added, modified, or their priority changes
- Due dates are updated

This provides a reactive, real-time UI that stays in sync with your IndexedDB data.
