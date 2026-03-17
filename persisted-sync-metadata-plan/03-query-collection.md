# Phase 3: Query Collection

## Objective

Migrate `query-db-collection` to the new metadata primitives so it can:

- preserve row ownership across restart
- support persisted query retention independently from in-memory `gcTime`
- support long-lived offline warm starts
- reconcile retained persisted rows when the same query is requested again

## Primary code areas

- `packages/query-db-collection/src/query.ts`
- `packages/query-db-collection/src/serialization.ts`
- `packages/query-db-collection/tests/query.test.ts`
- persisted runtime integration tests combining query collection and SQLite

## High-level design

### Persisted on rows

Store per-row ownership in row metadata:

```ts
type QueryRowMetadata = {
  queryCollection?: {
    owners: Record<string, true>
  }
}
```

### Persisted at collection scope

Store query retention/placeholder metadata at collection scope.

Suggested entry shape:

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
- optionally `queryCollection:query:<queryHash>` for serialized query identity
- optionally `queryCollection:metaVersion` for migration/versioning

## Proposed implementation steps

### 1. Add persisted retention option to query collection config

Introduce a durable retention control that is independent from:

- `staleTime`
- in-memory `gcTime`

Possible public API shapes:

```ts
persistedGcTime?: number | typeof Infinity
```

or

```ts
persistedRetention?: {
  gcTime: number | typeof Infinity
}
```

The second shape is more extensible, but either is acceptable.

### 2. Rebuild ownership from hydrated rows

When rows are hydrated from persistence:

- inspect row metadata for query owners
- rebuild `rowToQueries`
- rebuild `queryToRows`

This reconstruction is incremental and subset-scoped.

### 3. Keep refcounts in memory only

Do not persist `queryRefCounts`.

They represent live subscriber/process state and should restart from zero.

### 4. Persist ownership changes transactionally

Whenever ownership changes for a row:

- update row metadata in the same sync transaction

This includes metadata-only ownership changes where the row value itself is
unchanged.

### 5. Persist query retention state

When a query becomes inactive:

- if persisted retention is finite, persist `mode: 'ttl'` with `expiresAt`
- if persisted retention is infinite, persist `mode: 'until-revalidated'`

This retention entry is independent from in-memory query `gcTime`.

### 6. Startup retention handling

At startup:

- load collection metadata retention entries before new subscriptions attach
- clean up expired `ttl` placeholders
- skip startup GC for `until-revalidated` placeholders

Startup retention cleanup must run under the same mutex or startup critical
section as hydration and replay to avoid races with new query subscriptions.

### 7. Revalidation flow for indefinite persisted retention

When a query retained with `mode: 'until-revalidated'` is requested again:

1. match the placeholder by canonical query identity
2. use persisted ownership as the baseline
3. run the query
4. diff server results against previously owned rows
5. remove rows that are no longer owned
6. clear or refresh the retention entry based on the new lifecycle state

This is the key behavior required for long offline periods.

### 8. Consider narrowing cleanup diff logic

As an implementation improvement, consider moving away from diffing against all
rows in `collection._state.syncedData` and instead diff against:

- the rows previously owned by the specific query

That is a more semantically accurate baseline and reduces dependence on unrelated
persisted rows already being present in the collection.

## Important design constraints

### Persisted retention is not freshness

Long-lived persisted data may be very stale.

That is acceptable as long as:

- re-requesting the query still follows normal query refetch behavior
- persisted retention does not imply anything about `staleTime`

### Infinite persisted retention needs explicit eviction eventually

If `persistedGcTime: Infinity` or `mode: 'until-revalidated'` is supported,
storage can grow without bound. This phase does not need to ship explicit
eviction APIs, but the design should leave room for:

- evict one query placeholder
- evict all query placeholders for a collection
- evict by age or storage-pressure policy

### Versioning matters

If query identity hashing or serialization changes across app versions, retained
placeholders may become unreachable.

The implementation should leave room for:

- metadata versioning
- collection-level invalidation of incompatible retained placeholders

## Edge cases to handle

- multiple overlapping queries owning the same row
- query unsubscribes and resubscribes before persisted retention cleanup runs
- query retained indefinitely while another query updates shared rows
- startup with only a subset of rows hydrated in on-demand mode
- placeholder exists but the same query is never requested again
- query identity serialization changes across versions
- metadata-only ownership updates with unchanged row values
- rows retained indefinitely while offline for a long period

## Acceptance criteria

- restart does not incorrectly delete persisted rows before ownership is restored
- row ownership survives restart
- query retention is persisted independently from `gcTime`
- `until-revalidated` retention keeps persisted rows available indefinitely
- re-requesting a retained query reconciles the retained rows correctly

## Suggested tests

- warm-start with multiple disjoint queries does not drop unrelated rows
- overlapping queries preserve shared row ownership across restart
- finite persisted retention expires and cleans up orphaned rows
- indefinite persisted retention survives restart and long offline gaps
- re-requesting an indefinite retained query reconciles deleted rows correctly
- in-memory `gcTime` expiry does not remove indefinitely retained persisted rows
- on-demand hydration reconstructs ownership for loaded subsets
- metadata-only ownership updates persist correctly

## Exit criteria

Phase 3 is complete when query collections can warm-start safely from persisted
data, preserve ownership across restart, and independently control durable query
retention for offline-first users.
