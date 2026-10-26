# State mutation round 3 follow-ups

Base revision: `cfb03f201` (`main` after #2032 and #2033).

This record closes the four items that the round 3 record and the
ready-callback truncate record left open. One is a bug fix. The cache delete
stays, with witnesses. #2030 on `main` made the other two unnecessary.

## 1. Metadata rebuild after a canceled earlier transaction

**Gap.** The round 3 record called RB2, a mutant that keeps stale automatic
metadata writes through a rebuild, equivalent within legal histories. Reaching
it needed a canceled earlier transaction, which the grammar did not generate.

**Correction, 2026-10-06.** The outcome below is wrong. A transaction begun
inside an open one can still commit first, and the rebuild then reclassifies
the open one's inserts. `main` loses last-write-wins there. See
[`2026-10-06-nested-begin-metadata-rebuild.md`](2026-10-06-nested-begin-metadata-rebuild.md).

**Outcome: made unnecessary by #2030.** A first revision of this branch added a
canceled lane to the metadata composition oracle. An earlier held transaction
deleted key 1, the open transaction wrote against that projection, and the
earlier one was canceled. The lane found that `main` lost an explicit
`metadata.row.set` when the canceled delete turned the open insert into an
idempotent re-insert, and the revision fixed the rebuild.

PR #2030 then allowed only the open last sync transaction to be canceled. Aborting
an accepted transaction's signal now has no effect, so a rebuild can no longer
reclassify an open write. The canceled lane's history no longer exists, and RB2
is equivalent again. This branch drops the lane and the rebuild change and
keeps `main`'s rebuild.

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

**Outcome: removed by #2030.** A first revision of this branch removed the set,
and review then described a history where it might still matter, so the
revision restored it. #2030 drops optimistic state at settlement and removed
the set on `main`.

## Review of this record

A high-effort review found nine items.

1. The cache delete still mattered in production builds. Reverted, with
   witnesses that fail without it.
2. Insert-shaped and deferred publications of a reused row read the cache
   late. The deferred-publication witness covers the second; the delete covers
   both.
3. A history may still need `completedOptimisticKeys`. Reverted, then
   removed on `main` by #2030.
4. A ready failure held during sync entry is dropped if the sync function then
   throws. `ops.markReady()` already behaves this way on `main`, so the
   truncate path now matches it. No change.
5. The ready failure sink restored an outer sink that cannot exist. Removed.
6. A cache comment described the removed delete. Resolved by the revert.
7. The rebuild replay had a simpler equivalent form. Adopted, then dropped
   with the rebuild change after #2030. The 2026-10-06 nested-begin fix
   restores it.
8. A hydration transaction rebuilt through a cancellation could lose its
   metadata. #2030 marks hydration metadata as explicit, which fixes it on
   `main`.
9. The first reused-row witness had no demonstrated kill. Replaced by the
   production and deferred cases.

The simplifier pass suggested one helper for the explicit metadata write,
which `metadata.row.set` and `metadata.row.delete` now share.

## ORC outcomes

- **ORC-001: met.** Item 2 cites the deferred ready-failure contract of
  `ops.markReady()`. Item 3 cites the reused-row contract: reads return a
  row's current value. Items 1 and 4 change no code here.
- **ORC-002: met.** The sync-entry and reused-row witnesses expect fixed
  outcomes and read no production state.
- **ORC-003: met.** Each witness states its law beside its code.
- **ORC-004: not applicable.** No generated grammar changed.
- **ORC-005: met.** Each witness runs a real Collection through its sync API
  and observes `collection.status`, `collection.state`, and public reads.
- **ORC-006: met.** `main` fails the two sync-entry truncate cases. Removing
  the cache delete fails the production and deferred reused-row cases.
- **ORC-007: not applicable.** The witnesses are fixed cases.
- **ORC-008: not applicable.** No stateful model changed.
- **ORC-009: met.** "Sync entry" means the synchronous run of the sync
  function inside `startSync`.
- **ORC-010: met.** Each witness cleans up its Collection in a `finally`
  block.
- **ORC-011: not applicable.** No reviewer named a shared fault.
- **ORC-012: met by this record.**
- **ORC-013: met.** The sync-entry witness keeps `markReady` as the control
  case. The reused-row witnesses sit beside the existing cases that declare
  `previousValue` and publish at once.
- **ORC-014: not applicable.** No controlled provider or host supplies a
  premise.
