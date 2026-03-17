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
- metadata calls outside an active sync transaction throw
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

### 4. Define merge and overwrite semantics

Document and implement these rules:

- `write({ metadata })` and `metadata.row.set()` target the same underlying row
  metadata state
- later staged writes win within a transaction
- `insert` metadata replaces row metadata
- `update` metadata merges with the existing row metadata, following current
  `syncedMetadata` behavior
- `delete` removes row metadata
- `metadata.row.set()` replaces the full row metadata blob
- `metadata.row.delete()` removes row metadata
- `metadata.collection.set()` replaces the full collection metadata value for
  that key
- `metadata.collection.delete()` removes the value

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

## Edge cases to handle

- `metadata.row.set()` called before `begin()`
- `metadata.collection.set()` called after `commit()`
- `metadata.row.get()` after a staged `row.set()` in the same transaction
- `metadata.collection.list(prefix)` after multiple staged collection writes
- mixing `write({ metadata })` and `metadata.row.set()` for the same key in the
  same transaction
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
- verify last-write-wins for staged row metadata
- verify metadata calls outside a transaction throw
- verify truncate clears row metadata but not collection metadata
- verify metadata-only transactions commit successfully

## Exit criteria

Phase 1 is complete when the core collection layer can represent, stage, commit,
and read metadata correctly in memory, independent of any persistence adapter.
