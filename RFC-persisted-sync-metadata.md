# RFC: Transactional Persisted Sync Metadata

## Status

Draft

## Summary

This RFC proposes a transactional metadata API that sync implementations can
optionally use to persist and restore metadata alongside synced collection data.

The design supports two metadata scopes:

- **Row metadata**: metadata attached to a specific synced row
- **Collection metadata**: metadata attached to the collection as a whole

The API is designed so that metadata changes can be committed atomically with
persisted row changes. This is required for correctness in two cases that are
already visible in the codebase:

- `query-db-collection` needs persisted ownership and GC state so warm-starts do
  not incorrectly delete or leak rows
- `electric-db-collection` needs persisted resume state and related metadata so
  it can safely warm-start from persisted data and continue streaming

This RFC is intentionally ordered around the consumer-facing API first, then the
SQLite implementation, then how query collections use it, and finally how
Electric collections use it.

## Problem

Today, persisted SQLite rows and sync-layer runtime metadata live on different
planes:

- persisted collections store row values durably
- sync implementations keep important state in memory only

That leads to restart gaps:

- query collections lose row ownership state and cannot safely decide whether a
  row should be deleted when the first query result arrives after restart
- Electric collections do not have a durable, transactional place to store
  stream resume state such as offsets or handles

The central requirement is not merely "persist metadata", but:

1. collections must be able to **read persisted metadata on startup**
2. collections must be able to **update metadata as part of normal sync work**
3. persisted metadata that affects row existence must be **transactional with
   row persistence**

Non-transactional sidecar metadata is not sufficient for correctness. If row
data commits without matching metadata, or metadata commits without matching row
data, restart behavior can still be wrong.

## Goals

- Provide an optional metadata API to sync implementations
- Keep the API generic enough for multiple sync implementations
- Preserve crash consistency by making metadata transactional with row changes
- Support both row-local and collection-level metadata
- Support persisted GC state for query collections
- Support persisted resume state for Electric collections

## Non-Goals

- Define every possible metadata schema for all sync implementations
- Require metadata support for non-persisted collections
- Force all persistence adapters to implement advanced GC optimizations on day
  one

## Proposed API

### Design principles

The API exposed to a collection's sync implementation should be:

- **optional**: absent for non-persisted collections
- **transaction-scoped**: metadata mutations participate in the current sync
  transaction
- **scope-aware**: row metadata and collection metadata are separate
- **readable at startup**: sync implementations can restore state before or
  during hydration

### Sync API additions

The `sync.sync()` params gain an optional `metadata` capability:

```ts
type SyncMetadataApi<TKey extends string | number = string | number> = {
  row: {
    get: (key: TKey) => unknown | undefined
    set: (key: TKey, metadata: unknown) => void
    delete: (key: TKey) => void
  }
  collection: {
    get: (key: string) => unknown | undefined
    set: (key: string, value: unknown) => void
    delete: (key: string) => void
    list: (prefix?: string) => ReadonlyArray<{
      key: string
      value: unknown
    }>
  }
}

type SyncParams<T, TKey extends string | number> = {
  collection: Collection<T, TKey>
  begin: (options?: { immediate?: boolean }) => void
  write: (message: ChangeMessageOrDeleteKeyMessage<T, TKey>) => void
  commit: () => void
  markReady: () => void
  truncate: () => void
  metadata?: SyncMetadataApi<TKey>
}
```

### Semantics

`metadata` is only available when the collection is backed by a persistence
layer that supports it.

`metadata.row.*` operates on the durable metadata associated with synced rows in
the current collection.

`metadata.collection.*` operates on durable collection-scoped metadata entries.
These entries are not attached to a single row, but they still participate in
the current sync transaction.

### Transaction model

Metadata operations are only valid while a sync transaction is open, that is,
between `begin()` and `commit()`.

This RFC explicitly requires support for four kinds of committed sync
transactions:

- row mutations only
- row mutations plus metadata mutations
- collection metadata mutations only
- row metadata mutations only

If `metadata.row.set`, `metadata.row.delete`, `metadata.collection.set`, or
`metadata.collection.delete` is called outside an open transaction, the
implementation should throw, just as `write()` does today when called without a
pending sync transaction.

### Read-your-own-writes

Reads performed through `metadata.row.get`, `metadata.collection.get`, and
`metadata.collection.list` inside an open transaction must reflect any staged
writes from that same transaction.

This is required so sync implementations can safely merge metadata within a
transaction without having to mirror staged state themselves.

The write semantics are:

- `row.set` updates the metadata that will be committed for that row
- `row.delete` removes persisted row metadata for that row
- `collection.set` stages a collection metadata update in the current sync
  transaction
- `collection.delete` stages a collection metadata delete in the current sync
  transaction

The read semantics are:

- `row.get` returns the currently hydrated metadata for a row, if known
- `collection.get` and `collection.list` return the persisted collection
  metadata that was loaded during startup or hydration

### Relationship to `write({ metadata })`

The existing `write({ type, value, metadata })` path and `metadata.row.*` must
target the same underlying row metadata store.

They serve different purposes:

- `write({ ..., metadata })` attaches metadata to a row mutation
- `metadata.row.set()` and `metadata.row.delete()` allow explicit metadata-only
  row changes when the row value itself did not change

Within a single transaction, implementations should treat these as staged
updates to the same row metadata slot. If both are used for the same row in the
same transaction, the effective metadata should follow transaction order
semantics, with later staged changes winning.

### Why this shape

This API is deliberately **not** an async sidecar KV API like
`load/store/delete`. A free-floating async store suggests independent writes at
arbitrary times. That is exactly what we want to avoid for correctness-sensitive
state.

Instead, the API is modeled as an extension of the existing sync transaction
surface:

- read previously persisted metadata
- stage metadata changes
- commit metadata together with row changes

### Serialization

Persisted metadata values are JSON-serialized using the same persisted JSON
encoding rules used elsewhere in the SQLite adapter. Metadata should therefore
be kept JSON-compatible and reasonably small.

## SQLite Persistence Implementation

### Overview

The SQLite persisted collection layer implements the metadata API using two
durable stores:

1. **row metadata** stored with persisted rows
2. **collection metadata** stored in a separate table

Both participate in the same SQLite transaction used to apply a committed sync
transaction.

### Schema changes

#### Persisted rows

Add a `metadata` column to the collection table:

```sql
CREATE TABLE IF NOT EXISTS <collection_table> (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  metadata TEXT,
  row_version INTEGER NOT NULL
)
```

The tombstone table may also optionally carry the last row metadata if useful
for debugging or future recovery, but that is not required for the core design.

#### Collection metadata

Add a collection-level metadata table:

```sql
CREATE TABLE IF NOT EXISTS collection_metadata (
  collection_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (collection_id, key)
)
```

This table stores collection-scoped metadata such as:

- Electric resume state
- query collection placeholder GC state
- future sync-implementation-specific metadata

### Adapter contract

The SQLite adapter extends its persistence internals so a single committed sync
transaction can include:

- row mutations
- row metadata mutations
- collection metadata mutations

This requires the persisted runtime to stage metadata on the pending sync
transaction itself, not in a side buffer detached from `begin()` / `commit()`.

One possible shape is:

```ts
type PersistedRowMutation<T, TKey extends string | number> =
  | { type: 'insert'; key: TKey; value: T; metadata?: unknown }
  | { type: 'update'; key: TKey; value: T; metadata?: unknown }
  | { type: 'delete'; key: TKey; value: T }

type PersistedCollectionMetadataMutation =
  | { type: 'set'; key: string; value: unknown }
  | { type: 'delete'; key: string }

type PersistedTx<T, TKey extends string | number> = {
  txId: string
  term: number
  seq: number
  rowVersion: number
  mutations: Array<PersistedRowMutation<T, TKey>>
  collectionMetadataMutations?: Array<PersistedCollectionMetadataMutation>
}
```

This preserves a crucial invariant:

> if a sync transaction commits, both the row data and the metadata that explains
> that row data commit together

### PersistenceAdapter changes

This RFC implies an explicit adapter contract change:

- persisted row hydration must be able to return row metadata
- persisted transaction application must be able to apply collection metadata
  mutations as part of the same commit

One possible updated hydration shape is:

```ts
type PersistedLoadedRow<T, TKey extends string | number> = {
  key: TKey
  value: T
  metadata?: unknown
}
```

Existing adapters that do not yet provide metadata can remain compatible by
returning rows with `metadata: undefined`.

### Startup and hydration

The persisted runtime loads:

- row values and row metadata during normal subset hydration
- collection metadata during runtime startup

This means metadata restoration does **not** require a separate full database
scan beyond what the collection was already going to hydrate.

In eager mode, the initial hydrated subset carries its row metadata with it.

In on-demand mode, metadata is restored lazily for whichever subsets are loaded.

Collection metadata should be loaded before new sync subscriptions begin
processing, so startup GC or resume-state decisions can run against a stable
baseline.

## Query Collection Usage

### Problem to solve

`query-db-collection` keeps ownership state in memory:

- `queryToRows`
- `rowToQueries`
- `queryRefCounts`

After restart, persisted rows are restored into the base collection, but query
ownership is lost. The first query result can then incorrectly delete rows that
were hydrated from persistence but not yet claimed in memory.

### What the query collection should persist

The query collection should persist two categories of state:

1. **per-row ownership metadata**
2. **per-query GC state**

### Row metadata shape

Ownership should be stored in row metadata, not in a global sidecar blob:

```ts
type QueryRowMetadata = {
  queryCollection?: {
    owners: Record<string, true>
  }
}
```

Where the `owners` keys are hashed query identities.

This makes persisted ownership:

- local to the row it explains
- transactional with the row write
- reconstructible during ordinary row hydration

This also means ownership updates can happen without inventing synthetic row
value updates. A query may stop owning a row while another query still owns it;
that is a metadata-only row change.

### Reconstructing in-memory state

When rows are hydrated from persistence, the query collection can rebuild:

- `rowToQueries` from each row's persisted `owners`
- `queryToRows` by reversing that mapping

This reconstruction is incremental. It happens for the rows being hydrated, not
by requiring a separate full read of all persisted rows.

In on-demand mode, that means the in-memory ownership graph is only complete for
the hydrated subsets. This is sufficient for warm-start correctness of loaded
data, but not by itself sufficient for storage-level GC over entirely cold rows.

### Query refcounts

`queryRefCounts` should remain in-memory only.

They represent live subscriber/process state, not durable row ownership. After
restart, refcounts should begin at zero and grow as real subscriptions attach.

### Query lifecycle controls

Query collections now need three distinct lifecycle controls:

- `staleTime`: freshness of query data when re-requested
- `gcTime`: in-memory observer and TanStack Query cache retention
- `persistedGcTime`: durable placeholder and persisted-row retention

These controls solve different problems and must remain independent.

`staleTime` answers:

- should this query be considered stale when requested again?

`gcTime` answers:

- how long should the in-memory query observer and query cache survive after the
  query becomes inactive?

`persistedGcTime` answers:

- how long should persisted ownership placeholders and persisted rows survive
  after the query becomes inactive?

This separation is required for offline-first users who want persisted query
results to survive long periods offline even after in-memory query GC has
occurred.

### Persisted query retention state

Warm-start correctness also requires persisted query retention state for query
placeholders that still own rows but currently have no active subscribers.

That state is collection-level metadata and should support both finite TTL-based
retention and indefinite retention until the query is revalidated.

```ts
type PersistedQueryRetentionEntry =
  | {
      queryHash: string
      mode: 'ttl'
      expiresAt: number
    }
  | {
      queryHash: string
      mode: 'until-revalidated'
    }
```

Suggested keys:

- `queryCollection:gc:<queryHash>`

The value should contain at least:

- either `expiresAt` for finite TTL retention
- or `mode: 'until-revalidated'` for indefinite persisted retention
- optionally debug fields like `lastActiveAt`

The `until-revalidated` mode is intended for products that want persisted query
results to remain available indefinitely while offline and only be reconciled
once the same query is requested again.

### Query identity

The GC entry must be tied to the same canonical identity used for row ownership.

If the query collection needs more than the hash for debugging or future
matching, it may also persist:

- `queryCollection:query:<queryHash>` -> serialized query identity

This is collection-scoped metadata, not row metadata.

### GC behavior

When a query becomes idle and would normally begin its GC countdown:

1. keep row ownership on the rows
2. persist `queryCollection:gc:<queryHash>` with either:
   - `mode: 'ttl'` and `expiresAt`, or
   - `mode: 'until-revalidated'`

On restart:

1. load collection metadata entries matching `queryCollection:gc:`
2. for any query placeholder with `mode: 'ttl'` and expired `expiresAt`, run
   persisted cleanup
3. skip startup GC for placeholders with `mode: 'until-revalidated'`
4. remove the placeholder's ownership from rows when cleanup runs
5. delete rows that no longer have owners
6. delete the GC metadata entry when cleanup completes

Restart GC must run before new query subscriptions are allowed to attach for the
same collection, or under the same startup mutex that serializes hydration and
replay work. This avoids races where a placeholder is cleaned up while a real
query is simultaneously reattaching.

When a query with `mode: 'until-revalidated'` is requested again:

1. match the placeholder using the same canonical query identity
2. reconstruct the query's persisted ownership baseline
3. run the query and diff the result against the persisted owned rows
4. remove rows that are no longer owned after revalidation
5. clear or refresh the retention entry based on the newly active query state

This gives the desired offline behavior:

- persisted rows remain available indefinitely
- they are not deleted just because in-memory `gcTime` elapsed
- they are eventually reconciled when the query is re-requested

### Persisted GC implementation strategies

There are two viable implementation levels:

#### Level 1: simple row-metadata rewrite

Use row metadata as the source of truth and perform cleanup by:

- loading affected rows
- removing the owner from row metadata
- deleting rows whose owner set becomes empty

This is simpler and consistent with the row-metadata design, but it is less
efficient for large collections.

Level 1 also has an important limitation: if the adapter cannot efficiently
enumerate rows owned by a query, cleanup may degrade into a full collection scan
and row-metadata JSON rewrite. That is acceptable as an initial correctness
implementation, but it should be treated as a potentially expensive path.

This cost matters even more when persisted retention is long-lived, because more
query placeholders and retained rows may accumulate over time.

#### Level 2: normalized ownership index

Add an adapter-level ownership table:

```sql
CREATE TABLE query_row_ownership (
  collection_id TEXT NOT NULL,
  row_key TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  PRIMARY KEY (collection_id, row_key, query_hash)
)
```

This allows persisted GC to run efficiently in SQLite without scanning or
rewriting every row blob. The row metadata can remain the logical API surface,
while the adapter maintains the normalized index as an optimization.

This RFC does not require Level 2 for the initial API, but it leaves room for
it because query GC on persisted data is a first-class requirement.

Another acceptable future variation is to denormalize owned row keys into the GC
entry itself. This RFC does not require that initially, but it is compatible
with the collection metadata model.

### Query API surface

The query collection should expose persisted retention separately from
`staleTime` and `gcTime`.

One possible shape is:

```ts
queryCollectionOptions({
  queryKey: ['messages', spaceId, pageId],
  queryFn,
  staleTime: 0,
  gcTime: 5 * 60_000,
  persistedGcTime: Infinity,
})
```

An alternative shape that leaves more room for future extension is:

```ts
queryCollectionOptions({
  queryKey: ['messages', spaceId, pageId],
  queryFn,
  staleTime: 0,
  gcTime: 5 * 60_000,
  persistedRetention: {
    gcTime: Infinity,
  },
})
```

This RFC does not require the final option name, but it does require persisted
retention to be distinct from the existing in-memory `gcTime`.

## Electric Collection Usage

### Problem to solve

Electric has a different persistence problem from query ownership.

It needs durable collection-level resume state so that after restart it can:

- warm-start from persisted rows
- safely resume streaming from the correct point

Today, Electric can hydrate row data from persistence, but it does not have a
dedicated transactional metadata path for persisted resume state.

### What Electric should persist

Electric should use both metadata scopes:

#### Collection metadata

Use collection metadata for stream resume state, for example:

```ts
type ElectricResumeMetadata =
  | {
      kind: 'resume'
      offset: string
      handle: string
      shapeId: string
      updatedAt: number
    }
  | {
      kind: 'reset'
      updatedAt: number
    }
```

Suggested key:

- `electric:resume`

This metadata must be committed transactionally with the row changes that were
applied from the same Electric stream batch.

That gives the required safety property:

- if the row batch commits, the resume state commits
- if the row batch does not commit, the resume state does not advance either

#### Row metadata

Electric already attaches sync metadata to rows from stream headers. That row
metadata should flow through the same row metadata API so it can survive restart
where useful.

This includes information like:

- relation identity
- other per-row sync headers that are useful after hydration

### Resume semantics

On startup, Electric should:

1. read `electric:resume` from collection metadata
2. prefer that persisted resume state over a default `now` fallback
3. hydrate persisted rows
4. continue streaming from the persisted resume point

### Interaction with derived in-memory state

Electric also maintains in-memory derived state such as:

- tag tracking for move-out handling
- synced key tracking
- snapshot and txid matching helpers

This RFC does not require every derived Electric structure to become durable in
the first iteration. But it does define the metadata API needed to do so where
necessary.

The practical rule is:

- if a piece of Electric state affects whether rows should exist after restart,
  it should eventually become durable, either as row metadata or collection
  metadata
- if that state cannot yet be reconstructed safely, Electric should fall back to
  a conservative reload path rather than assuming warm-started data is exact

## API Usage Examples

### Query collection example

```ts
sync: ({ begin, write, commit, metadata }) => {
  const setRowOwners = (
    rowKey: string | number,
    owners: Record<string, true>,
  ) => {
    const current = (metadata?.row.get(rowKey) ?? {}) as Record<string, unknown>
    metadata?.row.set(rowKey, {
      ...current,
      queryCollection: {
        owners,
      },
    })
  }

  begin()
  // Normal sync logic...
  commit()
}
```

### Electric example

```ts
sync: ({ begin, write, commit, metadata }) => {
  const resumeState = metadata?.collection.get('electric:resume') as
    | {
        kind: 'resume'
        offset: string
        handle: string
        shapeId: string
        updatedAt: number
      }
    | {
        kind: 'reset'
        updatedAt: number
      }
    | undefined

  // use resumeState to configure the stream

  // later, when committing a batch:
  begin()
  write({ type: 'update', value: row, metadata: rowHeaders })
  metadata?.collection.set('electric:resume', {
    kind: 'resume',
    offset: nextOffset,
    handle: nextHandle,
    shapeId: nextShapeId,
    updatedAt: Date.now(),
  })
  commit()
}
```

## Design Decisions

### Why row metadata and collection metadata both exist

They solve different problems:

- row metadata explains why a specific row exists and what sync state belongs to
  it
- collection metadata tracks collection-wide runtime state such as resume points
  and query placeholder GC entries

Trying to store everything in one global metadata blob would force unnecessary
bootstrap work and make transactional coupling harder.

### Why metadata is part of the sync transaction model

The metadata API is not just a convenience wrapper. It is part of the sync
transaction model.

That means implementations must stage row operations, row metadata mutations,
and collection metadata mutations on the same pending sync transaction and apply
them together during commit.

### Why query GC state is collection metadata

GC timers are properties of query placeholders, not of individual rows. They
must persist across restart, but they are not naturally attached to a specific
row.

The ownership edges themselves belong with rows, but the expiration state belongs
with the query placeholder.

This also allows persisted retention to express policies that are not ordinary
timers, such as `until-revalidated`.

### Why refcounts are not persisted

Live refcounts describe current subscribers and current process state. That
state is not durable and should not survive restart. Durable ownership and
placeholder GC state are enough to reconstruct the correct baseline.

### Why persisted retention is separate from `gcTime`

Products may want in-memory query state to be short-lived while persisted data
remains durable for much longer, including indefinitely until the query is
requested again.

Keeping `persistedGcTime` separate allows:

- normal in-memory memory pressure behavior
- long-lived offline warm starts
- explicit control over how durable query placeholders are retained

### Metadata replay and recovery

Cross-tab replay, targeted invalidation, and `pullSince` recovery currently
transport row keys and values, but not metadata deltas.

The first implementation should preserve correctness before optimizing for
efficiency:

- if a committed tx includes metadata changes that cannot be replayed exactly,
  persisted runtimes may conservatively fall back to reload behavior
- targeted metadata replay can be added later as a follow-up optimization

This allows metadata support to ship without requiring a fully optimized replay
protocol on day one.

### Namespacing convention

Sync implementations that write collection metadata must namespace their keys.

The convention is:

- `<syncName>:<key>`

Examples:

- `queryCollection:gc:<queryHash>`
- `queryCollection:query:<queryHash>`
- `electric:resume`

This RFC does not require a registry mechanism initially, but namespaced keys
are mandatory to avoid collisions.

## Rollout Plan

### Phase 1

- add optional metadata API to sync params
- stage metadata writes on pending sync transactions
- support metadata-only committed sync transactions
- add SQLite support for row metadata and collection metadata
- hydrate row metadata alongside persisted rows

### Phase 2

- use row metadata in query collections for durable ownership
- persist query placeholder retention state in collection metadata
- implement restart-safe GC behavior
- use conservative reload fallback for metadata-bearing replay/recovery paths
- support separate persisted retention policy for query collections

### Phase 3

- use collection metadata in Electric for persisted resume state
- evaluate which additional Electric-derived state must become durable for exact
  restart behavior

## Open Questions

1. Should the initial SQLite implementation store query ownership only inside row
   metadata blobs, or also maintain a normalized ownership index from the start?

2. Should collection metadata be exposed to sync implementations only at startup
   and during transactions, or also via a read-only utility surface outside
   `sync.sync()`?

3. Should persisted query GC cleanup run only on startup and local unload paths,
   or also as part of a background maintenance task in persisted runtimes?

4. Should Electric persist only a resume offset, or also a stronger stream
   identity payload including shape/handle information to detect incompatible
   resume state?

## Testing Invariants

Any implementation of this RFC should add tests for at least these invariants:

- metadata commits iff the corresponding sync transaction commits
- row hydration restores row metadata together with row values
- query collection warm-start does not delete persisted rows before ownership is
  reconstructed
- persisted query GC deletes rows only when ownership is truly orphaned
- metadata-only sync transactions persist correctly
- truncate clears row metadata and any collection metadata that is defined as
  reset-scoped
- Electric resume metadata advances only when the corresponding batch commits
- metadata-bearing replay and recovery paths remain correct, even when they fall
  back to reload behavior

## Recommendation

Adopt a transactional metadata API with two scopes:

- row metadata for per-row durable sync state
- collection metadata for durable collection-wide state

Implement both in the SQLite persisted collection layer, then migrate:

- `query-db-collection` to durable row ownership plus collection-level GC state
- `electric-db-collection` to transactional persisted resume metadata

This keeps the API generic while preserving the key correctness property:

> metadata that affects persisted row behavior commits together with the row
> state it explains
