# Task 8 Report: Full validation and Phase 1 status

## Summary

- Ran the Task 8 validation commands.
- Inspected the public API diff for `packages/db/src/index.ts`, `packages/db/src/types.ts`, and `packages/db/src/transactions.ts`; no `accepted`/`observed` lifecycle API and no public `db.operations` / `db.mutations` API were found.
- Inspected the `packages/db/src/collection/state.ts` branch diff for the sync/optimistic split. The implementation no longer gates normal committed sync solely on persisting transactions, active transaction mutations are still projected over base, and truncate-specific coverage exists.
- Made one small in-scope cleanup/fix in `CollectionStateManager`: direct optimistic upsert confirmation cleanup now clears pending/optimistic local state even when the sync commit changed the same key.
- Included the modified plan file containing the user-requested Task 7 survey addition.
- Left unrelated untracked RFC PDFs untouched.

## Implementation summary

- committed sync now advances base state even while local transactions are persisting
- active transaction mutations continue to project over base for visible state
- source collection change events are emitted from visible-state transitions
- live-query collections receive unrelated synced source rows during pending optimistic mutations

## Validation

### Focused DB tests

Command:

```bash
pnpm --filter @tanstack/db test -- tests/collection.test.ts tests/collection-subscribe-changes.test.ts tests/query/live-query-collection.test.ts
```

Result: **FAIL**

Observed summary:

- Test Files: 4 failed, 97 passed (101)
- Tests: 10 failed, 2391 passed, 5 skipped (2406)
- Type Errors: none

Failing test areas:

- `tests/collection-truncate.test.ts`
  - `should preserve optimistic inserts when mutation handler completes during truncate processing`
  - `should handle transaction completing between truncate and commit`
- `tests/collection.test.ts`
  - `Calling mutation operators should trigger creating & persisting a new transaction`
- `tests/query/query-while-syncing.test.ts`
  - both autoIndex variants of `should reflect local optimistic mutations in live query before source is ready`
- `tests/collection-subscribe-changes.test.ts`
  - `should handle both synced and optimistic changes together`
  - `should only emit differences between states, not whole state`
  - `should not emit duplicate insert events when onInsert delays sync write`
  - `should handle single insert with async persistence sync correctly`
  - `Virtual properties > should emit an update when $synced flips on confirmation`

### Full `@tanstack/db` test suite

Command:

```bash
pnpm --filter @tanstack/db test
```

Result: **FAIL** with the same failing test areas and counts:

- Test Files: 4 failed, 97 passed (101)
- Tests: 10 failed, 2391 passed, 5 skipped (2406)
- Type Errors: none

## Public API check

Command:

```bash
git diff origin/main...HEAD -- packages/db/src/index.ts packages/db/src/types.ts packages/db/src/transactions.ts
```

Manual grep/check found no public operation lifecycle API additions, no `accepted`/`observed` API, and no public `db.operations` / `db.mutations` API for Phase 1.

## Final diff inspection

Command:

```bash
git diff origin/main...HEAD -- packages/db/src/collection/state.ts | sed -n '1,260p'
```

Findings:

- Normal committed sync processing is no longer skipped only because a transaction is `persisting`.
- I did not see an event-only branch that emits sync changes without mutating `syncedData`.
- Active transaction mutations are still projected over the synced base.
- Truncate-specific logic remains covered by truncate tests, though two truncate tests currently fail.

## Commits

- `9dfd3145 fix: finalize mutation log reconciliation slice`

## Concerns

Validation is not green. I made one small direct cleanup fix, but the remaining 10 failures appear to require deeper reconciliation/event-semantics work than a Task 8 validation pass should attempt without risking overreach.

## Follow-up fix attempt

Diagnosis:
- The truncate failures were caused by completed direct optimistic inserts being cleaned up during truncate reconciliation even when the truncate snapshot still needed to preserve them.
- The collection transaction cleanup failure was caused by completed optimistic mutations being re-seeded after their sync write had already confirmed the same row.

Changes:
- `CollectionStateManager.recomputeOptimisticState` now treats completed optimistic mutations as already confirmed when synced base data already matches (or a delete is already absent), and clears pending optimistic/direct tracking instead of re-seeding them.
- Sync commit reconciliation now considers persisting optimistic transactions when comparing confirmation events, so sync writes that happen inside mutation handlers are evaluated against the local optimistic value.
- Truncate reconciliation no longer removes direct optimistic upserts that were captured in the truncate optimistic snapshot and not confirmed by the truncate batch.
- Fixed one test-only type annotation that failed `tsc --noEmit` under current virtual-prop return types.

Validation:
- `pnpm --filter @tanstack/db exec tsc --noEmit`: PASS.
- `pnpm --filter @tanstack/db test -- tests/collection.test.ts tests/collection-subscribe-changes.test.ts tests/query/live-query-collection.test.ts`: FAIL; package config ran broader suite. Summary: 2 failed, 99 passed (101); 7 failed, 2394 passed, 5 skipped (2406). Remaining failures are the same subscribe-changes confirmation-event expectations and query-while-syncing live query size expectations.
- Targeted truncate tests now pass in the focused run (`tests/collection-truncate.test.ts`: 16 passed).
- `tests/collection.test.ts` now passes in the focused run (42 passed).

Remaining concerns:
- `collection-subscribe-changes.test.ts` still expects a confirmation event when the synced write is identical to the optimistic visible value; current reconciliation treats that as no visible-state difference except for virtual props, but the virtual-prop confirmation event is still not emitted in these delayed-sync cases.
- `query/query-while-syncing.test.ts` still expects live query size 2 after syncing an already-resolved optimistic insert; current Phase 1 semantics expose the synced base immediately and the observed size is 3 in both autoIndex variants.
