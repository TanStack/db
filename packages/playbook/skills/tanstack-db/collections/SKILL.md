---
name: tanstack-db-collections
description: |
  Collection types and configuration in TanStack DB.
  Use for QueryCollection, ElectricCollection, local collections, and sync modes.
---

# Collections

Collections are typed data stores that decouple data loading from data binding. They can be populated from REST APIs, sync engines, or local storage, then queried uniformly with live queries.

## Collection Types

| Type                       | Package                             | Use Case                             |
| -------------------------- | ----------------------------------- | ------------------------------------ |
| **QueryCollection**        | `@tanstack/query-db-collection`     | REST APIs via TanStack Query         |
| **ElectricCollection**     | `@tanstack/electric-db-collection`  | Real-time Postgres sync via Electric |
| **PowerSyncCollection**    | `@tanstack/powersync-db-collection` | Offline-first with PowerSync         |
| **RxDBCollection**         | `@tanstack/rxdb-db-collection`      | RxDB local persistence               |
| **TrailBaseCollection**    | `@tanstack/trailbase-db-collection` | TrailBase real-time backend          |
| **LocalStorageCollection** | `@tanstack/db`                      | Browser localStorage persistence     |
| **LocalOnlyCollection**    | `@tanstack/db`                      | In-memory state (no persistence)     |

## Common Patterns

### QueryCollection (REST APIs)

```tsx
import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => {
      const response = await fetch('/api/todos')
      return response.json()
    },
    getKey: (item) => item.id,
    schema: todoSchema, // Optional: Zod, Valibot, etc.

    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          fetch('/api/todos', {
            method: 'POST',
            body: JSON.stringify(m.modified),
          }),
        ),
      )
    },

    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          fetch(`/api/todos/${m.original.id}`, {
            method: 'PUT',
            body: JSON.stringify(m.modified),
          }),
        ),
      )
    },

    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          fetch(`/api/todos/${m.original.id}`, { method: 'DELETE' }),
        ),
      )
    },
  }),
)
```

### Sync Modes

Control how data loads into collections:

```tsx
const productsCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['products'],
    queryFn: async (ctx) => {
      // Query predicates available in ctx.meta for on-demand mode
      const params = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions)
      return api.getProducts(params)
    },
    getKey: (item) => item.id,

    // Choose sync mode:
    syncMode: 'eager', // Default: Load all upfront (<10k rows)
    // syncMode: 'on-demand', // Load only what queries request (>50k rows)
    // syncMode: 'progressive', // Load subset first, sync full in background
  }),
)
```

| Mode          | Behavior                                   | Best For                                |
| ------------- | ------------------------------------------ | --------------------------------------- |
| `eager`       | Load entire collection upfront             | <10k rows, mostly static data           |
| `on-demand`   | Load only what queries request             | >50k rows, search interfaces, catalogs  |
| `progressive` | Load query subset, sync full in background | Collaborative apps, instant first paint |

### ElectricCollection (Real-time Sync)

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
      params: { table: 'todos' },
    },

    onInsert: async ({ transaction }) => {
      const response = await api.todos.create(transaction.mutations[0].modified)
      return { txid: response.txid } // Return txid to wait for sync
    },

    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const response = await api.todos.update(original.id, changes)
      return { txid: response.txid }
    },
  }),
)
```

### LocalStorageCollection

```tsx
import {
  createCollection,
  localStorageCollectionOptions,
} from '@tanstack/react-db'

const settingsCollection = createCollection(
  localStorageCollectionOptions({
    id: 'user-settings',
    storageKey: 'app-settings',
    getKey: (item) => item.id,
    schema: settingsSchema,
  }),
)

// Data persists across sessions and syncs across tabs
settingsCollection.insert({ id: 'theme', value: 'dark' })
```

### LocalOnlyCollection

```tsx
import {
  createCollection,
  localOnlyCollectionOptions,
} from '@tanstack/react-db'

const uiStateCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'ui-state',
    getKey: (item) => item.id,
  }),
)

// In-memory only, lost on refresh
uiStateCollection.insert({ id: 'sidebar', expanded: true })
```

### Collection with Schema

```tsx
import { z } from 'zod'

const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  completed: z.boolean().default(false),
  created_at: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val))
    .default(() => new Date()),
})

const todoCollection = createCollection(
  queryCollectionOptions({
    schema: todoSchema, // Validates inserts/updates, transforms types
    queryKey: ['todos'],
    queryFn: async () => api.todos.getAll(),
    getKey: (item) => item.id,
  }),
)
```

### Using TanStack Query Client

```tsx
import { QueryClient } from '@tanstack/react-query'

const queryClient = new QueryClient()

const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => api.todos.getAll(),
    getKey: (item) => item.id,
    queryClient, // Use your existing query client
  }),
)
```

## Collection API

```tsx
// Read operations
collection.get(key) // Get item by key
collection.has(key) // Check if key exists
collection.toArray // Get all items as array
collection.size // Number of items

// Write operations (trigger handlers)
collection.insert(item) // Insert item(s)
collection.update(key, fn) // Update item(s) with draft function
collection.delete(key) // Delete item(s)

// Utilities (collection-specific)
collection.utils.refetch() // QueryCollection: refetch from API
collection.utils.awaitTxId() // ElectricCollection: wait for txid
collection.utils.awaitMatch() // ElectricCollection: wait for custom match
collection.utils.acceptMutations() // LocalCollection: accept in manual tx
```

## Configuration Options

```tsx
interface CollectionOptions {
  id?: string // Unique identifier
  getKey: (item) => Key // Extract unique key from item
  schema?: StandardSchema // Validation schema (Zod, Valibot, etc.)

  // Persistence handlers
  onInsert?: MutationFn
  onUpdate?: MutationFn
  onDelete?: MutationFn

  // QueryCollection specific
  queryKey?: QueryKey
  queryFn?: QueryFn
  queryClient?: QueryClient
  syncMode?: 'eager' | 'on-demand' | 'progressive'

  // ElectricCollection specific
  shapeOptions?: ShapeStreamOptions
}
```

## Collection-Specific Skills

For detailed patterns on each collection type, see the dedicated skill directories:

| Skill                   | Directory       | When to Use                                     |
| ----------------------- | --------------- | ----------------------------------------------- |
| **QueryCollection**     | `../query/`     | REST API integration, TanStack Query, refetch   |
| **ElectricCollection**  | `../electric/`  | ElectricSQL, shapes, txid matching, proxy setup |
| **PowerSyncCollection** | `../powersync/` | Offline-first, SQLite, type serialization       |
| **RxDBCollection**      | `../rxdb/`      | RxDB storage backends, replication, migrations  |
| **TrailBaseCollection** | `../trailbase/` | TrailBase events, type conversions              |

## Detailed References

| Reference                          | When to Use                                 |
| ---------------------------------- | ------------------------------------------- |
| `references/local-collections.md`  | LocalStorage, LocalOnly, cross-tab sync     |
| `references/sync-modes.md`         | Eager vs on-demand vs progressive tradeoffs |
| `references/custom-collections.md` | Building your own collection type           |
