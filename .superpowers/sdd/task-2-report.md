# Task 2 report

## Design

Added a precisely typed ownership-relationship removal helper that deletes `rowToQueries` and `queryToRows` entries when their final relationship disappears. Empty persisted-owner input also no longer creates an empty row entry.

A separate internal `resolvedOwnershipQueries` set records that a query's in-memory ownership has been resolved. Baseline hydration/persistence lookup treats membership in this set exactly as it previously treated an existing empty `queryToRows` set, so deleting the empty map entry cannot trigger fallback reconstruction. Full query cleanup clears this marker alongside all other query tracking. No package-root export or public configuration/API was added.

The existing characterization coverage continues to verify overlapping ownership, retained hydration/revalidation, cache expiry, metadata cleanup, and exact/prefix invalidation. A new source-module-only invariant test directly proves both ownership maps omit their keys after the final relationship removal.

## Files changed

- `packages/query-db-collection/src/query.ts`
- `packages/query-db-collection/tests/query.test.ts`

## Verification

- TDD red: `pnpm --filter @tanstack/query-db-collection test -- --runInBand packages/query-db-collection/tests/query.test.ts` — failed as expected because `removeOwnershipRelationship` did not exist. (This invocation also exposed the repository's existing missing `@tanstack/electric-db-collection` type dependency.)
- `cd packages/query-db-collection && pnpm exec vitest run tests/query.test.ts` — 234/234 runtime/type test instances passed; command exited 0, while Vitest reported three unhandled typecheck diagnostics for the missing `@tanstack/electric-db-collection` dependency in sibling `db-collection-e2e` suites.
- `pnpm exec prettier --write packages/query-db-collection/src/query.ts packages/query-db-collection/tests/query.test.ts` — passed; files unchanged.
- `pnpm --filter @tanstack/query-db-collection lint` — passed with 15 pre-existing warnings and no errors. The lint script's unrelated e2e autofixes were reverted.
- `pnpm --filter @tanstack/query-db-collection build` — passed, including ESM/CJS declaration generation.
- `pnpm --filter @tanstack/query-db-collection test` — all 234 runtime/type test instances passed, but the package command exited 1 because Vitest reported three unhandled typecheck errors: sibling e2e suites cannot resolve `@tanstack/electric-db-collection` in this worktree.
- `git diff --check` — passed before commit.
- Commit hooks (`eslint --fix`) — passed.

## Commit

`852d817ea9edac8b64d981e1b395b33ae99dbac6` (`fix(query-db): remove empty ownership entries`)

## Self-review and concerns

The change is limited to ownership bookkeeping and fallback selection; row deletion, transactions, metadata writes, invalidation targeting, and observer/refcount behavior are untouched. The internal test helper is exported only from the unlisted source submodule for direct invariant testing and is not re-exported through the package entry point.

Concern: the required package test command remains red solely because the worktree cannot resolve the existing `@tanstack/electric-db-collection` dependency during Vitest typechecking, although every query-db test and reported type test passed. Untracked pre-existing `PLAN.md` and other `.superpowers` workflow files were not committed.

## Review follow-up

Removed the source-module export of the ownership helper. Real collection lifecycle tests now inspect the closure-owned maps through a non-enumerable hook installed only when `NODE_ENV === "test"`; this creates no source export or declaration/API surface. The tests assert no empty sets after overlapping result reconciliation, first/final subset unload, and retained persisted-row revalidation, and assert the authoritative marker is cleared by collection/query cleanup.

The authoritative-empty marker is now created only after a successful query result has first selected its prior baseline. Generic row addition/removal and persisted-placeholder cleanup no longer create markers. Therefore placeholder expiry cannot leak hashes, hydration of one query cannot mark unrelated persisted owners, and markers remain bounded by actual resolved query lifecycles and are deleted by query cleanup. Missing relationship behavior was left unchanged because callers use the boolean to preserve row deletion behavior; the helper no longer fabricates empty entries.

Follow-up verification:

- `pnpm exec prettier --write packages/query-db-collection/src/query.ts packages/query-db-collection/tests/query.test.ts` — passed.
- `cd packages/query-db-collection && pnpm exec vitest run tests/query.test.ts -t 'ownership lifecycle characterization'` — 6/6 focused runtime/type tests passed with no type errors; Vitest still reported the three unrelated unresolved `@tanstack/electric-db-collection` source diagnostics.
- `pnpm --filter @tanstack/query-db-collection lint` — passed with 15 existing warnings and zero errors; unrelated e2e autofixes were reverted.
- `pnpm --filter @tanstack/query-db-collection build` — passed, including ESM/CJS declarations.
- `pnpm --filter @tanstack/query-db-collection test` — all 232 runtime/type test instances passed with no type errors; command exits 1 solely for the same three unresolved `@tanstack/electric-db-collection` source diagnostics.
- `git diff --check` — passed.

Self-review: production instrumentation is absent outside test mode and has no exported symbol. Placeholder cleanup cannot add authoritative markers, successful result markers are installed only after fallback baseline selection, and cleanup removes them. Ownership-map assertions now exercise closure-owned maps rather than synthetic maps. No new concern beyond the pre-existing missing workspace dependency affecting Vitest's exit status.

## Final-review follow-up

Persisted-placeholder cleanup now removes `resolvedOwnershipQueries` only after row ownership, persisted metadata, retention metadata, and the cleanup transaction have completed. This preserves authoritative-empty fallback suppression for the entire placeholder lifetime and avoids clearing the marker if cleanup does not complete. The runtime TTL test now inspects the closure-owned state: before expiry it asserts the marker and both ownership relationships remain; after expiry it asserts the query-to-row entry, row-to-query entry, and marker are all absent.

Final-review verification:

- TDD red: `cd packages/query-db-collection && pnpm exec vitest run tests/query.test.ts -t 'should expire retained ttl placeholders while the app stays open'` — failed at the new post-expiry marker assertion (`expected true to be false`), while both ownership-map cleanup assertions passed.
- `pnpm exec prettier --write packages/query-db-collection/src/query.ts packages/query-db-collection/tests/query.test.ts` — passed; test formatting updated.
- `cd packages/query-db-collection && pnpm exec vitest run tests/query.test.ts -t 'should expire retained ttl placeholders while the app stays open'` — 2/2 runtime/type instances passed with no test type errors; Vitest reported the three pre-existing unresolved `@tanstack/electric-db-collection` sibling-suite diagnostics.
- `cd packages/query-db-collection && pnpm exec vitest run tests/query.test.ts` — 232/232 runtime/type instances passed with no test type errors; same three unrelated diagnostics reported.
- `pnpm --filter @tanstack/query-db-collection lint` — passed with 15 pre-existing warnings and zero errors; unrelated e2e autofixes were reverted.
- `pnpm --filter @tanstack/query-db-collection build` — passed, including ESM/CJS declarations.
- `pnpm --filter @tanstack/query-db-collection test` — all 232 runtime/type instances passed with no test type errors; command exited 1 solely because of the same three unresolved sibling-suite `@tanstack/electric-db-collection` diagnostics.

Self-review: the deletion occurs after `commit()`, so marker authority remains intact until TTL cleanup is complete; no fallback, row-deletion, metadata, or public API behavior was otherwise changed. Concern remains limited to the pre-existing missing workspace dependency that makes the package test command exit nonzero.
