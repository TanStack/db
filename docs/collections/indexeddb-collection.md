---
title: IndexedDB Collection
---

IndexedDB Collections persist local data across browser sessions. They restore stored rows when a Collection starts and notify other tabs through `BroadcastChannel` after writes complete.

Use this Collection for browser data that your app manages locally. For a persistent cache around an existing server sync adapter, see [SQLite Persistence](../guides/sqlite-persistence.md).

## Installation

Install the Collection package alongside your framework package or the core package:

```sh
npm install @tanstack/indexeddb-db-collection @tanstack/db
```

The examples use `@tanstack/db`. Framework packages such as `@tanstack/react-db` also export `createCollection` and `createTransaction`.

## Basic Usage

Open one database with the stores your app needs, then share that database instance between Collections. Each Collection uses one store.

```typescript
import { createCollection, createTransaction } from '@tanstack/db'
import {
  createIndexedDB,
  indexedDBCollectionOptions,
} from '@tanstack/indexeddb-db-collection'

type Todo = {
  id: string
  text: string
  completed: boolean
}

const db = await createIndexedDB({
  name: 'my-app',
  version: 1,
  stores: ['todos'],
})

const todos = createCollection(
  indexedDBCollectionOptions<Todo>({
    db,
    name: 'todos',
    getKey: (todo) => todo.id,
  }),
)

await todos.preload()
```

Create the database in browser code where IndexedDB is available. `preload()` restores the store's rows and resolves when the Collection is ready. A failed initial read rejects `preload()` and sets the Collection status to `error`.

The Collection loads the entire store into memory. Use it for data that fits in your app's memory budget.

## Direct Mutations

Call `insert`, `update`, and `delete` directly. Mutation handlers are optional. The Collection applies optimistic changes and persists accepted mutations to IndexedDB.

```typescript
const id = crypto.randomUUID()

const insert = todos.insert({
  id,
  text: 'Write a draft',
  completed: false,
})
await insert.isPersisted.promise

const update = todos.update(id, (draft) => {
  draft.completed = true
})
await update.isPersisted.promise

const remove = todos.delete(id)
await remove.isPersisted.promise
```

Await `isPersisted.promise` to observe persistence success or failure. The returned transaction itself is not a Promise.

If you provide `onInsert`, `onUpdate`, or `onDelete`, the handler runs before persistence. A rejected handler leaves durable rows unchanged and rolls back its optimistic changes. Each accepted Collection batch writes rows and metadata in one IndexedDB transaction. A failed write aborts the batch.

## Configuration

### Database Options

`createIndexedDB` accepts:

| Option       | Required | Description                                                             |
| ------------ | -------- | ----------------------------------------------------------------------- |
| `name`       | Yes      | IndexedDB database name.                                                |
| `version`    | Yes      | Database version. Increase it when adding stores.                       |
| `stores`     | Yes      | Store names to create during a version upgrade.                         |
| `idbFactory` | No       | Custom `IDBFactory`, such as a factory from `fake-indexeddb` for tests. |

Store creation is additive. Omitting an existing store from `stores` preserves that store and its data. The `_versions` store is reserved for adapter metadata.

### Collection Options

`indexedDBCollectionOptions` accepts:

| Option                             | Required | Description                                                                   |
| ---------------------------------- | -------- | ----------------------------------------------------------------------------- |
| `db`                               | Yes      | Instance returned by `createIndexedDB`.                                       |
| `name`                             | Yes      | An existing object store with out-of-line keys (`keyPath: null`).             |
| `getKey`                           | Yes      | Extracts a stable string or number key from each row.                         |
| `id`                               | No       | Collection identifier. Defaults to `indexeddb-collection:<database>:<store>`. |
| `schema`                           | No       | A Standard Schema compatible schema for mutation and import validation.       |
| `onInsert`, `onUpdate`, `onDelete` | No       | Application handlers that must succeed before the adapter persists mutations. |

Collection stores must use out-of-line keys (`keyPath: null`) because persistence passes the value returned by `getKey` as an explicit IndexedDB key. `createIndexedDB` creates stores this way. If you reuse an existing store, check its key mode first. The inline-key examples in the lower-level [`createObjectStore` reference](../reference/indexeddb-db-collection/functions/createObjectStore.md) are not compatible with Collection persistence.

Use values supported by IndexedDB's structured clone algorithm. Functions cannot be stored. Choose a consistent key type for each Collection.

## Schema Validation

A schema supplies the row type and can apply defaults or transformations. This example uses Zod, which requires the `zod` package:

```typescript
import { z } from 'zod'

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean().default(false),
})

const validatedTodos = createCollection(
  indexedDBCollectionOptions({
    db,
    name: 'todos',
    schema: todoSchema,
    getKey: (todo) => todo.id,
  }),
)

await validatedTodos.utils.importData([{ id: 'draft', text: 'Write a draft' }])
```

This example replaces the store with one row whose `completed` value is `false`. Use the schema configuration instead of the explicit `Todo` type parameter. See [Schemas](../guides/schemas.md) for more details.

## Manual Transactions

For a manual transaction, call `utils.acceptMutations` from its mutation function. The utility persists only mutations owned by the receiving Collection.

```typescript
const manual = createTransaction({
  autoCommit: false,
  mutationFn: async ({ transaction }) => {
    await todos.utils.acceptMutations(transaction)
  },
})

manual.mutate(() => {
  todos.insert({
    id: crypto.randomUUID(),
    text: 'Save this draft together with other edits',
    completed: false,
  })
})

await manual.commit()
```

For a transaction involving several Collections, call each Collection's acceptance utility. Separate acceptance calls do not form one atomic IndexedDB transaction across Collections.

Automatic writes in one Collection persist in mutation order, even when their
handlers finish out of order. Later writes wait for earlier handlers and
persistence to settle before reporting `isPersisted`. Rejection contributes no
durable write and allows the next mutation to proceed. Do not await a later
automatic write from an earlier handler in the same Collection: each would wait
for the other. This rule does not order separate Collections, manual acceptance,
imports, or clears; explicitly order those operations when your application
requires it.

## Utilities

The Collection exposes these methods through `collection.utils`:

| Method                         | Behavior                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exportData()`                 | Returns the durable rows as an array.                                                                                                                                   |
| `importData(rows)`             | Validates inputs and atomically replaces this store. Rejects duplicate keys. Failed validation or persistence preserves the previous rows.                              |
| `clearObjectStore()`           | Removes this store's durable rows and publishes an empty source snapshot. Other stores remain intact.                                                                   |
| `getDatabaseInfo()`            | Returns the database name, version, and actual object store names. `estimatedSize`, when available, is origin-wide storage usage, including other databases and caches. |
| `acceptMutations(transaction)` | Persists the receiving Collection's mutations from a manual transaction.                                                                                                |
| `deleteDatabase()`             | Closes the shared connection and deletes the entire database, including every store.                                                                                    |

For a Collection whose schema output is also valid schema input, export and restore a snapshot:

```typescript
const backup = await todos.utils.exportData()
await todos.utils.importData(backup)
```

`exportData()` returns stored schema output; `importData()` accepts and validates
schema input. A transforming schema may require an explicit conversion before
import. For example, a string-to-Date transform exports `Date` values, which must
be converted back to input strings. Arbitrary transforms have no general inverse;
`importData()` is not an unchecked stored-output restore API.

After database deletion succeeds, the originating Collection publishes an empty snapshot and notifies active Collections in every store. Create a new database instance and Collections before further persistence. A deletion notification affects only connections that observed or initiated that native deletion; it cannot clear a later database that reuses the name.

## Cross-Tab Synchronization

Tabs on the same origin use the same database and store names to access the same data. After persistence, the adapter sends a `BroadcastChannel` notification. Active receiving Collections read the changes from IndexedDB and update their public snapshots.

If `BroadcastChannel` is unavailable, local persistence still works, but active tabs do not receive change notifications. This adapter does not synchronize data to a server or define a conflict-resolution policy for simultaneous writes to the same key from different Collections or tabs.

## Connection Lifecycle and Blocked Operations

The app owns the shared database connection. Collection cleanup releases that Collection's sync resources. Close the database after every Collection that uses it finishes cleanup:

```typescript
await todos.cleanup()
db.close()
```

Connections created by `createIndexedDB` close automatically on the native `versionchange` event. This lets another tab upgrade or delete the database. Existing transactions can finish, but further persistence through the closed instance rejects. Reload the app or recreate affected Collections with a new instance using the current database version.

You can observe connection retirement with `db.db.addEventListener('versionchange', handler)`. The adapter closes the connection without automatically restarting its Collections. If a later notification causes a read through the closed connection, that Collection and its dependent live queries enter the error state; recreate them with the new instance.

Connections opened outside `createIndexedDB` can still block upgrades or deletion. Their owner must close them. The operation's promise remains pending until the native request succeeds or fails.

These operations have no deadline or cancellation option. A blocked operation does not switch the Collection to in-memory storage.

## Learn More

- [IndexedDB API Reference](../reference/indexeddb-db-collection/index.md)
- [LocalStorage Collection](./local-storage-collection.md)
- [LocalOnly Collection](./local-only-collection.md)
- [Mutations](../guides/mutations.md)
- [Live Queries](../guides/live-queries.md)
- [SQLite Persistence](../guides/sqlite-persistence.md)
