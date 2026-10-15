---
title: Migrating to the 1.0 RC
id: migrate-to-1-0-rc
---

This guide covers the API changes in `1.0.0-rc.1` for apps upgrading from a
pre-1.0 TanStack DB release. For the earlier `DbClient` and SSR migration, see
the [SSR and Hydration guide](./ssr.md#migration-guide).

## Update your packages

Update the pre-1.0 TanStack DB packages your app uses together. Once the RC is
published, install them from npm's `rc` tag. For example:

```sh
npm install @tanstack/react-db@rc @tanstack/electric-db-collection@rc
```

The first candidate is `1.0.0-rc.1`. `@tanstack/query-db-collection` and
`@tanstack/offline-transactions` are already stable 1.x packages; keep them on
their 1.x releases rather than changing them to an RC version.

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
`hasVirtualProps(row)` now requires it. If you call
`enrichRowWithVirtualProps`, its fourth argument computes pending writes rather
than the inverse `$synced` value.

### Keep virtual field names for row metadata

The fields `$hasPendingWrites`, `$origin`, `$key`, and `$collectionId` are
reserved on published Collection rows. A selected field with one of those names
cannot replace the metadata at a live-query row root. Whole-row outputs retain
their source row's metadata; ordinary projections receive the live-query
Collection's metadata. Rename application data fields that collide with these
names before selecting them as row roots.

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
