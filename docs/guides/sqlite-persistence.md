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

Local persistence reserves the utility names `acceptMutations`,
`getLeadershipState`, and `forceReloadSubset`. If caller-supplied `utils`
contains one of these properties, `persistedCollectionOptions` throws
`InvalidPersistedCollectionConfigError` before it resolves persistence.
This also applies to inherited properties and properties whose value is
`undefined`. Other custom utility names remain available. Collections with a
`sync` option retain their adapter utilities without this local-only restriction.

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
becomes remote after an ownership change, fallback sequence-gap recovery fails
the current Collection sync run before retrying that invalid request. This is a
terminal Collection error: later active subsets are not recovered, subsequent
loads reject with the same error, and later coordinator messages do not resume
the failed run. Existing acquisitions can still be released. Multiprocess
transport of native Temporal rows is not covered by this support claim.

Values already stored as `{}` cannot be recovered. If an older version damaged
a synced cache, replace it through the existing `schemaVersion` and schema-reset
policy, then refetch. Updating the library does not automatically erase data.
Also rebuild an older cache if ordinary objects used the reserved
`__tanstack_db_persisted_type__` marker with a newly recognized type name. Older
writes did not escape those objects, so their original meaning is ambiguous.
New writes escape the marker and preserve the ordinary object.
Older library versions cannot interpret the new Temporal encoding. Changed
expression indexes rebuild when first ensured after upgrade. Later startups reuse
those indexes. A changed native-literal or escaped-record signature can leave an
obsolete registry entry and index until an explicit schema reset; this release
does not reclaim those entries automatically. Increment the affected synced
Collection's `schemaVersion` and retain its reset policy to rebuild that cache.
The reset removes its old values and indexes before reading the new schema;
other Collections with unchanged schema versions retain their caches. Refetch
from the upstream source after reset.

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

The `initialRender` option is optional. It lets the Collection become ready from restored SQLite rows when the network is slow or unavailable. See [Render after SQLite restore](#render-after-sqlite-restore).

Keep `syncedDatabase` open while `syncedTodos` runs. During normal shutdown, await `syncedTodos.cleanup()` and then `syncedDatabase.close?.()`.

The `sync` option determines which mode the wrapper uses:

| Collection options | SQLite behavior |
| --- | --- |
| `sync` present | Load persisted rows, then apply source sync transactions. The source remains responsible for current data. |
| `sync` absent | Load and save local rows through a loopback sync adapter. The Collection has no remote source. |

The wrapper also supports `syncMode: 'on-demand'`. In that mode, it loads rows for active query demand rather than loading every stored row into the Collection. When no query needs rows, a peer reload or schema reset checks rows already visible in the Collection but does not add unrelated stored rows.

Built-in SQLite adapters use managed generations for on-demand caches. If a cache claim expires, the wrapper retires the old source callbacks, cleans up that source session, rotates the cache, and calls a custom source's `sync` function again. A custom source does not need a restart hook. Query and Electric provide `restartAfterScopedRecovery` to control their own restart; their hooks must retire old callbacks immediately and start replacement loads after `cacheRotated` resolves.

An on-demand cache is not yet a certified offline snapshot. The first managed generation does not import legacy cache tables, and a private replacement created after claim expiry is not the next run's shared cache. A later launch must refetch those subsets from the source.

## Render after SQLite restore

Without `initialRender`, a persisted Collection becomes `ready` when its sync adapter calls `markReady()`, like any other Collection. The restored rows are in the Collection while it loads, but `status` stays `loading`. Eager and on-demand Collections both support `initialRender`; [on-demand Collections](#on-demand-collections-offline) apply it to each query demand.

With `initialRender: { strategy: 'network-first', networkTimeoutMs }`, the Collection prefers the network for `networkTimeoutMs` (default 3 seconds). It becomes `ready` from the restored rows when both of these are true:

- the SQLite restore completed and installed at least one row, and
- the deadline passed, or the sync adapter failed its first load.

To render cached rows as soon as the restore completes, set `networkTimeoutMs: 0`. Use this when a fast first render is more important than fresh data:

```ts
initialRender: { strategy: 'network-first', networkTimeoutMs: 0 },
```

A Collection with restored rows then becomes `ready` from them immediately. Network sync continues, and its changes apply over the restored rows when they arrive. An empty restore still waits for the network, so the Collection never shows an empty list that the network did not confirm. An on-demand Collection applies this to each query demand, as [On-demand Collections offline](#on-demand-collections-offline) describes.

The status is the only signal. Every hook, Suspense, and `preload()` follow it, so you do not need a separate persisted flag:

```tsx
import { useLiveQuery } from '@tanstack/react-db'

function TodosView() {
  const { data, isLoading, isLoadingError, isSyncError } = useLiveQuery((q) =>
    q.from({ syncedTodos }),
  )
  if (isLoading) return <p>Loading todos...</p>
  if (isLoadingError) return <p>Could not load todos.</p>
  return (
    <>
      {isSyncError && <p>Showing saved todos. Sync is having trouble.</p>}
      <ul>{data.map((todo: Todo) => <li key={todo.id}>{todo.title}</li>)}</ul>
    </>
  )
}
```

These rules keep `ready` meaningful:

- **An empty restore waits for the network.** The Collection stays `loading` until the sync adapter answers, so an empty list always means "no rows". A Collection that last synced to zero rows also waits, because the restore cannot tell the two cases apart.
- **The restore comes first.** If the sync adapter answers before the restore completes, the answer waits for the restore. A remote failure then opens the Collection from restored rows and shows the failure as a sync error (`isSyncError`, `collection.health.error`). Without restored rows, the first load fails (`status: 'error'`).
- **A failed restore is a crash.** The Collection becomes `crashed`, because local storage cannot serve reads.
- **The deadline does not stop network sync.** Network changes apply over the restored rows when they arrive.

These rules apply to an eager Collection. An on-demand Collection applies `initialRender` to each query demand. See [On-demand Collections offline](#on-demand-collections-offline).

Suspense uses the same status. This React component uses the `syncedTodos` Collection configured above:

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

Place `TodosScreen` inside an [Error Boundary](./error-handling.md#using-suspense-and-error-boundaries-react) to handle a failed first load or a crash.

Restored rows do not prove current authorization. Isolate SQLite data by user or tenant. If an authorization failure must hide cached rows, block the view separately: a remote failure can open the Collection from restored rows.

### On-demand Collections offline

An on-demand Collection loads rows for each query demand: the filter, order, and limit that a query asks the source for. With `initialRender`, a demand can settle on its rows from SQLite when the network does not answer. This includes Electric's `syncMode: 'progressive'`, which loads query subsets on demand until its full sync completes.

```ts
type Issue = { id: string; title: string }

const issues = createCollection(
  persistedCollectionOptions({
    ...electricCollectionOptions<Issue>({
      id: 'issues',
      shapeOptions: { url: 'http://localhost:3000/v1/shape', params: { table: 'issues' } },
      syncMode: 'progressive',
      getKey: (issue) => issue.id,
    }),
    persistence: syncedPersistence,
    initialRender: { strategy: 'network-first', networkTimeoutMs: 3_000 },
  }),
)
```

The rule applies to each demand separately:

- A demand is covered after a load of that exact demand settles online and its rows are saved in SQLite. Another filter, order, or limit is a different demand, even when its rows overlap.
- A later load of a covered demand first shows its rows from SQLite. If the network does not answer within `networkTimeoutMs`, or it fails, the load settles on those rows. `isReady`, `preload()`, and Suspense then proceed as they do after a network load. Only the load settles from SQLite; the on-demand Collection's own status does not change.
- The network load keeps running. Its rows replace the restored rows when they arrive. If it fails after the load settled, the query stays ready on the rows it shows.
- A demand that never settled online is not covered. Offline, it waits for the network. A query that has never run therefore stays loading offline unless a completed progressive full sync already holds every row.
- A source truncate, such as an Electric must-refetch, ends coverage for every demand, and so does a snapshot transaction (`begin({ snapshot: true })`), which replaces every row. A new cache generation starts without coverage.
- Scoped recovery also ends coverage. For the rest of that sync run, no load settles from SQLite and no load records coverage.
- A load that is released before it settles records no coverage, even if its source finishes it afterward.
- Coverage also ends when SQLite holds fewer rows for the demand than it held when the demand settled. A row that the source deletes, or that Query DB retention removes after `gcTime`, therefore ends coverage until the demand loads online again, unless another row of the demand reached SQLite meanwhile, for example through another query. Coverage counts the rows of an unordered demand; it does not record which rows they were.
- An ordered window with a `limit` stays covered only while SQLite holds the same rows for it, in any order. A row that leaves, joins, or replaces a row of the window ends its coverage.
- A load with `refetch: true` always waits for the network.
- Only the default single-process coordinator supports this. If you pass a multi-tab coordinator, such as `BrowserCollectionCoordinator`, on-demand loads do not settle from SQLite. They wait for the network, as they did before this option.

Coverage proves that the rows were complete when the earlier load settled. It does not prove that they are current. The wait changes when readiness arrives, not which rows the source has. A cursor page or a demand built from other rows' values is covered only if the restored rows produce the same demand again.

For a query that joins eager and on-demand sources, the query becomes ready when every eager source is ready, which network-first allows from its restored rows after the deadline, and every demand that the query reaches on an on-demand source has settled. A network failure alone does not settle an on-demand demand that is not covered.

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

An unavailable browser storage capability raises `PersistenceUnavailableError`. A durable write failure raises `PersistedCollectionDurabilityError` and crashes the Collection: it moves to `crashed` even after it was ready, and so does every live query and Effect over it. `reload()` rejects; recover with `cleanup({ dependents: true })` and `preload()` (see [When a Collection crashes](./error-handling.md#when-a-collection-crashes)).

Failures from the wrapped sync adapter keep their usual meaning. Before the Collection is ready, the adapter's `fail` fails the first load (see [Render after SQLite restore](#render-after-sqlite-restore) for `initialRender`). After it, the adapter's `reportError`, `reportHealthy`, and `fail` appear in `collection.health` and in each live query's `health` tree, and the persisted rows stay. A failure of persistence itself crashes the Collection. In a follower tab, a failed request routed to the leader appears as a request error on the query that asked for the data.

If a coordinated write loses its response, the result can be uncertain. `IndeterminateCommitError` means the application must check the durable state before it retries that write.

Persistence retains source data and metadata. It does not define how an application sends local changes to a server. Use a mutation handler or the [offline transactions guide](./offline-transactions.md) for that work.
