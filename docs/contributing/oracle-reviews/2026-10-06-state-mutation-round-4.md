# State stack mutation round 4

Revisions:

- Mutation campaign: the 53 mutants ran on `de8d0f1bf` (`main` after #2040).
- Witnesses: the first versions ran on `2376eb581` (`main` after #2048). The
  first review's fixes ran on `d57be3d6f`, and its merge of `main` on
  `5a24b9025`.
- Second review: its fixes are in `7bc58cfab`, on `5a24b9025`.
- Third review: its fixes are in the commit that adds this line, on
  `7bc58cfab`. The X7 results ran on that commit.

This branch changes no production code.

## Method

Round 4 applied 53 plausible maintenance mistakes to unchanged `main`: 23 in
`state.ts`, 15 in `sync.ts`, 6 in `mutations.ts`, 4 in `lifecycle.ts`, 3 in
`sync-receipt.ts`, and one each in the lazy `state` getters of
`live-query-observer.ts` and `live-query-window-controller.ts`. Each mutant
ran against the full `@tanstack/db` suite with `--bail=1`. Of the 53, 44
failed the suite and 9 survived. Each survivor received a probe that runs on
`main`, a code argument, or full-suite instrumentation.

Triage also found a bug on `main`. A sync transaction begun inside an open
one could commit first and make the rebuild lose last-write-wins row
metadata. #2048 fixes it, and its record corrects the round 3 claim that the
history was unreachable.

## Survivors

| Mutant | Change | Verdict |
| --- | --- | --- |
| SY8 | `write` stages writes into a transaction that a replay invalidated | Gap. Closed here. |
| SY13 | A stale sync run's `commit` returns `false` | Gap. Closed here. |
| X3 | A receipt with no acceptance moment counts as accepted at once | Gap. Closed here. |
| X4 | The observer snapshot builds a new `state` map on every read | Gap. Closed here. |
| X5 | The window snapshot copies `state` on every read | Gap. Closed here. |
| ST27 | Dropping a held row keeps its pending local origin | Equivalent. The branch is unreachable. See below. |
| ST16 | Recompute copies `rowOrigins` instead of keeping a reference | Equivalent by argument. Recompute writes no origin before it reads the reference. |
| ST17 | The origin snapshot stores `undefined` for keys without an origin | Equivalent. Every reader treats a missing origin as `remote`. |
| SY18 | A missing `loadSubset` returns `false` | Equivalent. The caller resolves a non-promise result the same way. |

## Gaps closed here

**Writes after invalidation (SY8).** After a replay invalidates the open
transaction, `write` returns early. Without that guard, a late write enters
the pending projection, and a newer transaction classifies its own inserts
against it. A probe on `main` showed the effect. A late insert of key 9 made
a newer, valid insert of key 9 throw `DuplicateKeySyncError`, and row 9 was
lost. Two witnesses in `collection-state-retention-oracle.property.test.ts`
write a late insert and a late delete. The newer transaction must see only
the accepted row. Both fail under SY8.

**A stale run's commit (SY13).** The retention oracle's lifecycle driver
committed from an old run only while that run was still current. Now the old
run also writes and commits a row after cleanup ends it, at two points: after
a plain `restart`, and while a reentrant restart's new transaction is still
open. The commit must return `true`, and the row must not appear. The fixed
and random retention campaigns fail under SY13. A mutant that routes a stale
run's write into the new run's open transaction fails both pinned
`afterOldReturn` histories, because the row appears. After a plain restart no
transaction is open, so there a stale write fails only by throwing.

**Acceptance of an abandoned receipt (X3).** A commit that core never
accepts, because its signal was aborted or a replay invalidated it, returns a
bare receipt with no acceptance moment. `whenSyncAccepted` must then wait for
that receipt, which rejects. The optimistic-history oracle's aborted batches
and the retention oracle's invalidation replay now check that the acceptance
moment rejects too. Under X3, the invalidation replay, the open-at-settlement
histories, and the fixed and random optimistic-history campaigns fail. X3 also
reaches every adapter that calls `whenSyncAccepted` on a core receipt:
SQLite persistence, Query DB, Electric, and PowerSync. Under X3 those callers
would treat an abandoned write as accepted. This review did not run their
suites under X3. The core witnesses above own the fallback rule.

**State identity (X4, X5).** Before #2043, `state` was a field of the
snapshot. The lazy getter must keep that identity: one snapshot has one
`state` map. Consumers that compare by identity, such as a React dependency
list, rely on it. The snapshot oracle now checks that a second read of `data`
and `state` returns the first read's objects. Five of its six tests fail
under X4. The sixth is the calibration test, which replaces the `state`
getter. `data` is a plain field today, so its identity check has no
demonstrated kill. It guards a future lazy `data`. A witness in
`live-query-window-controller.test.ts` checks the window snapshot and fails
under both X4 and X5.

The second review found X6, which shares one map per observer and refills it
on every read. Each read then looks right on its own, so X6 passed. Now the
oracle saves every map it reads and checks each one again after all reads.
Snapshots with different rows must also have different maps. The window
witness fetches a page and checks that the newer revision has its own map and
the older map is unchanged. Under X6, five of the six snapshot tests and the
window witness fail.

A third review found X7, a single cache entry on the observer. It builds a
new map whenever a different snapshot is read, so a later read of an earlier
snapshot returns a new map with the same rows. X7 passed every check above.
Now the oracle reads each snapshot again after all reads and requires the map
that its first read returned. The window witness reads the older snapshot
again after the newer one. Under X7, the same six tests fail.

## ST27: an unreachable branch

`recomputeOptimisticState` keeps a completed optimistic row only while a
committed, queued sync transaction touches its key. It drops a held row whose
key no longer has such a transaction, and ST27 skips the origin delete in that
branch. A committed transaction leaves the queue only by applying, and the
commit path then clears the held row and the pending local origin for each of
its keys. A cleanup reset clears both maps. So no reached history takes the
branch. Full-suite instrumentation agrees. A log write in the branch fired 0
times across 249 files and 8,578 tests. A log write at the loop entry fired 55
times in two of those files. The branch is a code-weight candidate. Its
removal belongs with the cuts, with this argument as its evidence.

## Other finding

The window snapshot's `state` is the observer's `state`, so it includes the
peek-ahead row that `data` omits. `useLiveInfiniteQuery` in React returns that
map. This predates #2043. This review does not decide whether `state` should
match `data`.

## Review

A medium code review found eight items. Each is fixed here.

1. A commit hook's ESLint run removed a type assertion from the snapshot
   oracle, and `tsc` then failed. The setup now passes type arguments.
2. The record said X3 cannot reach the persistence packages. It can reach
   every adapter that calls `whenSyncAccepted`. Corrected above.
3. The window witness did not clean up in a `finally` block. Fixed.
4. The stale-run row check could not fail on its own after a plain restart.
   The driver now also writes from the ended run while a new transaction is
   open, and a routing mutant fails there.
5. The `data` identity check has no demonstrated kill. Stated above.
6. Reentrant restarts never reached the stale commit. Fixed with item 4.
7. The snapshot oracle has six tests, not five. Corrected.
8. The SY8 witnesses did not check their premise. They now check that the
   open transaction is invalid before the late write.

## Second review

A second code review, of `5a24b9025`, found two items.

1. The record named the tested revision as "this branch on `2376eb581`",
   but later commits changed the witnesses. Fixed: the revisions above name
   each run.
2. X6, a map shared across snapshots, passed the identity checks. Fixed: the
   saved-map and cross-revision checks under "State identity" above.

## Third review

A third review, of `7bc58cfab`, found one item. The saved-map checks did not
read a snapshot again after another snapshot was read, so X7 passed. Fixed:
the identity checks under "State identity" above.

CodeRabbit then asked for the same recheck of `data`. The oracle now saves
each first read's `data` too and requires it on the later read. `data` is a
plain field today, so this check has no demonstrated kill.

## ORC outcomes

- **ORC-001: met.** SY8 follows the comment on the guard: a commit receipt
  owns the invalidation, and later writes cannot revive it. SY13 follows
  the stale-run rule in the retention oracle's opening prose, which now
  states the commit result. X3 follows the `whenSyncAccepted` contract. X4
  and X5 follow the snapshot oracle's point-in-time contract, which now
  states identity.
- **ORC-002: met.** The witnesses expect fixed outcomes or use the existing
  independent models.
- **ORC-003: met.** Each change has prose beside its code.
- **ORC-004: met.** The `restart` and `reentrantRestart` actions are in the
  existing generated grammar. Every plain restart and every `afterOldReturn`
  reentrant restart reaches the stale commit. An `insideListener` reentrant
  restart commits the new run inside the listener, so no open transaction
  remains for a stale write to reach. The other changes add observations,
  not grammar.
- **ORC-005: met.** Each witness drives a real Collection, observer, or
  window controller and observes public results.
- **ORC-006: met.** Each closed mutant fails the tests named above.
- **ORC-007: met.** The retention and optimistic-history oracles run fixed
  and random campaigns with seed and path replay.
- **ORC-008: not applicable.** No model gained state.
- **ORC-009: met.** "Acceptance moment" is the value `whenSyncAccepted`
  returns.
- **ORC-010: met.** Each witness cleans up its Collection, live query, or
  controller in a `finally` block.
- **ORC-011: not applicable.**
- **ORC-012: met by this record.**
- **ORC-013: met.** The SY8 witnesses cover both directions of the leak: one
  makes a valid insert throw, and one lets a duplicate insert pass. Each
  first checks that the replay already invalidated the open transaction.
- **ORC-014: not applicable.**
