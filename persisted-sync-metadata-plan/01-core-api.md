# Phase 1: Core API

## Objective

Add a transactional sync metadata API to `@tanstack/db` that supports:

- row metadata
- collection metadata
- metadata-only committed sync transactions
- read-your-own-writes semantics inside a sync transaction

This phase should not require query collection or Electric changes to ship. It
is the core primitive they will later consume.

## Primary code areas

- `packages/db/src/types.ts`
- `packages/db/src/collection/sync.ts`
- `packages/db/src/collection/state.ts`
- `packages/db/tests/collection.test.ts`
- any new core tests needed for metadata transaction behavior

## Proposed implementation steps

### 1. Extend sync types

Update the sync params type to include:

- `metadata.row.get`
- `metadata.row.set`
- `metadata.row.delete`
- `metadata.collection.get`
- `metadata.collection.set`
- `metadata.collection.delete`
- `metadata.collection.list`

Key requirements:

- metadata API is optional
- metadata writes outside an active sync transaction throw
- startup reads through `metadata.row.get`, `metadata.collection.get`, and
  `metadata.collection.list` are allowed outside a transaction
- reads inside an active transaction must reflect staged metadata writes

### 2. Extend pending sync transaction state

Update the internal pending synced transaction shape so it can stage:

- row operations
- row metadata writes
- collection metadata writes
- truncate/reset state

Suggested internal shape:

```ts
type PendingMetadataWrite =
  | { type: 'set'; value: unknown }
  | { type: 'delete' }

type PendingSyncedTransaction = {
  committed: boolean
  operations: Array<OptimisticChangeMessage<any, any>>
  deletedKeys: Set<any>
  rowMetadataWrites: Map<any, PendingMetadataWrite>
  collectionMetadataWrites: Map<string, PendingMetadataWrite>
  truncate?: boolean
  immediate?: boolean
}
```

Exact naming is flexible, but the staged metadata writes must be co-located with
the existing pending sync transaction.

### 3. Add in-memory collection metadata state

Add a new in-memory store in `CollectionStateManager` for collection-scoped
synced metadata.

Suggested field:

```ts
public syncedCollectionMetadata = new Map<string, unknown>()
```

This should behave like `syncedMetadata`, but keyed by metadata key rather than
row key.

Note: this naming sits next to the existing row-scoped `syncedMetadata`. If the
implementation keeps both names, it should add clear comments distinguishing row
metadata from collection metadata. Renaming the existing row-scoped field to
something more explicit can be considered as a follow-up cleanup.

### 4. Define overwrite semantics

Document and implement these rules:

- `write({ metadata })` and `metadata.row.set()` target the same underlying row
  metadata state
- later staged writes win within a transaction
- every staged row metadata write is a replace at the transaction layer
- `delete` removes row metadata
- `metadata.row.set()` replaces the full row metadata blob
- `metadata.row.delete()` removes row metadata
- `metadata.collection.set()` replaces the full collection metadata value for
  that key
- `metadata.collection.delete()` removes the value

If callers need merge behavior, they should:

1. read the current metadata value
2. compute the merged result
3. stage the merged result explicitly

This avoids contradictory rules when `write({ metadata })` and
`metadata.row.set()` are both used for the same row in one transaction.

### 5. Support metadata-only transactions

Ensure `commitPendingTransactions()` can commit a transaction with:

- zero row operations and non-zero metadata changes
- row metadata changes only
- collection metadata changes only

This is a hard requirement for later Electric resume persistence and query
retention persistence.

### 6. Define truncate behavior

Core truncate semantics must be explicit:

- clear `syncedData`
- clear `syncedMetadata`
- clear any row-scoped staged metadata
- leave collection metadata alone unless a higher layer explicitly resets it

The core layer should not silently delete collection metadata on truncate.
Per-sync reset behavior can be layered on later.

### 7. Define row-delete semantics

Deleting a row through sync also deletes its row metadata.

This should hold regardless of whether row metadata had previously been staged
through `write({ metadata })` or `metadata.row.set()`.

### 8. Scope metadata to sync paths

This metadata API is sync-only.

It is not intended to flow through user mutation transport types such as
`PersistedMutationEnvelope`. User mutations may still observe `syncMetadata`
coming from already-synced rows, but they do not independently persist metadata
through this API.

## Edge cases to handle

- `metadata.row.set()` called before `begin()`
- `metadata.collection.set()` called after `commit()`
- `metadata.collection.get()` called before `begin()` during startup
- `metadata.row.get()` after a staged `row.set()` in the same transaction
- `metadata.collection.list(prefix)` after multiple staged collection writes
- mixing `write({ metadata })` and `metadata.row.set()` for the same key in the
  same transaction
- row delete after earlier staged row metadata updates in the same transaction
- truncate followed by new staged row metadata in the same transaction
- empty transaction commit with only metadata writes

## Acceptance criteria

- core sync API can stage and commit row metadata
- core sync API can stage and commit collection metadata
- metadata reads inside a transaction see staged writes
- metadata-only commits work
- existing collection behavior without metadata remains unchanged

## Suggested tests

- commit row metadata through `write({ metadata })`
- commit row metadata through `metadata.row.set()`
- commit collection metadata through `metadata.collection.set()`
- verify read-your-own-writes inside a transaction
- verify startup reads outside a transaction succeed
- verify last-write-wins for staged row metadata
- verify metadata writes outside a transaction throw
- verify row delete removes row metadata
- verify truncate clears row metadata but not collection metadata
- verify metadata-only transactions commit successfully

## Exit criteria

Phase 1 is complete when the core collection layer can represent, stage, commit,
and read metadata correctly in memory, independent of any persistence adapter.
