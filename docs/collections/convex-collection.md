---
title: Convex Collection
---

`@tanstack/convex-db-collection` subscribes to a Convex query and keeps its rows in a TanStack DB collection. Use DB for local filters, joins, and optimistic writes. Convex still runs your server functions and handles authentication, reconnects, and access control.

## Install

```sh
npm install @tanstack/convex-db-collection @tanstack/db convex
```

## Subscribe to a query

Use a public Convex query that returns an array of documents. The adapter infers document and argument types from your generated function reference.

```ts
import { createCollection } from '@tanstack/db'
import { convexCollectionOptions } from '@tanstack/convex-db-collection'
import { ConvexClient } from 'convex/browser'
import { api } from './convex/_generated/api'

const client = new ConvexClient(import.meta.env.VITE_CONVEX_URL)

export const tasks = createCollection(
  convexCollectionOptions({
    id: 'tasks',
    client,
    query: api.tasks.list,
    queryArgs: { projectId },
    getKey: (task) => task._id,
  }),
)

await tasks.preload()
```

An existing `ConvexReactClient`, including the client from `useConvex()`, also works. The adapter imports neither React nor the Convex runtime. Keep the client and collection stable across renders.

Create fresh adapter options for each direct `createCollection` call. Reusing the same options, including a shallow copy, throws. A `collectionOptions` descriptor can still materialize independent collections in separate `DbClient` instances.

Each result replaces the subscribed query's rows. Missing documents are deleted, and missing fields are removed. An empty array is a ready, empty collection. Keys must be unique strings or finite numbers. Duplicate keys reject the complete result and preserve the last valid snapshot.

`convexCollectionOptions` uses eager sync. DB filters, ordering, and limits apply locally to the subscribed result. They do not change your Convex query or fetch documents outside its result. To change the query arguments, create a new collection with a distinct ID.

## Write through Convex mutations

Supply handlers for the operations your application supports. Await mutations on the same client used for the subscription.

```ts
const tasks = createCollection(
  convexCollectionOptions({
    id: 'tasks',
    client,
    query: api.tasks.list,
    queryArgs: { projectId },
    getKey: (task) => task._id,
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(({ original, changes }) =>
          client.mutation(api.tasks.update, {
            id: original._id,
            ...changes,
          }),
        ),
      )
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(({ original }) =>
          client.mutation(api.tasks.remove, { id: original._id }),
        ),
      )
    },
  }),
)

const transaction = tasks.update(taskId, (task) => {
  task.completed = true
})
await transaction.isPersisted.promise
```

DB applies optimistic writes immediately. Successful Convex mutation promises wait for the client's queries to catch up. Before a handler settles, the adapter reads the latest cached result and waits for DB to accept its sync writes. It does not wait for visibility held by that same optimistic transaction. If a wrapping persistence layer rejects source acceptance, that sync run stays failed. Call `collection.cleanup()`, then `collection.preload()`, before retrying replay. A provider query error can recover when a later valid result arrives. A rejected handler rolls back its optimistic writes.

Awaiting an HTTP mutation, an action, a different client's mutation, or a detached promise does not provide this query synchronization guarantee. Avoid applying Convex optimistic updates to the same query, because the adapter would receive those local results as source data.

A DB transaction does not make several Convex calls atomic. For atomic batches, send the complete batch through one Convex mutation. That mutation defines argument validation, authorization, and server write behavior.

### Inserts and generated IDs

Convex assigns `_id` on the server. DB needs a stable key before an optimistic insert. For optimistic inserts, add an application key such as `clientId` to your schema and documents. Use that key in `getKey` and send it through your insert mutation. Use `select` to omit server-only fields from the local row type.

```ts
select: (tasks) => tasks.map((task) => ({
  clientId: task.clientId,
  projectId: task.projectId,
  title: task.title,
})),
getKey: (task) => task.clientId,
onInsert: async ({ transaction }) => {
  await Promise.all(
    transaction.mutations.map(({ modified }) =>
      client.mutation(api.tasks.create, {
        clientId: modified.clientId,
        projectId: modified.projectId,
        title: modified.title,
      }),
    ),
  )
},
```

Insert a local row with `tasks.insert({ clientId: crypto.randomUUID(), projectId, title })`. The server query must return the same `clientId`.

Alternatively, call `client.mutation(api.tasks.create, args)` directly. The subscription adds the resulting document with its server ID. The adapter does not invent Convex IDs or silently replace temporary keys.

## Project query results

For an envelope or a nullable document, supply `select`. Its output is the complete set of rows for that collection.

```ts
convexCollectionOptions({
  client,
  query: api.tasks.listWithMetadata,
  queryArgs: { projectId },
  select: (result) => result.tasks,
  getKey: (task) => task._id,
})

convexCollectionOptions({
  client,
  query: api.tasks.get,
  queryArgs: { id: taskId },
  select: (task) => (task === null ? [] : [task]),
  getKey: (task) => task._id,
})
```

Keep projections synchronous and treat query results as immutable. A projection can change the row shape. A standard schema can validate local writes through the collection's `schema` option.

## Complete eager pagination

Use `convexPaginatedCollectionOptions` for a complete eager mirror of a finite query that returns Convex's `PaginationResult`. The adapter supplies `paginationOpts`, loads every page automatically, and keeps the full result and its page subscriptions in memory. `preload()` waits for the whole result. Set a server-side scope such as a project or workspace before using it with a large table.

```ts
import { convexPaginatedCollectionOptions } from '@tanstack/convex-db-collection'

const tasks = createCollection(
  convexPaginatedCollectionOptions({
    id: 'project-tasks',
    client,
    query: api.tasks.paginated,
    queryArgs: { projectId },
    pageSize: 100,
    maxRows: 5_000,
    getKey: (task) => task._id,
  }),
)

await tasks.preload()
```

Your server query must pass `paginationOpts` through to the same ordered Convex database query on every call. Use Convex's `paginationOptsValidator` for argument validation.

The adapter keeps each loaded cursor range subscribed. Fixed `endCursor` boundaries prevent gaps when rows move or are deleted. Convex split hints replace a range with two subscriptions. The adapter publishes a replacement only after every range is available and the final page reports exhaustion. `preload()` waits for this complete initial result. During later page acquisition, the last complete snapshot stays visible.

`pageSize` defaults to 100 and must be a positive safe integer. It sets the initial request size. Reactive ranges can contain more rows after inserts. Both supported clients use their public query subscription APIs, without experimental pagination methods.

`maxRows` defaults to 10,000 and must be a positive safe integer. It caps the accepted complete result. An oversized result rejects with `RangeError` before the adapter publishes it or continues past a known oversized prefix. Initial `preload()` rejects; later growth preserves the last accepted snapshot and reports the error through `onError` and `getSyncError()`. Raise the finite cap only for a source size your application can hold.

The cap does not limit the bytes in a server response or guarantee peak memory use. A single reactive page can already exceed it. `pageSize` does not bound total memory or initial load time. Initial acquisition can inspect earlier cached pages repeatedly as it extends the cursor chain.

In eager mode, `select` receives the complete row array. DB applies local filters, joins, ordering, and limits to that mirror.

## Lazy pagination for a fixed query

Set `syncMode: 'on-demand'` on the same paginated factory to acquire pages as an ordered DB query needs them. Declare the server query's leading numeric order with `queryOrder`. The server function must always paginate that same query in that direction.

```ts
const tasks = createCollection(
  convexPaginatedCollectionOptions({
    client,
    query: api.tasks.paginatedByRank,
    queryArgs: { projectId },
    syncMode: 'on-demand',
    queryOrder: { field: 'rank', direction: 'asc' },
    autoIndex: 'eager',
    defaultIndexType: BTreeIndex,
    pageSize: 100,
    getKey: (task) => task._id,
  }),
)

const window = createLiveQueryCollection((q) =>
  q.from({ task: tasks })
    .orderBy(({ task }) => task.rank)
    .orderBy(({ task }) => task._id)
    .select(({ task }) => task)
    .limit(25),
)
await window.preload()
await window.utils.setWindow({ offset: 25, limit: 25 })
```

Import `createLiveQueryCollection` and `BTreeIndex` from `@tanstack/db`. The leading DB order must match `queryOrder`; trailing order terms run locally. Each load acquires a contiguous prefix with every row tied at its leading boundary. This may load more rows than the displayed window. Offset windows acquire the preceding prefix too. An unlimited source request, including `tasks.preload()`, loads the whole query. With no demand or a zero limit, no page is started.

The initial profile supports finite numeric leading fields, aligned ordered windows, core boundary-tie requests, and forward continuations. It rejects other source filters and differently ordered requests. Put application filters in the fixed server query's arguments. `select` on the collection options is unavailable in on-demand mode; use DB query projections as shown above. This API does not translate general DB queries into Convex functions.

Loaded ranges stay subscribed until collection cleanup. Later inserts, deletes, moves, splits, and reconnects repair the active windows. While more coverage is pending, a public live query retains its last complete window. A successful subset load waits for its accepted writes to become visible, including when optimistic writes hold them. `utils.awaitSync()` waits for source acceptance and remains safe inside mutation handlers.

`maxRows` also caps the retained lazy prefix. It does not bound requests, network bytes, scans, or peak memory. A boundary tie or a whole-source request can still require the complete query. Use server-side scoping and a suitable finite cap for your application.

## Durable offline writes

Use the existing durable outbox with the Convex bridge:

```sh
npm install @tanstack/offline-transactions
```

Start from a stable Collection that uses an application key such as `clientId`. Keep its ID, registry key, and named mutation function stable across reloads.

```ts
import { IndexedDBAdapter, startOfflineExecutor } from '@tanstack/offline-transactions'
import { convexMutationCodec, convexOfflineMutation } from '@tanstack/convex-db-collection/offline'

type Task = { clientId: string; title: string; completed: boolean }

const executor = startOfflineExecutor({
  mutationCodec: convexMutationCodec,
  collections: { tasks },
  storage: new IndexedDBAdapter('project-task-outbox'),
  mutationFns: {
    saveTask: convexOfflineMutation({
      client,
      mutation: api.tasks.saveIdempotently,
      collections: [tasks],
      getArgs: ({ transaction }) => {
        const task = transaction.mutations[0].modified as Task
        return { clientId: task.clientId, title: task.title, completed: task.completed }
      },
    }),
  },
})

await executor.waitForInit()

const addTask = executor.createOfflineAction<Task>({
  mutationFnName: 'saveTask',
  onMutate: (task) => { tasks.insert(task) },
})

const transaction = addTask({
  clientId: crypto.randomUUID(),
  title: 'Works after a reload',
  completed: false,
})

void transaction.when('settled').catch(reportError)
```

Use the offline action to create durable writes. Calling `tasks.insert()` directly uses its normal handler and does not enter the durable outbox. The example's `tasks` Collection must project the same `Task` shape and use `clientId` as its key.

The opt-in codec preserves Convex BigInt, binary data, special floats, and undefined fields in mutation changes. Keep the same codec configured across reloads. Missing or incompatible codecs stop replay and retain the stored work. Transaction metadata keeps the outbox’s existing JSON/Date/Temporal behavior.

The outbox records the transaction before sending it. After a reload, the executor restores pending optimistic writes and replays their named mutation functions. The bridge supplies the original `idempotencyKey`, waits for the Convex mutation, then waits for each configured Collection to accept its source snapshot. It does not wait for visibility held by that same optimistic transaction. If a wrapping persistence layer rejects source acceptance, that sync run stays failed. Call `collection.cleanup()`, then `collection.preload()`, before retrying replay. A provider query error can recover when a later valid result arrives.

Convex handles WebSocket interruptions without rejecting the mutation promise. Argument-construction errors and rejected mutation calls are terminal failures. The bridge turns them into `NonRetriableError`, so the executor rolls back instead of retrying invalid writes indefinitely. A later source-sync failure can retry with the original key.

### Deduplicate on the server

Your Convex mutation must accept `idempotencyKey: v.string()`. In that same mutation transaction:

1. Look up the key in an indexed receipts table.
2. If a receipt exists, return its saved result.
3. Apply the complete write or batch.
4. Store the key and result in the receipts table.

Convex executes these writes atomically. A client can lose an acknowledgement after the server commits, so SDK request deduplication alone cannot replace this durable receipt. Keep receipts for at least the full replay lifetime. Scope receipt keys to the authenticated owner, and apply authorization before returning a saved result.

The [real backend test fixture](https://github.com/TanStack/db/blob/main/packages/convex-db-collection/e2e/backend/convex/tasks.ts) shows an idempotent write mutation. It is an isolated test backend without application authorization, so add your own access checks.

For atomic batches, `getArgs` must include every operation in the offline transaction and your server mutation must apply them together. The example handles one insert per action. Supply the platform's storage and coordination adapters when using the executor outside a browser. See the [offline transactions guide](../guides/offline-transactions.md) for leadership, storage failures, retry policy, and disposal.

The outbox stores pending writes, not a full offline read cache. Pair the Collection with DB's persistence support when it must show previously synced rows after a reload without network access.

## Errors and cleanup

```ts
convexCollectionOptions({
  client,
  query: api.tasks.list,
  queryArgs: { projectId },
  getKey: (task) => task._id,
  onError: (error) => reportError(error),
})
```

An initial subscription error rejects `preload()` with the original error. Later errors preserve existing rows and call `onError`. `collection.utils.getSyncError()` returns the latest error. This getter is not reactive. A valid query result clears provider or projection errors and allows initial sync to recover.

Collection cleanup unsubscribes and invalidates callbacks from that sync run. It does not close the shared Convex client. After a restart, the first result replaces retained data, including when the result is empty. Close the client separately when your application no longer needs it.

## Scope

This adapter uses the supported `onUpdate` and `watchQuery` APIs, tested with Convex 1.47.0 and a real isolated local Convex backend. It does not access private client fields or implement a second Convex protocol.

Convex only exposes data through your server functions. The adapter cannot bypass authorization, subscribe directly to an arbitrary table, or translate arbitrary DB predicates into Convex functions. Queries remain subject to Convex read and result limits. A paginated query result describes one page, not a complete table. Automatic reactive pagination uses `convexPaginatedCollectionOptions`. Arbitrary server predicate pushdown is not implemented.

Convex manages connection recovery. Use the offline bridge for durable writes. A full read cache and an SSR snapshot fetch remain separate concerns. Reuse your existing Convex authentication setup. For SSR, use request-scoped `DbClient` instances and the DB hydration APIs. A module-scoped descriptor can wrap `convexCollectionOptions` with `collectionOptions`; each client receives fresh adapter state. Supply an appropriate Convex client for each request and close it when finished.

## Run the backend tests

```sh
pnpm --filter @tanstack/convex-db-collection... build
pnpm --filter @tanstack/convex-db-collection test:e2e
```

The test command starts an anonymous local Convex backend, deploys the fixture, runs both client integrations and generated process-crash histories, then stops the backend. It needs network access on the first run to download Convex's backend binary. It does not use your cloud deployment or deploy key.
