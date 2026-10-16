---
title: Migrating to the 1.0 RC
id: migrate-to-1-0-rc
---

This guide covers the API changes in `1.0.0-rc.1` and the changes shipped since
`@tanstack/db@0.9.2` in September 2026 that may require changes to an app. For
the earlier `DbClient` and SSR migration, see the
[SSR and Hydration guide](./ssr.md#migration-guide).

## Update your packages

Update the pre-1.0 TanStack DB packages your app uses together. Once the RC is
published, install them from npm's `rc` tag. For example:

```sh
npm install @tanstack/react-db@rc @tanstack/electric-db-collection@rc
```

The first candidate is `1.0.0-rc.1`. `@tanstack/query-db-collection` and
`@tanstack/offline-transactions` were both accidentally released as 1.0 before
the RC. Keep them on 1.x and update to their latest 1.x patch releases. Those
patches use the app's `@tanstack/db` as a peer dependency, so the RC and stable
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

**Query Collection remains on stable 1.x.** It still refetches automatically
after a handler returns and still accepts `{ refetch: false }` to skip that
refetch. If your handler calls `collection.utils.refetch()` itself, return
`{ refetch: false }` to avoid a second refetch. See
[Controlling Refetch Behavior](../collections/query-collection.md#controlling-refetch-behavior).

For TypeScript code that uses the handler type aliases directly,
`InsertMutationFn`, `UpdateMutationFn`, and `DeleteMutationFn` no longer take a
return-value type parameter. `BaseCollectionConfig` no longer takes its old
`TReturn` type parameter. The Electric `MatchingStrategy` type was removed with
the returned matching strategy.

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

An unhashable query without `queryKey` now throws. Put the key in the config
object for `useLiveQuery` or `useLiveSuspenseQuery`; pass it in the second
argument's config for `useLiveInfiniteQuery(query, { pageSize, queryKey })`.
See [Query Identity](../framework/react/overview.md#query-identity) for details.

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

## Changes since `@tanstack/db@0.9.2`

The following changes shipped before the RC. Check the sections that match the
packages and APIs your app uses when upgrading directly from an older release.

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
This change concerns the `write*` utilities; the handler auto-refetch behavior
described above still applies to Query Collection 1.x. Use TanStack Query Core
5.90.15 or later for post-write refetch replacement and error recovery. See
[Direct Writes](../collections/query-collection.md#direct-writes).

### Import IndexedDB APIs from core

The standalone `@tanstack/indexeddb-db-collection` package was removed. Import
`createIndexedDB` and `indexedDBCollectionOptions` from `@tanstack/db` and
remove the old package dependency. See the
[IndexedDB Collection guide](../collections/indexed-db-collection.md).

### Update sync and persistence integrations

- Remove the `immediate` argument from `begin({ immediate: true })` in sync
  callbacks. Call `begin()` instead. Sync writes made while a mutation persists
  now queue behind it; code must not rely on them appearing immediately.
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
- Clean up the owning live query rather than calling `cleanup()` on one of its
  included child Collections. The child cleanup now rejects because several
  parent rows can share that Collection.

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
  later rows instead of keeping a previously read array.
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
