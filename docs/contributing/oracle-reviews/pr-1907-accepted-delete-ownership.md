# PR #1907 accepted-delete ownership oracle review

## Reviewed state and law

- Starting head: `e1cfd38761c9901e693568bc4394219e05b2e42c`.
- Test-only RED commit: `99d1ed93cf3c2447a7b55d7f8f000e68324b31bb`.
- Corrected implementation head: `f7c13f3689341c320ccf373fb4ec2d9dfbfc8591`.
- Primary executable owner:
  `packages/db/tests/collection-state-retention-oracle.property.test.ts`.
- Independent model and production driver:
  `packages/db/tests/optimistic-history-oracle.ts`.

This record is committed after the implementation it reviews so it can name
that immutable code commit. An accepted delete remains independently owned
under a later reinsert and its dependent edit. If the reinsert fails, the
dependent edit disappears and the accepted delete still hides the old source
row. If the reinsert succeeds, the accepted edit stays visible. The order in
which the delete and edit settle does not change either result.

The bounded matrix starts with one source row. It authors a direct delete,
reinsert, and dependent edit on the same key. It crosses both delete/edit
settlement orders, both reinsert outcomes, and truncate versus no truncate
before the reinsert outcome. The driver compares complete public Collection
rows, change-message publications, and a downstream live-query Collection
after every step. It asserts that all three local operations, the dependency,
all three settlements, and the selected truncate actually occurred.

## RED, repair, and GREEN

On the starting head, the new matrix failed exactly one of eight cells:
delete settled before edit, reinsert rejected, no truncate. At the reinsert
rollback checkpoint, the event replica published the old source row
`{ id: 1, a: 0, b: 0, c: 0 }` while the independent model required no row.
The failure was an assertion at the intended public publication checkpoint,
not a setup error or timeout. A truncate in that order already removed the
row, so its green result did not excuse the non-truncate failure.

The completed dependent update had been clearing the pending accepted delete
and its direct-retention marker merely because it was processed later in
creation order. The corrected implementation keeps that delete contribution
while the update has an unconfirmed insert dependency. The active insert still
overlays the delete. Insert acceptance removes the delete; insert failure
removes the dependent upsert and exposes the delete. This changes ownership of
the accepted contributions, not public mutation policy or the reference model.

The corrected head passed all eight matrix cells and all 88 state-retention
tests. The complete DB oracle campaign passed 42 files and 2,601 tests. The
full DB runtime suite passed 186 files and 6,588 tests with Vitest background
typecheck disabled; direct TypeScript checking passed separately. The DB build,
changed-file ESLint, Prettier, and `git diff --check` also passed.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001: contract authority and limits | Pass. The established whole-row optimistic intent and insert-dependency law governs the fallback. The matrix claims the eight stated direct-operation histories, not arbitrary later source acknowledgement or every order of reinsert outcome versus sibling settlement. |
| ORC-002: independent judgment | Pass. The model folds authored intents over a plain source Map in settlement order. It does not read CollectionState's pending maps or repeat their retention classifier. |
| ORC-003: distinguishable responsibilities | Pass. The owner states retained-state law and names the optimistic companion. That companion separates the intent model, step grammar, real Collection driver, and per-step public refinement check. |
| ORC-004: grammar controls | The new matrix is bounded enumeration, not a new generated property. It reconstructs the reported delete-first rollback. Removing settlement order loses the RED cell; removing reinsert outcome loses the fallback law; removing truncate loses the captured-ownership control. The range is one key and three local operations. A dependent edit without a reinsert is excluded by construction. |
| ORC-005: production path and observation | Pass. The driver uses public `delete`, `insert`, and `update`, controlled mutation handlers, and real sync truncate. It compares public rows, callback-time event state, and downstream rows after each action. The count assertions prove the chosen path ran. |
| ORC-006: checker calibration | Pass. The unchanged starting implementation failed at the intended publication assertion in the delete-first/rejected/no-truncate cell. The corrected head passes that cell and the seven controls. |
| ORC-007: fixed/random campaigns and replay | Not triggered by this bounded matrix. The owner's existing important generated optimistic-history properties retain their matching fixed-seed and seedless campaigns and guarded seed-plus-path replay. Both campaigns ran in the DB oracle suite. |
| ORC-008: stateful-model minimality | No reference-model state changed. The existing dependency distinction is necessary: reinsert failure removes a dependent edit but cannot remove the independently accepted delete. |
| ORC-009: vocabulary mapping | Pass. The model's intent list represents optimistic transactions' authored snapshots. Source rows, public rows, change messages, settlement, and truncate replay retain the project glossary meanings. |
| ORC-010: failure fidelity and cleanup | Pass. `withHistoryCleanup` preserves the primary model/public mismatch, records separate cleanup errors, and releases held operations, subscription, downstream Collection, and source Collection. |
| ORC-011: independent second formulation | Not triggered. No plausible semantic fault shared by the plain intent model and production's pending-layer bookkeeping was identified. Public reads, callback-time events, and downstream rows are complementary observations. |

ORC-012 is satisfied by this versioned record, its corrected implementation
head, and the coverage-map entry. The bounded settlement-order × outcome ×
truncate class has no known reachable counterexample at its checked cuts.
This is not a proof over all future schedules. The matrix does not run the
local-only adapter, does not place reinsert settlement before both siblings,
and does not check arbitrary later source acknowledgements. The separate
external-review ledger also records an unquantified full-Transaction retention
concern; this repair does not claim to resolve it.
