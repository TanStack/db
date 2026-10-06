# @tanstack/indexeddb-db-collection

**IndexedDB-backed collections for TanStack DB**

Persistent local storage with automatic cross-tab synchronization for TanStack DB collections. Data persists across browser sessions and stays in sync across all open tabs.

See the [IndexedDB Collection guide](https://tanstack.com/db/latest/docs/collections/indexeddb-collection) for setup, mutations, and connection ownership.

## Installation

```bash
npm install @tanstack/indexeddb-db-collection @tanstack/db
```

## Quick Start

```typescript
import { createCollection } from '@tanstack/db'
import {
  createIndexedDB,
  indexedDBCollectionOptions,
} from '@tanstack/indexeddb-db-collection'

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
const todosCollection = createCollection(
  indexedDBCollectionOptions<Todo>({
    db,
    name: 'todos',
    getKey: (todo) => todo.id,
  }),
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
import {
  createIndexedDB,
  indexedDBCollectionOptions,
} from '@tanstack/indexeddb-db-collection'

interface Todo {
  id: string
  text: string
  completed: boolean
}

interface User {
  id: string
  name: string
}

interface Setting {
  key: string
  value: string
}

// Create database with all stores at once
const db = await createIndexedDB({
  name: 'myApp',
  version: 1,
  stores: ['todos', 'users', 'settings'],
})

// Create multiple collections using the same database
const todosCollection = createCollection(
  indexedDBCollectionOptions<Todo>({
    db,
    name: 'todos',
    getKey: (todo) => todo.id,
  }),
)

const usersCollection = createCollection(
  indexedDBCollectionOptions<User>({
    db,
    name: 'users',
    getKey: (user) => user.id,
  }),
)

const settingsCollection = createCollection(
  indexedDBCollectionOptions<Setting>({
    db,
    name: 'settings',
    getKey: (setting) => setting.key,
  }),
)
```

### With Schema Validation

```typescript
import { z } from 'zod'
import { createCollection } from '@tanstack/db'
import {
  createIndexedDB,
  indexedDBCollectionOptions,
} from '@tanstack/indexeddb-db-collection'

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
  }),
)
```

### Configuration Options

#### createIndexedDB Options

```typescript
const db = await createIndexedDB({
  // Required: Name of the IndexedDB database
  name: 'myApp',

  // Required: Schema version (increment when adding stores)
  version: 1,

  // Required: Object store names to create
  stores: ['todos', 'users'],

  // Optional: Custom IDBFactory for testing
  idbFactory: fakeIndexedDB,
})
```

`stores` requests additive creation during a version upgrade. Omitting a
previously created store does not remove that store or its data. Use explicit
upgrade logic through `openDatabase` for a migration that removes stores.
The returned instance's `stores` contains the requested names;
`collection.utils.getDatabaseInfo()` reports the actual available stores.

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

// Get database info for debugging
const info = await todosCollection.utils.getDatabaseInfo()
// info.estimatedSize is origin-wide usage, including other databases and caches.
// { name: 'myApp', version: 1, objectStores: ['todos', '_versions'] }

// Export all data as an array
const backup = await todosCollection.utils.exportData()

// Import an atomic replacement (validates all inputs before changing data)
await todosCollection.utils.importData([
  { id: '1', text: 'Buy milk', completed: false },
  { id: '2', text: 'Walk dog', completed: true },
])

// Accept mutations from a manual transaction
await todosCollection.utils.acceptMutations({ mutations })
```

### Persistence and failure behavior

Mutation handlers finish before data is persisted. A rejected handler leaves
durable data unchanged and lets the Collection roll back the optimistic change.
Each Collection batch writes its rows and version entries in one IndexedDB
transaction. A failed row aborts that entire batch. Await the transaction's
isPersisted.promise to observe persistence; the transaction itself is not a Promise.

acceptMutations filters a manual transaction to the receiving Collection.
Calling it separately for multiple Collections does not provide one atomic
transaction across those Collections.

exportData returns stored schema output. importData accepts schema input; when
a schema transforms values, convert exported output back to input before import.
For example, convert an exported Date to the string expected by a string-to-Date
schema. Arbitrary schema transformations have no general inverse.

importData validates schema inputs, applies schema defaults and transformations,
and rejects duplicate keys before writing. It atomically replaces the store;
failed validation or persistence preserves the prior rows and versions.
clearObjectStore removes both durable and public source rows. The \_versions
store is reserved for adapter metadata.

Initial loading becomes ready only after its read transaction completes. An
aborted load rejects preload() and reports Collection status error.

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

`executeTransaction` waits for both the callback and the native transaction to
succeed. Async callbacks can await IndexedDB requests in that transaction.
Awaiting unrelated work, such as a timer or network request, does not keep the
native transaction active. Complete that work before opening the transaction.
If the callback rejects after the native transaction has committed, the helper
rejects but cannot roll back the committed data.

## Blocked database operations

Connections created by `createIndexedDB` close automatically on the native
`versionchange` event so another tab can upgrade or delete the database. Calling
`db.close()` has the same local effect: affected Collections enter `error` and
keep their last published rows. Recreate them with a new descriptor using the
current database version. There is no automatic restart or in-memory fallback.
Use the descriptor's `close()` method; calling its raw `db.db.close()` bypasses
managed Collection notification.

Closure prevents new native transactions. Transactions already admitted to
IndexedDB can still commit or abort. Their callers receive that actual outcome,
and successful writes finish their Collection confirmations. Accepted sync
transactions still publish when their optimistic transactions settle. These
publications, including a committed clear or import, do not make a Collection
on the closed connection ready again. An unfinished startup or notification read
cannot publish after closure.

Connections opened outside `createIndexedDB` can still block upgrades and
deletion. Their owner must close them. The administrative promise remains pending
until the native request succeeds or fails; it has no deadline or cancellation
option.

To delete the entire database, use the exported administrative function:

```typescript
import { deleteDatabase } from '@tanstack/indexeddb-db-collection'

await deleteDatabase('myApp')
```

Deletion targets a database **name at its turn in the native request queue**.
It is not bound to the lifetime of a previously opened descriptor. Its success
receipt does not clear retained Collection snapshots or send cross-tab row
notifications. Fresh descriptors and Collections restore the resulting storage.
Use `collection.utils.clearObjectStore()` to remove one store's rows while its
connection remains open and publish that replacement to active peers.

## Error Handling

Collection configuration uses these specific error classes:

```typescript
import {
  DatabaseRequiredError,
  ObjectStoreNotFoundError,
  NameRequiredError,
  GetKeyRequiredError,
} from '@tanstack/indexeddb-db-collection'
```

Low-level helpers reject with descriptive `Error` objects or native IndexedDB
errors. When a callback rejection settles `executeTransaction`, its original
rejection value is preserved. A native transaction abort can reject the
operation before a pending callback settles. Underlying errors are available
through `cause` on contextual wrapper errors; inspect that cause’s native `name`
(e.g. `VersionError` or `QuotaExceededError`).

## Automatic Write Ordering

Automatic writes in one Collection persist in mutation order. Handlers can run
concurrently, but a later write and its `isPersisted` promise wait for earlier
handlers and persistence to settle. A rejected handler writes nothing and lets
the next write proceed. A handler must not await a later automatic write in the
same Collection, because that write waits for the handler to finish.

This ordering does not span separate Collections or tabs. Manual acceptance,
import, and clear remain explicit operations; callers must order them when they
need an ordering relation with automatic writes.

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

Run the package test script for runtime tests, type assertions, coverage, and
both oracle campaigns against current workspace source. Run `pnpm test:package`
for the separate build and published-declaration checks. CI reuses its completed
build for those checks after runtime suites finish. Run the typecheck script to check all test-driver types
as well. The [oracle contract and audit](tests/ORACLE.md) describes the model,
replay coordinates, fault witnesses, and coverage limits.

### Cross-tab consistency tests

The package tests independently authored rows against durable storage, each
Collection, raw subscription events and downstream queries. Generated histories
exercise delayed notifications, held mutation handlers, replacements and cleanup.
The native browser suite runs same-origin pages in Chromium, Firefox and WebKit,
including transaction aborts, blocked deletion, connection version changes and
restore after page close. Run `pnpm test:oracles`, `pnpm test:oracles:stress`, or
`pnpm test:browser` from this package; browser tests require Playwright's engines.
See [the oracle contract](./tests/ORACLE.md) for replay commands and scope limits.
These tests cover stated histories and observation cuts; they do not prove crash
durability or guarantee delivery to a suspended tab.

## License

MIT
