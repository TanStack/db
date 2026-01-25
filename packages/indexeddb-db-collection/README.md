# @tanstack/indexeddb-db-collection

**IndexedDB-backed collections for TanStack DB**

Persistent local storage with automatic cross-tab synchronization for TanStack DB collections. Data persists across browser sessions and stays in sync across all open tabs.

## Installation

```bash
npm install @tanstack/indexeddb-db-collection @tanstack/db
```

## Quick Start

```typescript
import { createCollection } from '@tanstack/db'
import { createIndexedDB, indexedDBCollectionOptions } from '@tanstack/indexeddb-db-collection'

interface Todo {
  id: string
  text: string
  completed: boolean
}

// Step 1: Create the database with all stores defined upfront
const db = await createIndexedDB({
  name: 'myApp',
  version: 1,
  stores: ['todos'],
})

// Step 2: Create collections using the shared database
const todosCollection = createCollection<Todo>(
  indexedDBCollectionOptions({
    db,
    name: 'todos',
    getKey: (todo) => todo.id,
  })
)
```

## Features

- **Persistent Storage** - Data survives browser refreshes and sessions
- **Cross-Tab Sync** - Changes automatically propagate to all open tabs via BroadcastChannel
- **Multiple Collections** - Share a single database across multiple collections
- **Schema Validation** - Optional schema support with Standard Schema (Zod, Valibot, etc.)
- **Full TypeScript Support** - Complete type inference for items and keys
- **Utility Functions** - Export, import, clear, and inspect your data

## Usage

### Multiple Collections Sharing a Database

```typescript
import { createCollection } from '@tanstack/db'
import { createIndexedDB, indexedDBCollectionOptions } from '@tanstack/indexeddb-db-collection'

// Create database with all stores at once
const db = await createIndexedDB({
  name: 'myApp',
  version: 1,
  stores: ['todos', 'users', 'settings'],
})

// Create multiple collections using the same database
const todosCollection = createCollection(
  indexedDBCollectionOptions({
    db,
    name: 'todos',
    getKey: (todo) => todo.id,
  })
)

const usersCollection = createCollection(
  indexedDBCollectionOptions({
    db,
    name: 'users',
    getKey: (user) => user.id,
  })
)

const settingsCollection = createCollection(
  indexedDBCollectionOptions({
    db,
    name: 'settings',
    getKey: (setting) => setting.key,
  })
)
```

### With Schema Validation

```typescript
import { z } from 'zod'
import { createCollection } from '@tanstack/db'
import { createIndexedDB, indexedDBCollectionOptions } from '@tanstack/indexeddb-db-collection'

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
})

const db = await createIndexedDB({
  name: 'myApp',
  version: 1,
  stores: ['todos'],
})

const todosCollection = createCollection(
  indexedDBCollectionOptions({
    db,
    name: 'todos',
    schema: todoSchema,
    getKey: (todo) => todo.id,
  })
)
```

### Configuration Options

#### createIndexedDB Options

```typescript
const db = await createIndexedDB({
  // Required: Name of the IndexedDB database
  name: 'myApp',

  // Required: Schema version (increment when adding/removing stores)
  version: 1,

  // Required: Object store names to create
  stores: ['todos', 'users'],

  // Optional: Custom IDBFactory for testing
  idbFactory: fakeIndexedDB,
})
```

#### indexedDBCollectionOptions

```typescript
indexedDBCollectionOptions({
  // Required: IndexedDB instance from createIndexedDB()
  db,

  // Required: Name of the object store within the database
  name: 'todos',

  // Required: Function to extract the unique key from each item
  getKey: (item) => item.id,

  // Optional: Schema for validation (Standard Schema compatible)
  schema: todoSchema,
})
```

### Utility Functions

The collection exposes utility functions via `collection.utils`:

```typescript
// Clear all data from the object store
await todosCollection.utils.clearObjectStore()

// Delete the entire database
await todosCollection.utils.deleteDatabase()

// Get database info for debugging
const info = await todosCollection.utils.getDatabaseInfo()
// { name: 'myApp', version: 1, objectStores: ['todos', '_versions'] }

// Export all data as an array
const backup = await todosCollection.utils.exportData()

// Import data (clears existing data first)
await todosCollection.utils.importData([
  { id: '1', text: 'Buy milk', completed: false },
  { id: '2', text: 'Walk dog', completed: true },
])

// Accept mutations from a manual transaction
await todosCollection.utils.acceptMutations({ mutations })
```

## Low-Level API

For advanced use cases, the package also exports low-level IndexedDB utilities:

```typescript
import {
  openDatabase,
  executeTransaction,
  getAll,
  getByKey,
  put,
  deleteByKey,
  clear,
  deleteDatabase,
} from '@tanstack/indexeddb-db-collection'

// Open a database with custom upgrade logic
const db = await openDatabase('myApp', 1, (db, oldVersion) => {
  if (oldVersion < 1) {
    db.createObjectStore('items', { keyPath: 'id' })
  }
})

// Execute operations within a transaction
await executeTransaction(db, 'items', 'readwrite', async (tx, stores) => {
  await put(stores.items, { id: '1', value: 'hello' })
  const item = await getByKey(stores.items, '1')
})
```

## Error Handling

The package provides specific error classes for different failure scenarios:

```typescript
import {
  // Low-level IndexedDB errors
  IndexedDBError,
  IndexedDBNotSupportedError,
  IndexedDBConnectionError,
  IndexedDBTransactionError,
  IndexedDBOperationError,
  // Configuration errors
  DatabaseRequiredError,
  ObjectStoreNotFoundError,
  NameRequiredError,
  GetKeyRequiredError,
} from '@tanstack/indexeddb-db-collection'
```

## Cross-Tab Synchronization

Changes made in one tab automatically sync to other tabs via the BroadcastChannel API. Each tab maintains an in-memory version cache to detect changes efficiently.

```typescript
// Tab 1: Insert a todo
todosCollection.insert({ id: '1', text: 'Buy milk', completed: false })

// Tab 2: Automatically receives the update via BroadcastChannel
// No additional code needed - the collection state stays in sync
```

## Testing

When testing, pass a custom `idbFactory` (e.g., from `fake-indexeddb`):

```typescript
import { indexedDB } from 'fake-indexeddb'

const db = await createIndexedDB({
  name: 'test-db',
  version: 1,
  stores: ['items'],
  idbFactory: indexedDB,
})
```

## License

MIT
