---
title: Migrating to the 1.0 RC
id: migrate-to-1-0-rc
---

This guide covers the API changes in `1.0.0-rc.1` and the changes shipped since
`@tanstack/db@0.9.2` in September 2026 that may require changes to an app. It
includes changes merged through October 27, 2026. For the earlier `DbClient`
and SSR migration, see the
[SSR and Hydration guide](./ssr.md#migration-guide).

## Update your packages

Update the pre-1.0 TanStack DB packages your app uses together. Once the RC is
published, install them from npm's `rc` tag. For example:

```sh
npm install @tanstack/react-db@rc @tanstack/electric-db-collection@rc
```

The first candidate is `1.0.0-rc.1`. `@tanstack/query-db-collection` and
`@tanstack/offline-transactions` were both accidentally released as 1.0 before
the RC. Keep them on 1.x and update to their latest 1.x releases. These
releases use the app's `@tanstack/db` as a peer dependency, so the RC and stable
packages share one DB instance.

## Replace `$synced` with `$hasPendingWrites`

The deprecated `$synced` virtual row property has been removed. Its replacement
has the opposite boolean meaning:

| Before | After |
| --- | --- |
| `row.$synced` | `!row.$hasPendingWrites` |
| `!row.$synced` | `row.$hasPendingWrites` |
| `eq(row.$synced, true)` | `eq(row.$hasPendingWrites, false)` |
| `eq(row.$synced, false)` | `eq(row.$hasPendingWrites, true)` |

`$hasPendingWrites` reports whether a pending local optimistic mutation affects
the row. A `false` value does not, by itself, prove that the server confirmed
the write. See [Virtual properties](./live-queries.md#virtual-properties) for
the other row metadata fields.

If you create virtual rows yourself, include `$hasPendingWrites`:
`hasVirtualProps(row)` now requires it.

### Keep virtual field names for row metadata

The fields `$hasPendingWrites`, `$origin`, `$key`, and `$collectionId` are
reserved on published Collection rows. A selected field with one of those names
cannot author conflicting metadata at a live-query row root. Whole-row outputs,
including a selected joined row, retain that source row's metadata. Ordinary
projections without selected virtual fields receive the live-query Collection's
metadata. Rename application data fields that collide with these names before
selecting them as row roots.

## Wait for transaction settlement

Replace `transaction.isPersisted.promise` with `transaction.when('settled')`:

```ts
const transaction = todoCollection.update(todoId, (draft) => {
  draft.completed = true
})

// Before: await transaction.isPersisted.promise
await transaction.when('settled')
```

`when('settled')` resolves with the transaction after its mutation handler
completes successfully and rejects when the transaction fails or rolls back.
Transaction settlement confirms a backend write only if the handler waits for
that confirmation before returning. See the [Mutation Lifecycle](./mutations.md#mutation-lifecycle)
for the full boundary.

## Await synchronization inside mutation handlers

The pre-1.0 Collection adapters no longer use values returned by
`onInsert`, `onUpdate`, or `onDelete` to coordinate synchronization. Their
handlers now return `Promise<void>`. Await the work that must finish before
the transaction settles:

```ts
onUpdate: async ({ transaction }) => {
  await api.todos.update(transaction.mutations[0].changes)
  // Await any required backend confirmation or read-back here.
}
```

For Electric Collection, replace a returned `{ txid }` matching strategy with
`collection.utils.awaitTxId(txid)` inside the handler:

```ts
// Before
onUpdate: async ({ transaction }) => {
  const { txid } = await api.todos.update(transaction.mutations[0].changes)
  return { txid, timeout: 10_000 }
}

// After
onUpdate: async ({ transaction, collection }) => {
  const { txid } = await api.todos.update(transaction.mutations[0].changes)
  await collection.utils.awaitTxId(txid, 10_000)
}
```

For several transaction IDs, await all of them with `Promise.all`. The
[Electric Collection guide](../collections/electric-collection.md#persistence-handlers--synchronization)
also covers custom matching when your API cannot return transaction IDs.

### Query Collection handlers no longer refetch

The accompanying Query Collection 1.x minor release removes automatic refetch
from `onInsert`, `onUpdate`, and `onDelete`. Refresh explicitly inside each
handler:

```ts
// Before: returning triggered an automatic refetch.
onUpdate: async ({ transaction }) => {
  await api.todos.update(transaction.mutations[0].changes)
}

// After
onUpdate: async ({ transaction, collection }) => {
  await api.todos.update(transaction.mutations[0].changes)
  await collection.utils.refetch()
}
```

Alternatively, await a `writeInsert`, `writeUpdate`, `writeUpsert`, or
`writeDelete` call with the confirmed server result. These utilities do not
fetch. If the handler neither refreshes nor writes confirmed data, its
optimistic changes revert to the previous synced rows when the transaction
settles, even if the server accepted the mutation.

Handlers now return `Promise<void>`. Remove `{ refetch: false }`; it is no
longer supported. A handler that already explicitly refetches or writes its
server response needs only to remove that return value. See
[Controlling Refetch Behavior](../collections/query-collection.md#controlling-refetch-behavior).

For TypeScript code that uses the handler type aliases directly,
`InsertMutationFn`, `UpdateMutationFn`, and `DeleteMutationFn` no longer take a
return-value type parameter. `BaseCollectionConfig` no longer takes its old
`TReturn` type parameter. The Electric `MatchingStrategy` type was removed with
the returned matching strategy.

## Opt in to includes, grouping, and pooling

These operators now need an explicit import so apps bundle only the operators
they use.

### Wrap nested selections in `include()`

A child query returned directly from `.select()` now throws
`IncludeOperatorRequiredError`. Wrap it in `include()` to keep a live child
Collection:

```ts
import { eq, include } from '@tanstack/db'

// Before
q.from({ project: projectsCollection }).select(({ project }) => ({
  issues: q.from({ issue: issuesCollection })
    .where(({ issue }) => eq(issue.projectId, project.id)),
}))

// After
q.from({ project: projectsCollection }).select(({ project }) => ({
  issues: include(
    q.from({ issue: issuesCollection })
      .where(({ issue }) => eq(issue.projectId, project.id)),
  ),
}))
```

Existing `toArray()` and `materialize()` wrappers already opt in; they need no
additional `include()`. Apply the wrapper at every nested selection. See
[Includes](./live-queries.md#includes).

### Wrap grouping keys when there is no aggregate

Aggregates such as `count()` already include the grouping compiler. A query
that groups without an aggregate must use `groupKeys()`, or it throws
`GroupingOperatorRequiredError`:

```ts
import { groupKeys } from '@tanstack/db'

// Before: .groupBy(({ todo }) => todo.status)
q.from({ todo: todoCollection })
  .groupBy(groupKeys(({ todo }) => todo.status))
  .select(({ todo }) => ({ status: todo.status }))
```

If you construct query IR directly, pass `groupingCompiler` as the third
argument to `IR.Aggregate`, and `includesRuntime` as the fifth argument to
`IR.IncludesSubquery`, before `parentFilters`. Both values are exported from
`@tanstack/db`. Queries built through the query builder use the operators above.

### Enable pooling explicitly

Framework hooks no longer pool queries by default. To retain shared work for
eligible equality-filtered queries, pass the exported `pooledLiveQueries`
value in the query config:

```tsx
import { eq, pooledLiveQueries } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'

useLiveQuery({
  query: (q) => q.from({ todo: todoCollection })
    .where(({ todo }) => eq(todo.listId, listId)),
  pool: pooledLiveQueries,
})
```

Omit `pool` to use an independent query. Boolean `pool` values now throw
`InvalidPoolOptionError`, including on disabled queries; replace `true` with
`pooledLiveQueries` and remove `false`. Results do not change. Suspense queries
and queries backed by a `DbClient` do not pool. Angular's `{ params, query }`
form accepts the same `pool` value. See
[Pooled Live Queries](./live-queries.md#pooled-live-queries).

Custom framework adapters that use the unstable `resolveLiveQueryValue` helper
must pass `pooledLiveQueries` or `false` as its `pool` option and validate
caller config with `configPool`. Window helpers such as
`resolveLiveQueryWindowInput` and `liveQueryWindowMatches` are no longer
exported; use `bindLiveQueryWindow` for the shared infinite-query binding.

## Update React live-query hooks

Dependency arrays were removed from `useLiveQuery`, `useLiveSuspenseQuery`, and
`useLiveInfiniteQuery`. For structured queries, omit the array: the hooks
derive identity from the query, including captured values used in structured
expressions.

```tsx
// Before
useLiveQuery(
  (q) => q.from({ todos: todoCollection })
    .where(({ todos }) => eq(todos.status, status)),
  [status],
)

// After
useLiveQuery({
  query: (q) => q.from({ todos: todoCollection })
    .where(({ todos }) => eq(todos.status, status)),
})
```

Opaque functional query clauses, such as `.fn.where`, need an explicit,
serializable `queryKey` that includes their captured values:

```tsx
useLiveQuery({
  queryKey: [todoCollection.id, 'status', status],
  query: (q) => q.from({ todos: todoCollection })
    .fn.where(({ todos }) => todos.status === status),
})
```

An unhashable query without a nonempty `queryKey` now throws
`UnhashableQueryIRError`; `queryKey: []` counts as absent. Put the key in the
config object for `useLiveQuery` or `useLiveSuspenseQuery`; pass it in the second
argument's config for `useLiveInfiniteQuery(query, { pageSize, queryKey })`.
See [Query Identity](../framework/react/overview.md#query-identity) for details.

### Check identity in other frameworks and keep sources stable

The nonempty `queryKey` requirement also applies to Preact and to any hook
backed by a `DbClient`, including Svelte. It covers `.fn.where`, `.fn.select`,
and `.fn.having`. Without a `DbClient`, Vue, Solid, Angular, and Svelte can
recompile from reactive reads and do not require a key for opaque clauses.

For a mounted hook that compares derived identity, a source Collection ID
must keep naming the same Collection object in that client scope. Replacing
the object while reusing its ID now throws `SourceCollectionIdReuseError`.
Keep source Collections stable across renders. To reuse an ID in that binding,
unmount it, clean up its source and client scope, then mount the replacement.
Separate bindings and independent client scopes can use the same ID.

An explicit `queryKey` makes identity your responsibility: include a primitive
scope token in it and change the key when replacing the source. Do not put a
Collection object in the key. See
[Query Identity](./ssr.md#react-query-identity).

## Read Solid query data through the accessor

Solid `useLiveQuery` no longer exposes the deprecated `.data` alias. Call the
returned accessor wherever you read the result:

```tsx
const todosQuery = useLiveQuery((q) => q.from({ todos: todoCollection }))

// Before: <For each={todosQuery.data}>...</For>
<For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
```

Status fields remain reactive properties, such as `todosQuery.isLoading`. See the
[Solid adapter guide](../framework/solid/overview.md).

## Remove the obsolete alias error import

`DuplicateAliasInSubqueryError` has been removed. Nested queries may reuse an
ancestor's alias; aliases must still be unique within one lexical scope.
Remove imports and catches for this obsolete error.

## Separate loading failures from sync problems

Collection `status` now describes whether data can be shown. After readiness,
a network or backend failure keeps the rows and `status: 'ready'`; the problem
appears in `health`. Local storage failures, a throwing sync function, and
internal invariant failures use the new terminal `crashed` status.

Live-query hooks no longer expose `isError`. Replace it with `isLoadingError`
for a failed first load, `isCrashed` for a crash, and `isSyncError` for sync
problems while ready rows remain visible.

Update status switches, hook result destructuring, error screens, and retry
buttons:

| Before | After |
| --- | --- |
| Hook `isError` | `isLoadingError` for a failed first load; `isCrashed` for a crash |
| `status === 'error'` for every failure | `error` only for a failed first load; `crashed` for local failure; `health` for sync problems after readiness |
| Hide rows on any sync error | Keep ready rows visible and use `isSyncError` for a stale-data banner |
| Query Collection `utils.lastError`, `utils.isError`, `utils.errorCount` | Read `collection.health` or the hook's `health` tree |
| Query Collection `utils.clearError()` | `collection.reload()` for a failed first load; `utils.refetch({ throwOnError: true })` to retry a fetch and observe rejection |
| Infinite hook `error` in React, Preact, Vue, or Svelte | Read the root node's `health.error` (through a ref in Vue) |

`isSyncError` is true when the query is ready and any node in its health tree
has a problem. Each source alias has a node: `failureReason` means the adapter
is still trying, and `error` means it stopped. On the query's own node, `error`
can also mean a request for more data failed. `findProblems(health)` from
`@tanstack/db` finds the nodes with problems. A problem's `cause` preserves the
reported value; its `errors` array lists failures still open, oldest first.
Do not treat that array's length as a count of all failed fetches.

`fetchNextPage()` still resolves when a page load fails. Inspect `health`
afterward; catching its promise does not detect a failed page load.
`useLiveSuspenseQuery` throws for a failed first load or a crash. Sync problems
after readiness stay in `health` and do not reach the error boundary. See
[Loading and Sync Errors](./error-handling.md#loading-and-sync-errors).

Effects also keep running through sync problems after their initial load.
Move handling of those problems from `onSourceError` to `onHealthChange`.
`onSourceError` still ends the Effect on a failed first load, crash, or failed
load that the Effect needs.

### Retry with `reload()` and update cleanup calls

For a failed load or a stopped sync adapter, replace cleanup-and-preload retry
code with `reload()`:

```ts
// Before
await todosQuery.cleanup()
await todoCollection.cleanup()
await todosQuery.preload()

// After
await todosQuery.reload()
```

A live query reloads errored sources recursively, then retries its own error
when needed. Existing rows, status, and error stay visible while it reloads;
check `health.reloading` for progress. A failed reload rejects. A local-only
Collection's reload preserves its rows and does not reset them to `initialData`.

`cleanup()` now rejects with `CollectionHasSubscribersError` if an active live
query or Effect reads the Collection. Unmount or dispose those readers first,
or use `await collection.cleanup({ dependents: true })` to end them. This ends
the dependents; mount or create them again after restarting. Inspect
`collection.subscribers` to find them. Raw `subscribeChanges()` subscriptions
do not block cleanup and are not ended by it. New subscriptions and deferred
acquisition resumption throw while cleanup is in progress; wait for cleanup
to settle before restarting.

A crashed Collection cannot reload. Recover with
`await collection.cleanup({ dependents: true })`, then start it again, for
example with `await collection.preload()`, and recreate its readers. Cleanup
discards its rows. For a closed IndexedDB connection, create a new connection
and affected Collections. See
[When a Collection crashes](./error-handling.md#when-a-collection-crashes).

### Use one readiness signal for persisted data

Remove `persistedStatus`, `isPersistedReady`, `persistedError`,
`preloadForInitialRender()`, and `PERSISTED_READINESS`. Use normal `status`,
`preload()`, and `health` instead.

With `initialRender: { strategy: 'network-first', networkTimeoutMs }`, an eager
persisted Collection becomes ready from restored rows when the deadline passes
or the remote first load fails. The restore must finish and contain at least
one row. An empty restore waits for the network and cannot rescue a failed
first load; a failed restore crashes the Collection. The default deadline is
three seconds, and it does not stop sync.
Without `initialRender`, restored rows do not make the Collection ready before
its sync adapter does. Suspense and ordinary hooks now follow the same status.
See [Render after SQLite restore](./sqlite-persistence.md#render-after-sqlite-restore).

## Prepare SSR data explicitly

An ordinary server hook can render empty/loading state without preloading.
Rendering rows or readiness now requires a matching `preloadLiveQuery()` or
explicit preparation of its source Collections. Another query incidentally
warming the same source is insufficient and now throws with preparation
guidance. Streaming Suspense prepares its own result.

Share a config object between the loader and the hook:

```tsx
import { eq, type InitialQueryBuilder } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'

const openTodos = {
  query: (q: InitialQueryBuilder) => q.from({ todo: todoCollection })
    .where(({ todo }) => eq(todo.status, 'open')),
}

// In the server loader:
await dbClient.preloadLiveQuery(openTodos)

// In the component:
const { data } = useLiveQuery(openTodos)
```

Keep the input form consistent: `useLiveQuery(openTodos.query)` currently has a
different identity from `useLiveQuery(openTodos)`. If using an explicit
`queryKey`, use the same key and query configuration in the preload and hook.
For infinite queries, the identity also includes the initial limit and offset:
preload the first window with `limit(pageSize + 1).offset(0)` to include its
one-row peek. See [Prepare every server snapshot](./ssr.md#prepare-every-server-snapshot).

Create manual indexes when initializing the request or browser client, before
preloading or rendering queries that depend on them. Installing an index inside
the sync callback can be too late for query compilation. See
[Indexes before query compilation](./ssr.md#indexes-before-query-compilation).

Svelte roots initialized with `hydrate()` must mark their provider:

```svelte
<DbProvider {client} hydrating>
  <Todos />
</DbProvider>
```

Nested providers inherit `hydrating`, and each provider clears it after mount.
This also applies to hooks that receive `client` explicitly. Omit it for a root
created with `mount()`. It preserves each reader's server snapshot through
hydration, even when browser data has already changed. See
[Svelte SSR](./ssr.md#svelte).

## Changes since `@tanstack/db@0.9.2`

The following changes shipped before the RC. Check the sections that match the
packages and APIs your app uses when upgrading directly from an older release.

### Check transaction and outbox lifetimes

A persisting transaction now retains every Collection it touches until its
handler settles; the `gcTime` delay starts again after the last persisting
transaction finishes. Unmounting a screen no longer permits garbage collection
to interrupt its persisting write. A pending manual transaction still does not
retain its Collections: keep a subscription while its draft rows are needed.
Explicit `cleanup()` still discards rows during a persisting transaction. See
[Manual Transactions](./mutations.md#manual-transactions).

Offline Transactions keeps its default outbox format, so existing apps need
no data conversion. If adopting the optional `mutationCodec`, keep its codec ID
and decoder available across restarts: encoded records use wire version 4,
which older readers cannot replay. Default writers still use version 3. See
[Mutation value codecs](./offline-transactions.md#mutation-value-codecs).

### Await Query Collection direct writes

`writeInsert`, `writeUpdate`, `writeDelete`, `writeUpsert`, and `writeBatch` now
return promises whose validation errors reject. Catch errors from an awaited
write, including `DuplicateKeySyncError` when `writeInsert` uses an existing key
in a persisted Collection:

```ts
try {
  await todosCollection.utils.writeInsert(todo)
} catch (error) {
  // Handle the rejected write.
}
```

Direct writes no longer automatically refetch active on-demand Query subsets.
They update Collection and Query cache rows where the write can be represented.
Call `await todosCollection.utils.refetch()` when you need current server rows.
Mutation handlers also require explicit synchronization as described above.
Use TanStack Query Core
5.90.15 or later for post-write refetch replacement and error recovery. See
[Direct Writes](../collections/query-collection.md#direct-writes).

### Import IndexedDB APIs from core

The standalone `@tanstack/indexeddb-db-collection` package was removed. Import
`createIndexedDB` and `indexedDBCollectionOptions` from `@tanstack/db` and
remove the old package dependency. See the
[IndexedDB Collection guide](../collections/indexed-db-collection.md).

### Update custom sync adapters

- Remove the `immediate` argument from `begin({ immediate: true })` in sync
  callbacks. Call `begin()` instead. Sync writes made while a mutation persists
  now queue behind it; code must not rely on them appearing immediately.
- Replace `markError(error)` with `fail(error)` when the adapter stops trying.
  Before the run's first `markReady()`, this fails loading; afterward it keeps
  ready rows and records `health.error`. Retry a failed run with `reload()`.
- While retrying the first load, call neither `fail` nor `reportError`. After
  the run's first `markReady()`, use `reportError(error)` while retrying, and
  `reportHealthy()` on recovery. Both throw before the run is ready or after
  `fail()`. Use `reportHealthy(error)` to clear just one reported failure if
  other independent failures remain. Stop the run's work after `fail()`; later
  writes and health reports are invalid. Repeated `markReady()` and `fail()`
  calls in the same run do nothing.
- Track readiness inside each `sync` invocation. During a reload,
  `collection.status` still describes the previous run and cannot tell you
  whether the new run has reached its first ready.
- Remove `begin({ direct: true })`. Ordinary `begin()` writes against the rows
  the Collection holds, including during reload. To replace all synced rows
  with a complete authoritative snapshot, use `begin({ snapshot: true })` or
  `truncate()` in the new run. An ordinary first commit no longer implies
  replacement. Core does not delete rows omitted by ordinary writes.
- When keeping rows during reload, update existing keys and explicitly delete
  removed rows. Inserting an existing key with a changed value throws
  `DuplicateKeySyncError`. A partial on-demand `loadSubset` result must never
  claim to be a full snapshot. Honor its `signal`: aborted loads no longer hold
  readiness, and core ignores their later promise results.

See [For sync adapter authors](./error-handling.md#for-sync-adapter-authors)
for an example and the full reload contract.

### Update persistence integrations and browser assets

- Custom SQLite `PersistenceAdapter` implementations must implement
  `loadResumeSnapshot`. A custom sync wrapper must forward
  `metadata.persistence` unchanged. When metadata is present, its `persistence`
  field is required and is `null` when there is no persistence capability.
- Lower-level SQLite adapter data operations now take an explicit
  `PersistedStorageTarget`, such as `eagerStorageTarget(collectionId)` or a
  claim-bound `managedStorageTarget(storageCollectionId, claimId)`, instead of a
  bare Collection ID. Ordinary Collection configuration does not need a target.
- Keep Electron persistence code in the main and renderer processes on matching
  package versions; mixed IPC protocol versions fail closed.
- `openBrowserWASQLiteOPFSDatabase` now rejects if opening takes more than 30
  seconds. Set `timeoutMs: 0` only if the previous unlimited wait is required.
- If a custom React Native op-sqlite wrapper returns ambiguous bare arrays, set
  `arrayResultMode` to `rows` or `statement-results`. These arrays now reject
  without an explicit mode.
- Local persisted Collections without a `sync` option reserve the utility names
  `acceptMutations`, `getLeadershipState`, and `forceReloadSubset`. Rename custom
  utilities with those names. `persistedCollectionOptions` now throws
  `InvalidPersistedCollectionConfigError` for them, even when inherited or set
  to `undefined`. Collections with a `sync` option keep their adapter utilities.

Browser SQLite now ships `wa-sqlite.wasm` separately from its OPFS worker.
Deploy both emitted assets. Vite, webpack 5, and Next.js include them
automatically; ordinary app setup needs no asset copying or WASM URL option.

In Vite development, pre-bundled installs reached only through another library
or an npm alias may fail to resolve the asset package. Multiple installed
versions can select a mismatched worker. If opening rejects with
`PersistenceUnavailableError` in these cases, exclude the package from
pre-bundling:

```ts
// vite.config.ts
export default defineConfig({
  optimizeDeps: {
    exclude: ['@tanstack/browser-db-sqlite-persistence'],
  },
})
```

For an npm alias, list the alias used by the importing code instead. The same
exclusion is needed if the database opens inside a worker or the page's Vite
client has no script `src`. See the
[Browser SQLite runtime notes](https://github.com/TanStack/db/tree/main/packages/browser-db-sqlite-persistence#notes).

### Review query windows, joins, and aggregates

- An ordered `findOne` keeps its compiled limit of one, or zero after
  `.limit(0).findOne()`. `setWindow` may move its offset but cannot change its
  limit. An unordered `findOne` stays at offset zero. Move to an ordered,
  limited multi-row query if the result needs a larger or movable window.
  `setWindow` controls only the outer query's own window, not a window inside a
  subquery or include.
- Joined row keys now use JSON arrays of source keys, with `null` for a missing
  side. Code that constructs a key to call `collection.get()` must use the new
  format. Reading the published row's `$key` avoids reconstructing it,
  especially for non-finite numeric keys.
- A source field selected outside an aggregate or `groupBy` key now throws
  `NonAggregateExpressionNotInGroupByError`; the same rule applies in `having`.
  Aggregate the field or include it in `groupBy`. Nested includes inside a
  grouped or aggregate select now throw as well.
- An aggregate used in `orderBy` or `having` must also appear in `select()`.
  Otherwise the query throws `AggregateFunctionNotInSelectError`.
- Clean up the owning live query rather than calling `cleanup()` on one of its
  included child Collections. The child cleanup now rejects because several
  parent rows can share that Collection.

### Use string or number keys throughout

`sync.write` now enforces the same key restriction as optimistic writes:
`getKey` must return a string or number. An undefined key throws
`UndefinedKeyError`; other invalid keys throw `InvalidKeyError`. Convert
boolean, bigint, nullable, or compound identifiers to a stable string or number
in your adapter's `getKey`.

Single-field grouped results now encode `null`, `undefined`, boolean, and
bigint group values as string keys. String and number group values keep their
keys, except strings beginning with the reserved `\u0000tanstack-db:` prefix,
which are encoded too. Read the published row's `$key` when retrieving a group;
do not reconstruct a key from its grouping value. A custom live-query `getKey`
still overrides the default. See [groupBy and Aggregations](./live-queries.md#groupby-and-aggregations).

`SortedMap` is no longer exported from `@tanstack/db`. Remove imports of this
internal ordered map; use public Collection reads or an application-owned map.

### Check stricter inputs and adapter requirements

- A custom index `compareFn` or collation `compare` must return a number other
  than `NaN`. Invalid comparator results now throw instead of silently
  misordering an index.
- Browser development builds now detect two loaded copies of `@tanstack/db`
  and throw `DuplicateDbInstanceError`. Deduplicate the package if the check
  appears after upgrading.
- Pass fresh persisted or LocalStorage sync options to each direct
  `createCollection` call. Reusing mutable options across Collections now
  rejects. Reusable `DbClient` descriptors are unaffected.
- `Collection.update` keys must match the Collection's declared key type.
  Narrow possibly undefined keys, and use the branded key type if the
  Collection declares one. Reusable `Ref<T>` helpers that require virtual row
  metadata should set their third type parameter to `true`.
- Upgrade to PowerSync 2 before updating `@tanstack/powersync-db-collection`,
  and to RxDB 17 before updating `@tanstack/rxdb-db-collection`.
- Vue live-query `data.value` is a snapshot. Read `data.value` again to get
  later rows instead of keeping a previously read array. If a changed query
  fails to compile, the hook no longer displays the previous query's rows.
- A default auto-committed offline transaction accepts only its first
  `mutate()` call. Create a new offline transaction for each later write;
  calling `mutate()` again on the committed transaction now throws
  `TransactionNotPendingMutateError`.
- If you import `@tanstack/db-ivm` directly, update removed operator imports.
  The old join helpers become `join(other, type)`; use
  `orderByWithFractionalIndex` or `groupedOrderByWithFractionalIndex` in place
  of the removed ordering helpers. See the
  [0.2.0 release notes](https://github.com/TanStack/db/blob/main/packages/db-ivm/CHANGELOG.md#020)
  for the full list.

Production error messages now contain a short code and a link to the
[error reference](../errors.md). Code that compared the old message text should
use error classes, names, or fields instead. The development messages remain
descriptive.
