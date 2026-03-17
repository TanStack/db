# Phase 5: Test Plan

## Objective

Validate the persisted sync metadata design with invariants-focused tests across:

- core collection state
- SQLite persistence
- query collection restart and retention behavior
- Electric resume behavior

This plan is intentionally thorough. The feature crosses multiple layers and is
easy to get "mostly working" while still breaking on restart, replay, or long
offline gaps.

## Testing principles

- prefer behavior/invariant tests over implementation-detail tests
- add restart tests wherever durable state is introduced
- add crash-consistency style tests wherever atomicity is claimed
- test both eager and on-demand flows where behavior differs
- test replay/recovery paths, not just happy-path startup

## Invariants

### Core invariants

- metadata that is staged in a sync transaction is visible to reads in that same
  transaction
- metadata is committed iff the surrounding sync transaction commits
- metadata-only transactions are valid committed sync transactions
- row metadata and collection metadata are isolated but share the same commit
  boundary
- truncate clears row metadata but does not silently clear collection metadata

### SQLite invariants

- row values and row metadata are committed atomically
- collection metadata commits atomically with the same persisted tx
- hydrated rows restore both value and metadata
- old persisted databases without metadata remain readable

### Query collection invariants

- warm-start does not delete unrelated persisted rows before ownership is
  reconstructed
- row ownership survives restart
- query placeholder retention survives restart
- finite persisted retention expires correctly
- indefinite persisted retention does not expire due to in-memory `gcTime`
- re-requesting an indefinitely retained query reconciles retained rows
- retained rows may be stale, but they remain available until revalidation or
  explicit cleanup

### Electric invariants

- resume metadata advances iff the corresponding batch commits
- invalid resume metadata does not cause unsafe resume behavior
- metadata-only resume updates are persisted
- restart can use persisted resume metadata when valid

### Replay and recovery invariants

- follower tabs converge on metadata-bearing tx behavior
- sequence-gap recovery remains correct when metadata changed
- conservative reload fallback remains correct when targeted metadata replay is
  unavailable

## Test matrix

### Core API tests

Target files:

- `packages/db/tests/collection.test.ts`
- additional focused tests if needed

Cases:

- `metadata.row.set()` inside a transaction
- `metadata.collection.set()` inside a transaction
- read-your-own-writes for row metadata
- read-your-own-writes for collection metadata
- metadata-only commit
- metadata calls outside a transaction throw
- `write({ metadata })` and `metadata.row.set()` on the same row in one tx
- truncate behavior with row metadata present

### SQLite adapter and runtime tests

Target files:

- `packages/db-sqlite-persisted-collection-core/tests/sqlite-core-adapter.test.ts`
- `packages/db-sqlite-persisted-collection-core/tests/persisted.test.ts`
- runtime persistence contract tests

Cases:

- row metadata persists and hydrates
- collection metadata persists and loads
- metadata-only tx survives restart
- row delete removes row metadata
- migration from pre-metadata schema
- metadata-bearing tx replay correctness
- sequence-gap recovery with metadata changes

### Query collection integration tests

Target files:

- `packages/query-db-collection/tests/query.test.ts`
- new persisted integration tests as needed

Cases:

- multiple disjoint queries warm-start without deleting each other's rows
- overlapping queries preserve shared ownership across restart
- persisted ownership reconstruction in eager mode
- persisted ownership reconstruction in on-demand mode for loaded subsets
- finite persisted retention expiry
- `persistedGcTime: Infinity` or equivalent indefinite retention
- in-memory `gcTime` expiry does not remove indefinitely retained persisted rows
- re-requesting an indefinitely retained query reconciles stale/deleted rows
- query identity version mismatch / incompatible retained metadata fallback

### Electric integration tests

Target files:

- `packages/electric-db-collection/tests/electric.test.ts`
- `packages/electric-db-collection/tests/electric-live-query.test.ts`
- new persisted integration tests as needed

Cases:

- commit rows + resume metadata atomically
- failed commit does not advance resume metadata
- metadata-only resume transaction
- valid resume metadata used on restart
- invalid resume metadata triggers conservative fallback
- reset/must-refetch clears or invalidates resume metadata
- row metadata survives SQLite hydration

## Suggested delivery cadence

### While implementing Phase 1

Add:

- core transaction semantics tests
- metadata-only transaction tests

### While implementing Phase 2

Add:

- SQLite schema and hydration tests
- adapter atomicity tests
- runtime restart tests

### While implementing Phase 3

Add:

- query ownership restart tests
- finite retention tests
- indefinite retention tests
- long-offline warm-start tests

### While implementing Phase 4

Add:

- resume metadata tests
- metadata-only resume tests
- invalid resume fallback tests

## Failure modes the tests must catch

- persisted rows exist but metadata is missing after restart
- metadata exists but corresponding rows were not committed
- query warm-start deletes rows it does not own
- rows retained indefinitely disappear because in-memory GC elapsed
- startup GC races with new subscriptions
- follower runtimes diverge because metadata-bearing txs were not replayed
- Electric resumes from a token that was never durably committed

## Definition of done

This plan is complete when:

- each phase ships with the tests listed for that phase
- restart, replay, and retention invariants are covered
- the long-offline persisted query use case is explicitly validated
- metadata atomicity is tested, not just assumed
