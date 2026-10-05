---
title: SQLite Persistence
id: sqlite-persistence
---

SQLite persistence stores Collection rows in a SQLite database supplied by the runtime. A new Collection can load those rows when it uses the same database. The wrapper can also save sync metadata so a supported sync adapter can resume safely.

Choose a package for your runtime. Each runtime package supplies a SQLite driver and re-exports `persistedCollectionOptions` from `@tanstack/db-sqlite-persistence-core`.

SQLite persistence stores Collection data. To retain mutations that still need a server response, use [offline transactions](./offline-transactions.md). The [combined React Native recipe](./offline-transactions.md#use-sqlite-persistence-with-the-outbox) shows both stores together.

## Choose a runtime package

Each package connects through its runtime's database, storage, or IPC interface. Follow its README for setup and required native plugins.

| Runtime | Package and setup | Factory |
| --- | --- | --- |
| Browser with OPFS | [`@tanstack/browser-db-sqlite-persistence`](https://github.com/TanStack/db/tree/main/packages/browser-db-sqlite-persistence#readme) | `createBrowserWASQLitePersistence` |
| Node.js | [`@tanstack/node-db-sqlite-persistence`](https://github.com/TanStack/db/tree/main/packages/node-db-sqlite-persistence#readme) | `createNodeSQLitePersistence` |
| React Native with OP-SQLite | [`@tanstack/react-native-db-sqlite-persistence`](https://github.com/TanStack/db/tree/main/packages/react-native-db-sqlite-persistence#readme) | `createReactNativeSQLitePersistence` |
| Expo with `expo-sqlite` | [`@tanstack/expo-db-sqlite-persistence`](https://github.com/TanStack/db/tree/main/packages/expo-db-sqlite-persistence#readme) | `createExpoSQLitePersistence` |
| Capacitor | [`@tanstack/capacitor-db-sqlite-persistence`](https://github.com/TanStack/db/tree/main/packages/capacitor-db-sqlite-persistence#readme) | `createCapacitorSQLitePersistence` |
| Tauri | [`@tanstack/tauri-db-sqlite-persistence`](https://github.com/TanStack/db/tree/main/packages/tauri-db-sqlite-persistence#readme) | `createTauriSQLitePersistence` |
| Electron | [`@tanstack/electron-db-sqlite-persistence`](https://github.com/TanStack/db/tree/main/packages/electron-db-sqlite-persistence#readme) | `createElectronSQLitePersistence` in a renderer |
| Cloudflare Durable Objects (server) | [`@tanstack/cloudflare-durable-objects-db-sqlite-persistence`](https://github.com/TanStack/db/tree/main/packages/cloudflare-durable-objects-db-sqlite-persistence#readme) | `createCloudflareDOSQLitePersistence` |

The core package has no SQLite engine binding. Use a runtime package unless you are implementing a new driver.

## Start in the browser

Install the browser wrapper and its SQLite engine:

```sh
npm install @tanstack/db @tanstack/browser-db-sqlite-persistence @journeyapps/wa-sqlite
```

This example uses one browser tab. Open an OPFS database, then create one persistence instance for it. Give every persisted Collection a stable `id` and a `getKey` function. Set `schemaVersion` to track the stored row format. Increase it when that format changes.

```ts
import { createCollection } from '@tanstack/db'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '@tanstack/browser-db-sqlite-persistence'

type Todo = {
  id: string
  title: string
  completed: boolean
}

const database = await openBrowserWASQLiteOPFSDatabase({
  databaseName: 'app.sqlite',
})
const persistence = createBrowserWASQLitePersistence({ database })

const todos = createCollection(
  persistedCollectionOptions<Todo, string>({
    id: 'todos',
    getKey: (todo) => todo.id,
    persistence,
    schemaVersion: 1,
  }),
)

await todos.preload()
const transaction = todos.insert({
  id: '1',
  title: 'Buy milk',
  completed: false,
})
await transaction.when('settled')
```

This Collection has no `sync` option. Its normal insert, update, and delete handlers save local mutations to SQLite. It does not contact a server. The browser must support OPFS and run in a secure context. If multiple tabs can open the same database, use the [multi-tab setup](#browser-tabs-and-electron-renderers).

### Manual transactions on a local Collection

For a Collection without a `sync` option, normal Collection mutations persist automatically. A manual transaction must call `acceptMutations` in its mutation function:

```ts
import { createTransaction } from '@tanstack/db'

const manualTransaction = createTransaction({
  autoCommit: false,
  mutationFn: async ({ transaction }) => {
    await todos.utils.acceptMutations(transaction)
  },
})

manualTransaction.mutate(() => {
  todos.insert({ id: '2', title: 'Call home', completed: false })
})

await manualTransaction.commit()
```

### Load rows after reopening the database

Keep the database open while its Collections run. To simulate a page restart, clean up the Collection and close the database:

```ts
await todos.cleanup()
await database.close?.()
```

Open the same OPFS database and create a Collection with the same `id` and `schemaVersion`. Load its rows before you read them:

```ts
const reopenedDatabase = await openBrowserWASQLiteOPFSDatabase({
  databaseName: 'app.sqlite',
})
const reopenedPersistence = createBrowserWASQLitePersistence({
  database: reopenedDatabase,
})
const reopenedTodos = createCollection(
  persistedCollectionOptions<Todo, string>({
    id: 'todos',
    getKey: (todo) => todo.id,
    persistence: reopenedPersistence,
    schemaVersion: 1,
  }),
)

await reopenedTodos.preload()
console.log(reopenedTodos.get('1')?.title) // 'Buy milk'

await reopenedTodos.cleanup()
await reopenedDatabase.close?.()
```

## Temporal values

SQLite persistence preserves `Temporal.Instant` and `Temporal.PlainDate` as
native values, including nested fields, metadata and replay. Register the same
Temporal implementation globally before writing or reopening persisted data.
On a runtime without native Temporal, for example:

```ts
import 'temporal-polyfill/global'
```

Missing constructors and other Temporal kinds reject explicitly. Strings remain
strings. Equality retains the Temporal kind and canonical text, including a
PlainDate's calendar; ordering follows Temporal comparison. Supported native
predicates and persisted expression indexes use the existing SQL filtering and
in-memory cleanup pipeline without reducing nanosecond precision.

This support applies to the shared SQLite adapter and local persisted wrapper.
The remote-subset coordinator wire domain does not include Temporal literals;
those requests reject before remote retry admission. If retained local demand
becomes remote after an ownership change, recovery reports a collection error
before it can retry that invalid request. Multiprocess transport of
native Temporal rows is not covered by this support claim.

Values already stored as `{}` cannot be recovered. If an older version damaged
a synced cache, replace it through the existing `schemaVersion` and schema-reset
policy, then refetch. Updating the library does not automatically erase data.
Also rebuild an older cache if ordinary objects used the reserved
`__tanstack_db_persisted_type__` marker with a newly recognized type name. Older
writes did not escape those objects, so their original meaning is ambiguous.
New writes escape the marker and preserve the ordinary object.
Older library versions cannot interpret the new Temporal encoding.

## Add persistence to a synced Collection

Pass the options from a sync adapter into `persistedCollectionOptions`. The wrapper keeps that adapter's sync behavior and stores its applied data in SQLite.

For example, you can wrap a Query Collection. This separate example uses the imports and `Todo` type from the browser example above:

```ts
import { QueryClient } from '@tanstack/query-core'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const syncedDatabase = await openBrowserWASQLiteOPFSDatabase({
  databaseName: 'synced.sqlite',
})
const syncedPersistence = createBrowserWASQLitePersistence({
  database: syncedDatabase,
})
const queryClient = new QueryClient()

const syncedTodos = createCollection(
  persistedCollectionOptions<Todo, string>({
    ...queryCollectionOptions<Todo, string>({
      id: 'synced-todos',
      queryClient,
      queryKey: ['todos'],
      queryFn: async () => {
        const response = await fetch('http://localhost:3000/api/todos')
        if (!response.ok) throw new Error('Could not load todos')
        return (await response.json()) as Array<Todo>
      },
      getKey: (todo) => todo.id,
    }),
    persistence: syncedPersistence,
    schemaVersion: 1,
    initialRender: {
      strategy: 'network-first',
      networkTimeoutMs: 3_000,
    },
  }),
)
```

Install `@tanstack/query-core` and `@tanstack/query-db-collection` to use this example. Change the URL to your server. You can wrap another Collection sync adapter in the same way.

The `initialRender` option is optional. It lets live queries report when SQLite restore completes. It also lets React and Solid Suspense use restored rows for the first render while the Collection is not ready.

Keep `syncedDatabase` open while `syncedTodos` runs. During normal shutdown, await `syncedTodos.cleanup()` and then `syncedDatabase.close?.()`.

The `sync` option determines which mode the wrapper uses:

| Collection options | SQLite behavior |
| --- | --- |
| `sync` present | Load persisted rows, then apply source sync transactions. The source remains responsible for current data. |
| `sync` absent | Load and save local rows through a loopback sync adapter. The Collection has no remote source. |

The wrapper also supports `syncMode: 'on-demand'`. In that mode, it loads rows for active query demand rather than loading every stored row into the Collection.

## Render after SQLite restore

`initialRender` requires an eager persisted Collection. It does not support `syncMode: 'on-demand'`, which has no complete startup snapshot. Set it on every source Collection in a live query. If one source does not opt in, the query cannot report persisted readiness or use the restored snapshot as its initial-render fallback.

Install the React binding to use the following components:

```sh
npm install @tanstack/react-db
```

A regular React live query exposes both readiness signals:

```tsx
import { useLiveQuery } from '@tanstack/react-db'

function TodosView() {
  const result = useLiveQuery((q) => q.from({ syncedTodos }))
  const readiness = result.isReady
    ? 'Collection ready'
    : result.isPersistedReady
      ? 'SQLite restore complete. Collection readiness pending'
      : 'Waiting for Collection or SQLite restore'

  return (
    <>
      <p>{readiness}</p>
      <ul>{result.data.map((todo) => <li key={todo.id}>{todo.title}</li>)}</ul>
    </>
  )
}
```

`isReady` reports Collection readiness. `isPersistedReady` reports that every opted-in source finished its current eager restore, even when SQLite had no rows. These flags do not identify where each visible row came from. A regular `useLiveQuery` does not wait for the network-first deadline before it renders rows.

The hooks also expose `persistedStatus` and `persistedError`. The status is `unavailable` if a source did not opt in, `loading` during restore, `ready` after every restore completes, or `error` if a restore fails. `persistedError` keeps the restore error. An SSR seed does not count as a SQLite restore.

React, Solid, and Svelte read these values as properties. Angular reads signals such as `result.isPersistedReady()`. Vue reads refs such as `result.isPersistedReady.value`.

React and Solid Suspense can use the same option for network-first initial rendering. This React component uses the `syncedTodos` Collection configured above:

```tsx
import { Suspense } from 'react'
import { useLiveSuspenseQuery } from '@tanstack/react-db'

function TodosList() {
  const { data } = useLiveSuspenseQuery((q) => q.from({ syncedTodos }))
  return <ul>{data.map((todo) => <li key={todo.id}>{todo.title}</li>)}</ul>
}

function TodosScreen() {
  return (
    <Suspense fallback={<p>Loading todos...</p>}>
      <TodosList />
    </Suspense>
  )
}
```

Place `TodosScreen` inside an [Error Boundary](./error-handling.md#using-suspense-and-error-boundaries-react) to handle initial failures.

Suspense prefers Collection readiness. If it remains pending after `networkTimeoutMs`, a completed SQLite restore can release the first render. The default is 3 seconds. Set `networkTimeoutMs: 0` to allow fallback as soon as restore completes. For a query with multiple sources, the longest configured deadline applies. The deadline does not stop network sync.

A source failure can allow fallback before the deadline. React also waits for restore if its client query stream fails before the first render, including before the component mounts. Once every restore succeeds, React renders the derived query result, even if it is empty.

A derived-query failure still reaches the surrounding React Error Boundary. If the network-first wait rejects, its error reaches that boundary. A successful network load can render even if restore failed or a source did not opt in.

Persisted readiness does not prove current authorization. Isolate SQLite data by user or tenant. If an authorization failure must hide cached rows, block the view separately. The fallback does not classify source errors.

## Browser tabs and Electron renderers

The browser package uses single-tab coordination by default. If tabs share one OPFS database, give the persistence instance a `BrowserCollectionCoordinator`. It elects an owner for each Collection and routes writes between tabs. Replace the initial database and persistence setup with this code in each tab:

```ts
import { BrowserCollectionCoordinator } from '@tanstack/browser-db-sqlite-persistence'

const database = await openBrowserWASQLiteOPFSDatabase({
  databaseName: 'app.sqlite',
})
const coordinator = new BrowserCollectionCoordinator({ dbName: 'app' })
const persistence = createBrowserWASQLitePersistence({
  database,
  coordinator,
})
```

Pass this persistence instance to `persistedCollectionOptions`. During normal shutdown, clean up the Collections, dispose the coordinator, and close the database.

The Electron package uses a main-process SQLite owner and a renderer bridge. Add `ElectronCollectionCoordinator` when multiple renderers share the database.

These coordinators belong to SQLite persistence. The offline transaction executor has separate leader election for its outbox. Configure each system for the storage it owns.

The browser database uses a worker. Its OPFS setup needs a secure context and browser support for OPFS. Close the database during normal shutdown. After a page returns from the back/forward cache, create fresh database and Collection instances.

## Node.js alternative

For a Node.js process, install `@tanstack/node-db-sqlite-persistence` and `better-sqlite3` in place of the browser packages. Open a file with `better-sqlite3` and pass it to the Node factory:

```ts
import Database from 'better-sqlite3'
import {
  createNodeSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/node-db-sqlite-persistence'

const nodeDatabase = new Database('./app.sqlite')
const nodePersistence = createNodeSQLitePersistence({
  database: nodeDatabase,
})
```

Use `nodePersistence` in the Collection options shown above. Clean up each Collection before you call `nodeDatabase.close()`. The [Node package README](https://github.com/TanStack/db/tree/main/packages/node-db-sqlite-persistence#readme) has a complete example.

## Schema versions and recovery

By default, a synced Collection resets its persisted data after a schema mismatch. Its sync adapter must then load current data. A Collection without `sync` reports an error instead. It has no source that can restore deleted local rows.

All runtime factories listed above except the Electron renderer factory accept `schemaMismatchPolicy`. An explicit `reset` policy can delete local data, so use it only when your application can restore that data.

The Node package prunes its applied transaction log by default. Its [README](https://github.com/TanStack/db/tree/main/packages/node-db-sqlite-persistence#applied-transaction-pruning) lists the limits and options. If a resume position is older than the retained log, persistence loads a full snapshot.

## Errors and limits

An unavailable browser storage capability raises `PersistenceUnavailableError`. A durable write failure raises `PersistedCollectionDurabilityError` and puts the Collection in its error state.

If a coordinated write loses its response, the result can be uncertain. `IndeterminateCommitError` means the application must check the durable state before it retries that write.

Persistence retains source data and metadata. It does not define how an application sends local changes to a server. Use a mutation handler or the [offline transactions guide](./offline-transactions.md) for that work.
