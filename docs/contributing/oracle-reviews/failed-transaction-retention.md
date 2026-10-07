# Failed transaction retention review

Evidence by revision, on `fix-failed-transaction-retention`, based on
`origin/main` `2ab7f3e55`:

- First campaign: oracle commit `fb9a682e9`, fix `89de5ea0a`. It removed a
  transaction in both `isPersisted` handlers.
- Review follow-up: the commit that adds this revision of the record. It moves
  removal into the recompute pass, removes `scheduleTransactionCleanup`, and
  makes `touchCollection()` recompute every Collection before it rethrows. The
  RED results for findings 1, 2 and 5 below were run on `89de5ea0a`, and
  finding 5 also on `2ab7f3e55`.

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
| ORC-004 | Applicable, with gaps. The grammar generates failed settles, cascading rollbacks, held sync transactions and truncates. It uses one Collection and one mutation per transaction, so it never generates a transaction across two Collections, a same-id successor, offline restoration, or two settlements before one recompute. Focused witnesses pin those histories. |
| ORC-005 | Applicable. The driver reads `_state.transactions`, the semi-public observation used by `collection.test.ts` and the local-only direct-write oracle. The work witness checks the public cost law without that field. |
| ORC-006 | Applicable. See the mutant table. |
| ORC-007 | Applicable. The generated campaigns are unchanged and keep their fixed and random seeds. |
| ORC-008 | Inapplicable. The model gains no state. |
| ORC-009 | Applicable. "Unsettled" maps to the glossary's persisting state; the model has no separate pending state. |
| ORC-010 | Inapplicable. No cleanup step was added. |
| ORC-011 | Applicable. The reviewer named a shared fault: an id-keyed removal. The same-id witness is the independent check. |
| ORC-013 | Inapplicable. No threshold law. |
| ORC-014 | Inapplicable. No controlled provider. |

## Unresolved

- The generated grammar does not reach multi-Collection transactions, same-id
  successors, offline restoration, or two settlements before one recompute.
  Owner: the optimistic-history oracle. Needed witness: a two-Collection model
  dimension.
- The per-mutation pass is still O(unsettled transactions). A key-scoped
  recompute would remove that term, but it touches every settlement law.
