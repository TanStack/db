# Failed transaction retention review

Reviewed revision: the commit that adds this record on
`fix-failed-transaction-retention`, based on `origin/main` `2ab7f3e55`.

## Contract and evidence

A Collection tracks its optimistic transactions in `state.transactions`. Every
per-mutation pass walks that map: `recomputeOptimisticState`,
`overlayActiveTransactions`, `hasPersistingTransaction`,
`commitLocalOnlyDirect`, and the Query Collection's
`isMutationPublicationBlocked`. A settled transaction must leave the map,
whether it succeeded or failed. Otherwise per-mutation cost grows with history,
not with live work.

The law: the number of tracked transactions is at most the number of live
transactions. A live transaction is persisting, or completed with a row that a
queued sync transaction still holds (the hold from the settlement-drop review,
[2026-10-03-settlement-drop.md](2026-10-03-settlement-drop.md)).

Authority: no reader needs a settled transaction. Every loop over the map skips
`failed` entries, and a completed entry is read only while its held row is
still in the map. The other readers outside `packages/db` are the
offline-transactions restore path, which adds and deletes its own restoration
transaction, and an Electric test, which reads a completed transaction. Neither
reads a failed transaction.

`scheduleTransactionCleanup` removed a transaction only when `isPersisted`
fulfilled. Its rejection handler was empty ("keep failed transactions for
reference") since #371. `rollback()` rejects `isPersisted` and then calls
`touchCollection()` synchronously, so the rollback recompute and publication
finish before the rejection handler runs. The fix removes the transaction in
both handlers.

## Oracle changes

- The optimistic-history driver (`optimistic-history-oracle.ts`) now checks,
  after every step, that `collection._state.transactions.size` is at most the
  model's live transactions: persisting or held. The opening prose states the
  law.
- A focused witness in `collection.test.ts` runs 200 cycles of a rejected
  `update` and a manual rollback, and checks after each cycle that no
  transaction is tracked and that the row returned to its synced value.

## Results

| Check | `origin/main` | This branch |
| --- | --- | --- |
| Optimistic oracles, 6 files | 37 of 323 fail, each `tracked transactions are live` at a failed settle | 323 pass |
| Focused witness | `expected 1 to be +0` | Pass |
| 4,000 mutate and rollback cycles on 10k rows, median per cycle (first 200 / last 200) | 0.029 / 0.667 ms, and 0.030 / 0.936 ms; 4,000 tracked | 0.015 / 0.008 ms, and 0.014 / 0.008 ms; 49 tracked between flushes |

`scripts/bench/incremental-update.ts`, two interleaved runs: the write
geomean is 0.88× and 0.84× against `origin/main`, with same-code noise at 1.03×.
Every query group improves by 11–14%. The bench rolls back after each
optimistic iteration, so its numbers on `main` include this leak.

## Mutants

| Mutant | Outcome (ORC-006) |
| --- | --- |
| Keep failed transactions (`origin/main`) | Assertion failure: 37 tests |
| Delete a completed transaction before its publication | Assertion failure: 21 tests, "rows visible when isPersisted settled" |
| Delete a failed transaction before its rollback publishes | Survived: equivalent within the tested domain. Every reader skips `failed` entries, so the earlier delete changes no recompute and no publication. |

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The law and authority are above. The claim covers a single Collection's tracked transactions; it does not bound transaction-scope state in `transactions.ts`. |
| ORC-002 | Applicable. The live count comes from the model's transaction states and its `held` flag, not from production. |
| ORC-003 | Applicable. The opening prose of the history oracle states the law beside the model, and the driver states the observation. |
| ORC-004 | Applicable. The existing grammar generates failed settles, cascading rollbacks, held sync transactions, and truncates. The 37 failures on `main` show the failed-settle cut is reached. |
| ORC-005 | Applicable. The driver uses the real Collection and reads `_state.transactions`, the semi-public observation already used by `collection.test.ts` and the local-only direct-write oracle. |
| ORC-006 | Applicable. See the mutant table. |
| ORC-007 | Applicable. The generated campaigns are unchanged and keep their fixed and random seeds. |
| ORC-008 | Inapplicable. The model gains no state. |
| ORC-009 | Applicable. "Live transaction" maps to persisting, or completed and held, in the glossary's terms. |
| ORC-010 | Inapplicable. The change adds an assertion to an existing check and no cleanup. |
| ORC-011 | Inapplicable. No shared-fault hypothesis was named. |
| ORC-013 | Inapplicable. No threshold law. |
| ORC-014 | Inapplicable. No controlled provider. |

## Unresolved

- The per-mutation pass is still O(live transactions). A key-scoped recompute
  would remove that term but touches every settlement law; it is not needed
  for this fix.
