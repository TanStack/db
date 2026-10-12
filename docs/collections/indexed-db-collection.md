---
title: IndexedDB Collection
---

**Reactive local data that survives a reload.**

Build notes, drafts, reading lists, and offline workspaces with TanStack DB's live queries and optimistic mutations. IndexedDB Collections save your rows between visits and share persisted changes with other active tabs and dedicated workers.

- **Keep editing without a network connection.** Local reads and writes use the browser's built-in database, with no backend service required.
- **Keep the UI current.** Optimistic mutations update local state immediately. Live queries filter, sort, aggregate, and join your Collections as their data changes.
- **Keep data between sessions.** A new Collection restores saved rows from the same database and object store.
- **Share changes across tabs.** Active same-origin Collections receive persisted changes through `BroadcastChannel`.
- **Keep your data typed.** Use TypeScript and optional Standard Schema validation. IndexedDB stores supported structured values, including dates and binary data, without JSON serialization.

For example, a reading app can save articles and reading progress locally. A live query can show unread articles, while another joins articles with tags. Marking an article as read updates local query results immediately, persists the edit, and notifies other active tabs.

## When to Choose IndexedDB

Choose IndexedDB Collections when the browser owns the data and your app needs reactive queries over it. This works for a standalone local app or for local data alongside server-synced Collections.

| Your data needs                                                                  | Choose                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Temporary UI state that lasts only for the current session                       | [LocalOnly Collection](./local-only-collection.md)       |
| Small preferences stored through the Web Storage API                             | [LocalStorage Collection](./local-storage-collection.md) |
| Local records with asynchronous persistence, structured values, and live queries | IndexedDB Collection                                     |
| Persistence around an existing server sync adapter                               | [SQLite Persistence](../guides/sqlite-persistence.md)    |

IndexedDB Collections load their entire object store into memory. Choose a dataset that fits your app's memory budget. Local data access works offline once the app is loaded. Caching the app for offline startup and synchronizing data across devices require separate setup. Browser storage remains subject to quota, eviction, and user deletion.

## Installation

IndexedDB Collections are included in the core package:

```sh
npm install @tanstack/db
```

The examples use `@tanstack/db`. Framework packages such as `@tanstack/react-db` also export `createCollection` and `createTransaction`.

## Basic Usage

Open one database with the stores your app needs, then share that database instance between Collections. Each Collection uses one store.

```typescript
import {
  createCollection,
  createTransaction,
  createIndexedDB,
  indexedDBCollectionOptions,
} from '@tanstack/db'

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

Create the database in a browser page or dedicated worker where IndexedDB is available. `preload()` restores the store's rows and resolves when the Collection is ready. A failed initial read rejects `preload()` and sets the Collection status to `error`.

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

## Live Queries over Persisted Data

Use these Collections with TanStack DB's query API. This query keeps an alphabetized list of unfinished todos:

```typescript
import { createLiveQueryCollection, eq } from '@tanstack/db'

const unfinishedTodos = createLiveQueryCollection((q) =>
  q
    .from({ todo: todos })
    .where(({ todo }) => eq(todo.completed, false))
    .orderBy(({ todo }) => todo.text, 'asc')
    .select(({ todo }) => ({ id: todo.id, text: todo.text })),
)

await unfinishedTodos.preload()
console.log(unfinishedTodos.toArray)
```

An insert adds a matching todo to the result. Marking it complete removes it. Received changes from another active tab update the same query. TanStack DB's framework bindings can render these results in your UI.

The query runs over Collection rows in memory. IndexedDB handles persistence, while TanStack DB maintains the query result. You can also join these rows with other Collections, including Collections supplied by a server sync adapter. See [Live Queries](../guides/live-queries.md) for joins, aggregates, and framework examples.

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
| `id`                               | No       | Collection identifier. Defaults to `indexed-db-collection:<database>:<store>`. |
| `schema`                           | No       | A Standard Schema compatible schema for mutation and import validation.       |
| `onInsert`, `onUpdate`, `onDelete` | No       | Application handlers that must succeed before the adapter persists mutations. |

Collection stores must use out-of-line keys (`keyPath: null`) because persistence passes the value returned by `getKey` as an explicit IndexedDB key. `createIndexedDB` creates stores this way. If you reuse an existing store, check its key mode first. The inline-key examples in the lower-level [`createObjectStore` reference](../reference/functions/createObjectStore.md) are not compatible with Collection persistence.

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

To delete the entire database, use the exported administrative function:

```typescript
import { deleteDatabase } from '@tanstack/db'

await deleteDatabase('my-app')
```

This operation targets the database name at its turn in the native request queue.
It is not bound to a previously opened descriptor's database lifetime. Its success
receipt does not publish Collection rows or send row notifications. Retained
Collections stay errored with their snapshots; fresh Collections restore the
resulting storage. Use `clearObjectStore()` to publish a live replacement for one
store while the connection remains open.

`importData` copies the validated rows before it waits for storage. Later changes to caller-owned objects do not alter the imported snapshot.
Updates follow the core callback-return snapshot rules for supported values, including native buffers and views. Treat public Collection rows as immutable.

## Cross-Tab Synchronization

Pages and dedicated workers on the same origin use the same database and store names to access the same data. After persistence, the adapter sends a `BroadcastChannel` notification. Active receiving Collections read the changes from IndexedDB and update their public snapshots.

If `BroadcastChannel` is unavailable, local persistence still works, but active tabs do not receive change notifications. This adapter does not synchronize data to a server or define a conflict-resolution policy for simultaneous writes to the same key from different Collections or tabs.

## Connection Lifecycle and Blocked Operations

The app owns the shared database connection. Collection cleanup releases that Collection's sync resources. Close the database after every Collection that uses it finishes cleanup:

```typescript
await todos.cleanup()
db.close()
```

Connections created by `createIndexedDB` close automatically on native
`versionchange`. Unexpected native connection closure also notifies their managed Collections. In both cases, active Collections enter `error`.
The descriptor's `db.close()` method has the same local effect. Their last
published rows remain available. Recreate affected Collections with a new
instance using the current database version. Calling the raw `db.db.close()`
bypasses managed Collection notification.

Closure prevents new native transactions. Already admitted writes can commit or
abort; their callers receive that actual outcome. Committed writes finish their
Collection confirmations, including clear/import replacements. Sync transactions
accepted before closure still publish when their optimistic transactions settle.
These publications keep the Collection in `error`; late startup and notification
reads cannot publish or make it ready again. There is no automatic restart.

Connections opened outside `createIndexedDB` can still block upgrades or deletion. Their owner must close them. The operation's promise remains pending until the native request succeeds or fails.

Use `onBlocked` to report a native blocker without changing the request outcome:

```typescript
const db = await createIndexedDB({
  name: 'my-app',
  version: 2,
  stores: ['todos'],
  onBlocked: (event) => {
    console.info('Close older connections', event.oldVersion, event.newVersion)
  },
})

await deleteDatabase('my-app', undefined, (event) => {
  console.info('Deletion waits for open connections', event.oldVersion)
})
```

The low-level `openDatabase` function accepts the same callback as its fifth argument.
Native deletion reports `newVersion: null`. The callback does not cancel the operation or settle its promise.
Dedicated workers receive the same persistence and connection notifications while running. This does not promise service-worker background delivery or recovery after worker termination.

These operations have no deadline or cancellation option. A blocked operation does not switch the Collection to in-memory storage.

## Learn More

- [IndexedDB API Reference](../reference/functions/indexedDBCollectionOptions.md)
- [LocalStorage Collection](./local-storage-collection.md)
- [LocalOnly Collection](./local-only-collection.md)
- [Mutations](../guides/mutations.md)
- [Live Queries](../guides/live-queries.md)
- [SQLite Persistence](../guides/sqlite-persistence.md)
