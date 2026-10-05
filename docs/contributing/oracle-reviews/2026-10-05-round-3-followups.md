# State mutation round 3 follow-ups

Base revision: `cfb03f201` (`main` after #2032 and #2033).

This record closes the four items that the round 3 record and the
ready-callback truncate record left open. Two are bug fixes. The other two
keep their code: review found histories where it still matters.

## 1. Metadata rebuild after a canceled earlier transaction

**Gap.** The round 3 record called RB2, a mutant that keeps stale automatic
metadata writes through a rebuild, equivalent within legal histories. Reaching
it needs a canceled earlier transaction, which the grammar did not generate.

**Witness.** The metadata composition oracle gains a canceled lane. An earlier
held transaction deletes key 1, the open transaction writes against that
projection, and the earlier one is canceled before the open one commits. An
insert onto the row the source still holds then becomes an idempotent
re-insert, and the model reads it as one. RB2 fails this lane, so it was not
equivalent.

**Bug.** `main` also fails the lane. An explicit `metadata.row.set` followed by
such an insert read `undefined`, where last write wins keeps the explicit
value. The rebuild skipped every key with an explicit write, so it kept the
insert's automatic delete even after the insert became a re-insert.

**Repair.** A transaction records each key's last explicit write with its
position among the operations, and the rebuild replays the operations in
order. A rebuild without reclassification gives the same writes as before.
Mutants that skip clearing stale writes, or that ignore the explicit write's
position, fail the oracle.

## 2. A ready callback error from a sync-entry truncate

**Gap.** During sync entry, `ops.markReady()` deferred a ready callback's error
until the sync function returned. A truncate committed inside the sync
function threw the same error from `commit()`. The rest of the sync function
never ran, and the Collection moved to `error`.

**Witness.** The sync reentrancy oracle runs a throwing `onFirstReady` callback
with `markReady`, a truncate commit, and a truncate commit followed by
`markReady`. The sync function must finish, the Collection must stay ready with
its rows, and the error must surface when sync entry returns. The two truncate
cases fail on `main`.

**Repair.** The lifecycle holds ready-effect failures while a sync function
runs, whichever path makes the Collection ready, and sync entry reports the
first one when it returns. This replaces `markReadyDuringSyncStart` and the
per-entry flag that chose between two `markReady` calls.

## 3. The sync commit's virtual props cache delete

**Finding.** The round 3 record reported 422 reads that returned a cached
enriched row whose fields differed from the stored row. Those came from
comparing `NaN` with `!==`. With `Object.is`, instrumentation found no such
read across the `@tanstack/db` suite, with or without the delete.

**Outcome: kept.** A first revision removed the delete. A high-effort review
then showed that the suite runs only in development builds, where the
reused-row check rejects an in-place change without `previousValue`. In a
production build that write is accepted and publishes no update, so only the
commit's delete keeps reads fresh. A deferred publication also enriches late.
New cases in `virtual-props-cache.test.ts` stub production mode for that write
and read inside a deferred publication. Both fail without the delete, so it
stays.

## 4. The sync commit's completed optimistic keys

**Finding.** The mutant that ignores `completedOptimisticKeys` changed 191
decisions, all in the metadata publication oracle, and that oracle's exact
batch check still passed. The recompute after a transaction's completion
publishes the same `$synced` change.

**Outcome: kept.** A first revision removed the set, and the stress runs at ten
times their counts passed. A high-effort review then described a history where
the set still matters: a sync commit captures a key, the key's transaction
completes before the capture clears, its recompute drops the layer and filters
the key's event, and a later sync with an equal value publishes no `$synced`
change. A probe over several completion orders did not reach it, and passing
runs cannot rule it out, so the set stays. The coverage map records the needed
witness.

## Review of this record

A high-effort review found nine items.

1. The cache delete still mattered in production builds. Reverted, with
   witnesses that fail without it.
2. Insert-shaped and deferred publications of a reused row read the cache
   late. The deferred-publication witness covers the second; the delete covers
   both.
3. A history may still need `completedOptimisticKeys`. Reverted; open for a
   witness.
4. A ready failure held during sync entry is dropped if the sync function then
   throws. `ops.markReady()` already behaves this way on `main`, so the
   truncate path now matches it. No change.
5. The ready failure sink restored an outer sink that cannot exist. Removed.
6. A cache comment described the removed delete. Resolved by the revert.
7. The rebuild replay had a simpler equivalent form. Adopted; the two rebuild
   mutants still fail.
8. A hydration transaction rebuilt through a cancellation could lose its
   metadata. A probe of the described route kept the metadata. Open, with no
   change, until a witness reaches it.
9. The first reused-row witness had no demonstrated kill. Replaced by the
   production and deferred cases.

The simplifier pass suggested one helper for the explicit metadata write,
which `metadata.row.set` and `metadata.row.delete` now share.

## ORC outcomes

- **ORC-001: met.** Items 1 and 2 cite the last-write-wins contract with the
  2026-10-05 maintainer decisions, and the deferred ready-failure contract of
  `ops.markReady()`. Items 3 and 4 change no contract.
- **ORC-002: met.** The canceled lane uses the oracle's fold model. The
  sync-entry witness and the reused-row witnesses expect fixed outcomes. None
  reads production state.
- **ORC-003: met.** The canceled lane's prose explains the cancellation and
  the re-insert mapping. The sync-entry witness and the reused-row witness
  state their laws beside the code.
- **ORC-004: met.** A control checks that the canceled lane reaches a bare
  re-insert after the earlier delete.
- **ORC-005: met.** Each witness runs a real Collection through its sync API
  and observes `metadata.row.get`, `collection.status`, `collection.state`, or
  public reads and change messages.
- **ORC-006: met.** RB2, the two rebuild mutants above, and `main` fail the
  canceled lane. `main` fails the sync-entry truncate cases. Removing the
  cache delete fails the production and deferred reused-row cases.
- **ORC-007: met where generated.** The stress runs used the existing fixed
  and random campaigns at ten times their counts. The new lanes are
  enumerations.
- **ORC-008: not applicable.** No stateful model changed.
- **ORC-009: met.** "Canceled earlier transaction" means a sync transaction
  committed with an abort signal and aborted before application.
- **ORC-010: met.** Each witness cleans up its Collection in a `finally`
  block.
- **ORC-011: not applicable.** No reviewer named a shared fault.
- **ORC-012: met by this record.**
- **ORC-013: met.** The canceled lane sits beside the rebuilt lane, which
  keeps the earlier transaction. The sync-entry witness keeps `markReady` as
  the control case.
- **ORC-014: not applicable.** No controlled provider or host supplies a
  premise.
