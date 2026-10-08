# Failed transaction retention review

Evidence by revision, on `fix-failed-transaction-retention`, based on
`origin/main` `2ab7f3e55`:

- First campaign: oracle commit `fb9a682e9`, fix `89de5ea0a`. It removed a
  transaction in both `isPersisted` handlers.
- Review follow-up: `f777321fd` (tests) and `64f1c1045` (fix), plus
  `8274b81f3`, which keeps an owned transaction's unobserved rejection
  handled. They move removal into the recompute pass, remove
  `scheduleTransactionCleanup`, and make `touchCollection()` recompute every
  Collection before it rethrows. The mutant results and CI counts below ran on
  `8274b81f3`. The
  RED results for findings 1, 2 and 5 below were run on `89de5ea0a`, and
  finding 5 also on `2ab7f3e55`.
- Medium-review follow-up (PR head `609e97162`, findings M1–M10 below): the
  owning-Collection set, removal in the overlay pass, settlement that survives
  a throwing conflicting rollback, and the transaction-ownership oracle. RED
  runs used `609e97162` and `origin/main` `07ffcfe47`.

## Contract and evidence

A Collection tracks its optimistic transactions in `state.transactions`. Every
per-mutation pass walks that map: `recomputeOptimisticState`,
`overlayActiveTransactions`, `hasPersistingTransaction`,
`commitLocalOnlyDirect`, and the Query Collection's
`isMutationPublicationBlocked`. A settled transaction must leave the map,
whether it succeeded or failed. Otherwise per-mutation cost grows with history,
not with live work.

The law has three parts:

1. After its Collections recompute, a Collection tracks exactly its unsettled
   transactions. A completed row that a queued sync transaction still holds
   stays in the held-row layer (`heldOptimisticRows`), which records it during
   the recompute. The transaction itself does not stay tracked for it.
2. Removing an entry never removes a different transaction. `createTransaction`
   accepts a caller id, and offline restoration reuses ids, so two
   transactions can share an id over time.
3. One mutation's work does not depend on how many transactions settled
   before it.

Authority: no reader needs a settled transaction. Every loop over the map skips
`failed` entries. A completed entry is read once, by the recompute that
records its held rows. Readers outside `packages/db` are the offline-transactions
restore path and an Electric test that reads a completed transaction.

## Design

Removal now happens in `recomputeOptimisticState`. The pass that records a
completed transaction's held rows collects every settled entry and deletes those
entries after the loop. Deleting during the loop would skip the next entry,
because `SortedMap.delete` splices the key array that the loop iterates.

Every way into the map settles through a recompute: a commit or rollback calls
`touchCollection()`, and offline restoration calls `rollback()` or recomputes
itself. So the sweep covers offline restoration without a separate cleanup
path. `scheduleTransactionCleanup` and its per-`mutate()` handler registrations
are gone.

The sweep deletes by map entry, so a same-id successor that replaced its
predecessor's entry stays tracked.

The removed `isPersisted` handlers also kept a rejected `isPersisted` promise
from reaching `unhandledrejection`, as `main` does. A Collection now marks the
promise handled once, when it first owns the transaction. Without that, the db
and offline-transactions suites reported 48 and 154 unhandled rejections while
every test passed.

`touchCollection()` now recomputes every Collection of a settled transaction
before it rethrows the first error. Before, a throwing subscriber in one
Collection left the next Collection showing the settled transaction's
optimistic row. This was a pre-existing visibility bug.

## Oracle changes

- The optimistic-history driver (`optimistic-history-oracle.ts`) now checks,
  after every step, that `collection._state.transactions.size` equals the
  model's persisting transactions. The first campaign used "at most persisting
  plus held", which could hide a retained failed transaction while a held one
  existed, and could not detect an early removal. The opening prose states the
  law.
- `collection.test.ts` adds these focused witnesses:
  - 200 rejected updates and manual rollbacks leave nothing tracked.
  - One mutation counts the same Map and Set steps, including `Map#get`, after
    0 and after 200 rollbacks. This is the public cost law; it does not read
    the internal map.
  - A same-id successor stays tracked and visible after its predecessor rolls
    back.
  - Three transactions that settle before one recompute all leave the map.
  - A rollback across two Collections recomputes the second Collection when
    the first one's subscriber throws.
- `offline-e2e.test.ts`: a restored transaction that fails permanently is no
  longer tracked after its rollback.

## Results

| Check | Before | After |
| --- | --- | --- |
| Optimistic oracles, 6 files | `origin/main`: 37 of 323 fail at a failed settle | 556 pass with the exact law |
| Same-id successor | `89de5ea0a`: `expected undefined to be Transaction`; `2ab7f3e55`: pass | Pass |
| Offline restoration rollback | `89de5ea0a`: `expected 1 to be +0` | Pass |
| Two-Collection rollback with a throwing subscriber | `89de5ea0a` and `2ab7f3e55`: the second Collection keeps the rolled-back row | Pass |
| Tracked after 200 rollbacks | `origin/main`: 200; `89de5ea0a`: up to 49 between flushes | 0 |

The first campaign measured 4,000 mutate and rollback cycles on 10k rows: the
median per cycle for the last 200 cycles was 0.67–0.94 ms on `origin/main` and
0.008 ms on the branch. `scripts/bench/incremental-update.ts` gave a write
geomean of 0.88× and 0.84× against `origin/main`, with same-code noise at 1.03×.
The bench rolls back after each optimistic iteration, so its numbers on `main`
include this leak.

## Mutants

All mutants ran on the follow-up revision.

| Mutant | Outcome (ORC-006) |
| --- | --- |
| Remove by id when `isPersisted` settles (the first campaign's design) | Assertion failure: the same-id witness |
| Failed transactions never removed | Assertion failure: 51 tests, the offline witness, and the work witness (443 steps against 34) |
| Keep a failed transaction while a held sync transaction exists | Assertion failure: 24 tests |
| Remove a persisting transaction early | Assertion failure: 91 tests |
| Delete settled entries during the recompute loop | Assertion failure: the adjacent-settled witness only. The generated grammar never settles two transactions before one recompute. |

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The law and authority are above. The claim covers a Collection's tracked transactions; it does not bound transaction-scope state in `transactions.ts`. |
| ORC-002 | Applicable. The expected count comes from the model's transaction states, not from production. |
| ORC-003 | Applicable. The opening prose of the history oracle states the law beside the model, and the driver states the observation. |
| ORC-004 | Applicable, with gaps. The history grammar generates failed settles, cascading rollbacks, held sync transactions and truncates over one Collection. The ownership grammar adds two Collections, merged-away pairs, truncate-listener rollbacks and throwing subscribers. Same-id instances, offline restoration and two settlements before one recompute have focused witnesses. |
| ORC-005 | Applicable. The driver reads `_state.transactions`, the semi-public observation used by `collection.test.ts` and the local-only direct-write oracle. The work witness checks the public cost law without that field. |
| ORC-006 | Applicable. See the mutant table. |
| ORC-007 | Applicable. The history campaigns keep their fixed and random seeds. The ownership oracle runs a fixed seed (2080) and a random or replayed seed through `oraclePropertyOptions`, with the same property and budget. |
| ORC-008 | Applicable. The ownership model keeps each transaction's owning Collections separately from its writes, because a merged-away pair leaves an owner with no write; the pinned history distinguishes them. |
| ORC-009 | Applicable. "Unsettled" maps to the glossary's persisting state; the model has no separate pending state. |
| ORC-010 | Applicable, with a gap. The ownership driver cleans up in `finally`, so a cleanup error after an assertion failure replaces it. No run showed a cleanup failure. |
| ORC-011 | Applicable. The reviewer named a shared fault: an id-keyed removal. The same-id witness is the independent check. |
| ORC-013 | Inapplicable. No threshold law. |
| ORC-014 | Inapplicable. No controlled provider. |

## Medium-review follow-up

The review of `609e97162` found that removal reached only the Collections that
the transaction's current mutations touch, while the removed `isPersisted`
cleanup had reached every Collection that ever tracked it.

| ID | Finding | RED | Fix |
| --- | --- | --- | --- |
| M1 | A conflicting transaction's rollback throws, so the primary never settles | `tx1Settled:false, bValue:1, bTracksTx1:true` on `609e97162` and `main` | `rollback()` runs every step and reports their errors together |
| M2 | Mutations that merge away leave the Collection tracking the transaction | Tracked after commit on `609e97162`; released on `main` | The transaction records each Collection that tracked it; settlement, including an empty commit, recomputes all of them |
| M3 | Two Collection instances with one id | The first instance keeps the transaction on `609e97162`; both keep it on `main` | `touchCollection()` reaches instances, not ids |
| M4 | A rollback in a `truncate` listener during a sync commit | Tracked on `609e97162` and `main` | Removal moved into `overlayActiveTransactions`, which the sync commit calls after it skips recomputes |
| M5 | Only the first settlement error survives | — | One error rethrows as is; several throw an `AggregateError`, like `mutate()` |
| M6 | The history oracle compared a count | A wrong-identity removal could keep the count | It compares transaction ids |
| M7 | The offline witness yielded a microtask before asserting | — | The yield is gone; the row and the entry leave in one recompute |
| M8 | The work witness patched `Map` and `Set` globally and asserted equality | — | It counts walks of the Collection's own `transactions`, warms up first, and asserts a bound |
| M9 | `as any` in the work witness | — | `Reflect.get` and `Reflect.set` |
| M10 | Each removal splices `sortedKeys` | — | Kept. A recompute normally removes one entry. A local measurement deleted k entries from a `SortedMap` of n: at n = 1,000 and k = 1, splicing took 1.3 ms against 64 ms for a deferred rebuild over the same 2,000 runs; splicing stays cheaper until k nears n / 10. |

The transaction-ownership oracle
(`packages/db/tests/transaction-ownership-oracle.property.test.ts`, registered
as `transaction-ownership.settlement-release`) owns the law across two
Collections. It runs a fixed campaign (seed 2080) and a random or replayed
campaign, 200 runs each, plus a pinned history. Its grammar covers writes, a
pair that merges away, commits, successful and failed settlements, rollbacks,
truncate-listener rollbacks, and a throwing subscriber during a settling step.
After each synchronous settling step it compares the tracked ids in the same
call stack, then compares tracked ids, rows and `isPersisted` settlement after
promises flush. The model's first draft treated an update that keeps the
visible value as a write; production creates no mutation for it, which the
contract permits, so the model now skips it.

| Mutant | Outcome |
| --- | --- |
| A persisting transaction counts as settled | Assertion failure, 15 tests |
| Only the current mutations' Collections recompute | Assertion failure: all three ownership campaigns and the same-id witness |
| `touchCollection()` deduplicates by Collection id | Assertion failure: the same-id witness only |
| No removal during a sync commit | Assertion failure: all three ownership campaigns |
| A conflicting rollback's throw skips the primary's settlement | Assertion failure: the pinned ownership history only |
| Removal one microtask late | Assertion failure: the same-call checks and two focused witnesses |
| Never remove (`main`) | Assertion failure, 28 tests |

## Low-review follow-up

A low review of `26d34291d` found that the ownership driver removed its
throwing subscriber in a synchronous `finally`, before a commit's settlement
resumed in a later microtask. A subscriber therefore never threw during an
asynchronous success or failure settlement. Measuring the reach showed a wider
gap: steps chose a transaction index from 0 to 3 at random, so most pointed at
a missing transaction or one in the wrong state, and in one run the `settle`
step ran 0 times in 400 histories.

The driver now keeps the subscriber installed until promises flush, and it
asserts that the subscriber ran whenever the model predicts that the step
changes that Collection's rows. A step's `tx` number now chooses among the
transactions whose state allows the step, and settle and commit steps are
weighted higher. A pinned history throws during an asynchronous success and an
asynchronous failure settlement.

| Check, on `cb9f8a47b` production code | Result |
| --- | --- |
| New driver | All 4 cases pass; no production defect |
| Old subscriber ordering with the new invocation assertion | The random campaign fails: `the throwing subscriber ran: expected 0 to be greater than 0`, at an asynchronous failed settlement |
| Mutant: success settlement skips `isPersisted` when a subscriber throws | New driver: assertion failure in the random campaign and the asynchronous pinned history. Old driver: survives |
| Mutant: `touchCollection()` stops at the first throwing Collection | New driver: assertion failure in the asynchronous pinned history. Old driver: its random campaign can also reach it through the synchronous rollback path, so this mutant does not distinguish the drivers |

The fixed seed alone does not catch the first mutant; the pinned history is the
reliable witness for asynchronous settlement with a throwing subscriber.

## Medium review round 2 (reviewed head `7fd5de08b`)

Probes on `7fd5de08b` and on `main` `fe284ccbd`, from a scratch probe file:

| Finding | `7fd5de08b` | `main` | Disposition |
| --- | --- | --- | --- |
| A second live transaction with the same id evicts the first | First evicted; its row shows `0`, not `5` | Same | Fixed: `trackTransaction` throws `DuplicateTransactionIdError` (code 233) before applying. Ids are documented as unique (`TransactionConfig.id`) |
| `TransactionScope` removes by id | Settling `t2` removed live `t1`; a later conflicting rollback left `t1` pending | Same | Fixed: removal by identity |
| `commit()` loses the mutation error when a rollback subscriber throws | Rejects with the subscriber error | Same | Fixed: one flat `AggregateError`, mutation error first and as `cause` |
| Nested `AggregateError` from conflicting rollbacks | Pinned history: `flat aggregate: expected true to be false` | Only the first error escapes | Fixed: internal settlement steps return flat error lists |
| A settled transaction keeps its Collections | `collections.size` is 1 after settlement | No such field | Fixed: settlement clears the set |
| Offline restoration bypasses ownership and removes by id | By source | Same | Fixed: restoration uses `trackTransaction`, and its cleanup settles through `touchCollection()` |
| Release depends on a recompute | Could not make the capture step throw during settlement; by source, the next recompute or sync-commit end sweeps a skipped release | Main never releases | Refuted as a permanent skip; a transient residue until the next recompute is accepted |

The ownership oracle gained:

- an error-shape law, checked for each settling call and each commit rejection
  against the subscriber errors the step raised, with throwing subscribers on
  one or both Collections;
- an `open` that reuses an earlier id, with the duplicate-id rule in the model;
- a `mutate()` callback that writes and then throws;
- a retention observation: a settled transaction holds no Collection;
- identity comparison of tracked transactions;
- four pinned histories (scope identity, duplicate id, flat aggregate,
  commit error).

A focused witness covers a Collection cleaned up before its transaction
settles.

All before the fix, on the oracle above: 8 of 8 cases failed on `7fd5de08b`.
After the fix: 8 of 8 pass.

| Mutant | Result |
| --- | --- |
| Swallow settlement errors | Assertion failure, 5 tests |
| Always wrap errors | Assertion failure, 4 tests |
| Throw only the first error | Assertion failure, 2 tests |
| Scope removes by id | Assertion failure, 1 test (the pinned scope-identity history) |
| Overwrite a live same-id transaction | Assertion failure, 3 tests |
| Keep `collections` after settlement | Assertion failure, 7 tests |
| `commit()` rethrows settlement errors instead of keeping the mutation error | Assertion failure, 2 tests |

The optimistic-history oracle's tracked-transaction check counted only
persisting transactions as unsettled. `main`'s pending manual edits (#2078)
showed that the model was wrong, not production: a pending transaction is
tracked. The check now counts pending and persisting transactions.

## Unresolved

- The generated ownership grammar reaches a conflicting rollback that throws,
  and an asynchronous settlement with a throwing subscriber, only sometimes;
  the pinned histories are their reliable witnesses.
- Two Collection instances with one id, and a Collection cleaned up before
  its transaction settles, are covered only by focused witnesses.
- Offline restoration's tracking path is covered by offline-transactions'
  witnesses, not by the ownership oracle.
- The ownership oracle does not combine queued sync transactions that hold a
  completed row with a second Collection. The optimistic-history oracle owns
  held rows for one Collection.
- The per-mutation pass is still O(unsettled transactions). A key-scoped
  recompute would remove that term, but it touches every settlement law.
