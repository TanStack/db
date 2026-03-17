# Phase 2: SQLite Implementation

## Objective

Make `db-sqlite-persisted-collection-core` the reference implementation of the
metadata API by persisting:

- row metadata with row values
- collection metadata in a dedicated table
- row and metadata changes in the same SQLite transaction

## Primary code areas

- `packages/db-sqlite-persisted-collection-core/src/sqlite-core-adapter.ts`
- `packages/db-sqlite-persisted-collection-core/src/persisted.ts`
- `packages/db-sqlite-persisted-collection-core/tests/persisted.test.ts`
- `packages/db-sqlite-persisted-collection-core/tests/sqlite-core-adapter.test.ts`
- restart/runtime persistence contract tests

## Proposed implementation steps

### 1. Extend SQLite schema

Add:

- `metadata TEXT` column to persisted collection row tables
- `collection_metadata` table for collection-scoped metadata

Suggested shape:

```sql
CREATE TABLE IF NOT EXISTS collection_metadata (
  collection_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (collection_id, key)
)
```

### 2. Extend persisted row hydration

Update the adapter hydration path to return:

```ts
type PersistedLoadedRow<T, TKey extends string | number> = {
  key: TKey
  value: T
  metadata?: unknown
}
```

The persisted runtime must pass hydrated metadata into the collection sync
transaction, not drop it during `applyRowsToCollection()` or related paths.

### 3. Extend persisted tx shape

Update internal persisted tx machinery to support:

- row value writes
- row metadata writes
- collection metadata writes

This should be reflected in:

- normalized sync operation shapes
- buffered sync transactions
- adapter `applyCommittedTx()`
- replay payload classification so the runtime knows when exact targeted replay
  is possible and when it must fall back to reload

### 4. Make metadata transactional in SQLite

All of these must commit in one SQLite transaction:

- row inserts/updates/deletes
- row metadata changes
- collection metadata changes
- version/stream position updates already associated with the tx

This is the key correctness property for the whole design.

### 5. Load collection metadata at startup

The persisted runtime should load collection metadata during startup, before new
sync subscriptions start processing. This is necessary for:

- query placeholder retention decisions
- Electric resume-state restoration
- future collection-scoped metadata consumers

This should be reflected in the adapter contract explicitly, for example via:

```ts
loadCollectionMetadata?: (
  collectionId: string,
) => Promise<Array<{ key: string; value: unknown }>>
```

The exact method name is flexible, but startup collection metadata loading must
be a first-class adapter capability.

### 6. Carry metadata through replay and hydration

Metadata must not be lost in:

- initial hydration
- buffered sync transaction application
- internal persisted transaction creation
- self/follower replay
- `pullSince`-style gap recovery

For the first pass, replay behavior should be explicit:

- hydration must carry row metadata exactly
- local commit must carry row and collection metadata exactly
- if a committed tx contains metadata changes and the targeted replay protocol
  cannot represent them exactly, followers should fall back to reload behavior
- if gap recovery encounters metadata-bearing changes it cannot replay exactly,
  recovery should also fall back to reload behavior

This must be documented in the implementation, not left implicit.

## Important design constraints

### Metadata-only committed txs

The persisted layer must support transactions with:

- no row mutations
- collection metadata changes only

This is required for:

- Electric resume metadata commits
- query retention metadata updates

### Serialization

Use the same persisted JSON encoding and decoding path already used for row
values, so metadata can safely round-trip supported value types.

### Crash-consistency boundary

The implementation must keep row writes, row metadata writes, and collection
metadata writes inside the same SQLite transaction boundary.

If any part of the tx fails, all three categories must roll back together.

## Edge cases to handle

- metadata-only tx commit
- delete row with row metadata present
- row update with partial row value and metadata merge semantics
- crash/restart between repeated tx applications
- replay of metadata-bearing committed txs to follower tabs
- sequence-gap recovery when metadata changed in a missed tx
- full reload fallback correctness when targeted metadata replay is unavailable
- startup collection metadata load before subscription processing

## Acceptance criteria

- persisted rows round-trip metadata
- collection metadata round-trips independently
- row data and metadata commit atomically
- metadata-only committed txs persist correctly
- startup loads collection metadata and hydrated row metadata
- replay/recovery remains correct, even if it uses conservative reload fallback

## Suggested tests

- SQLite adapter stores and loads row metadata
- SQLite adapter stores and loads collection metadata
- `applyCommittedTx()` atomically commits row and collection metadata
- metadata-only tx survives restart
- hydrated rows apply metadata into collection state
- follower runtime converges on metadata-bearing txs
- seq-gap recovery remains correct when metadata changed
- startup collection metadata loads before any sync subscription attaches

## Exit criteria

Phase 2 is complete when SQLite-backed persisted collections can durably store,
hydrate, and replay metadata with the same transactional guarantees as row data.
