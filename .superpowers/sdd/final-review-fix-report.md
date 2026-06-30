# Final review fix report

## Diagnosis

The branch still contained an out-of-scope direct-optimistic server-key matching heuristic. `CollectionStateManager` compared pending direct optimistic inserts to remote insert/update payloads while ignoring key-shaped fields, then used a confirmation set to remove local optimistic overlays. This was effectively identity/key inference and also created sticky cleanup state.

The query-while-syncing test also allowed divergent live-query cardinality (`[2, 3]`) instead of asserting the intended immediate optimistic/base semantics. The RFC discussed future public write-status APIs without clearly separating them from Phase 1.

## Files changed

- `packages/db/src/collection/state.ts`
  - Removed `valuesMatchExceptKeys()`.
  - Removed the sync-commit scan over direct optimistic inserts.
  - Removed `confirmedOptimisticDirectUpsertsWithServerKey` state and its read/write paths.
  - Kept same-key confirmation cleanup path unchanged.
- `packages/db/tests/collection.test.ts`
  - Updated server-key/non-key-match tests to assert no key inference: remote rows with matching non-key fields do not confirm/remove a pending optimistic row with a different key.
- `packages/db/tests/query/query-while-syncing.test.ts`
  - Replaced `[2, 3]` live-query size allowances with deterministic `2` assertions while preserving Eve visibility and immediate-base semantics.
- `packages/db/tests/collection-subscribe-changes.test.ts`
  - Clarified comments: no duplicate user-data events vs possible virtual-only `$synced` confirmation updates where projected.
- `docs/rfcs/2026-06-25-mutation-log-reconciliation.md`
  - Added explicit Phase 1 scope note marking `$hasPendingWrites`, `$writeStatus`, `tx.when(...)`, `db.mutations`, `$synced` replacement, `isPersisted.promise` replacement, and `needs-resolution` as future/non-Phase-1 public API directions.

## Commands and results

- `pnpm --filter @tanstack/db exec tsc --noEmit` — passed.
- `pnpm --filter @tanstack/db exec vitest run tests/collection.test.ts tests/query/query-while-syncing.test.ts tests/collection-subscribe-changes.test.ts` — passed; 4 files executed due dependency/import expansion, 164 tests passed, no type errors.
- `pnpm --filter @tanstack/db test` — passed; 101 test files, 2401 tests passed, 5 skipped, no type errors.

## Remaining concerns

- No remaining production references to `valuesMatchExceptKeys` or `confirmedOptimisticDirectUpsertsWithServerKey`.
- Existing untracked RFC PDF files were left untouched.
