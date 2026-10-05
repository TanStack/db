# State mutation round 2

Reviewed executable revision: `76484a092`, the test commit that precedes
this record (base `4ce1f9b87`). No production code changes.

## Round

After the round-1 fixes merged (#1986, #1995, #1996), 40 new source mutants
modeled plausible mistakes in the state.ts sync commit (12), change batching
and subscription delivery (14), and mutations.ts and transactions.ts (14).
Each was applied to unchanged `main`; the full db suite ran with bail. The
round-1 survivors were rerun first: every round-1 test gap is now caught.

28 of the 40 were caught. Each of the 12 survivors was classified:

| Mutants | Verdict | Evidence |
| --- | --- | --- |
| M8 | **Test gap**, closed here | A delete then a reinsert of the same key in one transaction, merged as an update, lost its optimistic flag. The row showed its old value until persistence. The same-key lane never authored a delete followed by an insert |
| M1, M2, M3 | Equivalent; dead code | `markPendingLocalChanges` covered a handler that syncs before its transaction is registered. Since #1986, each direct path registers the transaction and recomputes, which rebuilds `pendingLocalChanges`, before `commit()` |
| S5, S6, S12 | Equivalent; dead code | The truncate reapply search for an earlier insert never finds one (round-1 A2 to A4) |
| S7, M10 | Equivalent | Recompute's stale cleanup removes the leftover layer; `isPersisted` awaiters resume after the synchronous state change |
| S2 | Equivalent on reached histories | The completed-key fallback decides 219 times, all in `collection-metadata-publication-oracle`, which asserts the exact published batches and passes. Another publication delivers the settlement update |
| C1, C2 | Equivalent on reached histories | Batch composition ran 228 times in the suite; insert-first pairs never ran, including in a targeted history |
| C3 | Minor | A composed delete keeps a `previousValue` beside the correct `value`; reached once |

## Witness

The same-key lane of `optimistic-transaction-oracle.property.test.ts` adds
`delete-insert`. The `applyMutations` truth table gives its net request: a
reinsert that restores the original row cancels the pair; otherwise it is an
update from the original row whose `changes` hold exactly the differing
fields. The lane checks both authored prefixes, so the reinserted row must be
visible optimistically. Two pinned cases cover a restoring reinsert, which
generation never produces.

| Mutant on `transactions.ts` | Owner result |
| --- | --- |
| M8: the merged update loses `optimistic` | 3 of 66 fail |
| X1: the reinsert is passed through as an insert | 13 of 66 fail |
| X2: `changes` hold the whole reinserted row | 12 of 66 fail |
| X3: a restoring reinsert is not canceled | 4 of 68 fail, including both pinned cases |

## Open

- The completed-key fallback (S2) and the insert-first batch compositions
  (C1, C2) may be unreachable. Proving that would let the state-stack port
  delete them.
- The port can delete `markPendingLocalChanges`, the truncate reapply search,
  and the recompute delete filter.

## Verification

`packages/db` Vitest, typecheck off: 201 files, 7,865 tests.
