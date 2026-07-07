# Write status contract docs/tests design

Date: 2026-07-07
Branch: `docs-tests-write-status-contract`

## Goal

Create a small, feature-freeze-friendly PR that clarifies TanStack DB's existing local write status semantics and locks the pending optimistic write / sync contract with core collection tests.

This PR does not add public APIs and does not change sync reconciliation behavior unless a contract test exposes a small existing bug.

## Background

The mutation reconciliation RFC issue clarified two important boundaries:

1. Core cannot generically apply all sync immediately while optimistic mutation functions are pending, because temp-key optimistic inserts can later appear as server-key synced rows. Without explicit identity mapping or mutation receipts, core cannot know whether the server row replaces the temp row or is unrelated.
2. Existing status names are easy to misread. `$synced` and `tx.isPersisted.promise` describe local TanStack DB write/projection state, not necessarily backend upload or read-path observation.

The first follow-up PR should therefore be documentation and tests only. Public write status APIs such as `$writeStatus`, key-scoped pending write helpers, or `awaitPersisted(key)` belong in a separate PR.

## Scope

### In scope

- Update source JSDoc/TSDoc that feeds generated docs.
- Clarify `$synced` in `packages/db/src/virtual-props.ts`:
  - means the row currently has no pending local optimistic mutation in the collection's visible projection;
  - does not mean backend upload/read-path confirmation;
  - adapters that need stronger backend observation semantics must encode that in their mutation function / adapter layer.
- Clarify `tx.isPersisted.promise` in `packages/db/src/transactions.ts`:
  - resolves when the transaction's `mutationFn` settles successfully;
  - rejects when the mutation function fails;
  - is a promise-bearing deferred, so callers should await `.promise`, not the deferred object itself;
  - does not inherently mean the backend sync/read path has observed the write unless the mutation function waits for that observation.
- Add core collection tests only.
- Test the current contract for ambiguous temp/server identity:
  - while an optimistic temp-key insert's mutation function is pending, a possible server-key echo should remain queued / not visible;
  - visible state should not show both the temp row and server-key row at the same time;
  - after the mutation function settles, the optimistic temp row leaves the visible projection and queued sync can apply through the normal path.

### Out of scope

- New public APIs (`$writeStatus`, `hasPendingWrites`, `$pendingOperation`, `awaitPersisted(key)`).
- Framework adapter tests (React/Solid/Vue/Svelte).
- Mutation log rewrite.
- Generic immediate sync while mutation functions are pending.
- Temp-key to server-key mapping.
- Mutation receipts.
- Electric txid semantics in core.
- `needs-resolution` transaction state.
- Offline transaction behavior changes.

## Test design

Add tests in core collection tests, likely `packages/db/tests/collection.test.ts`, because the behavior is about core collection state and pending sync application.

Primary test scenario:

1. Create a collection with an async `onInsert` that remains pending until the test releases it.
2. Insert an optimistic row with a temporary client key, e.g. `{ id: 'temp-1', text: 'A' }`.
3. Assert the temp row is visible immediately.
4. During the pending mutation function, send a sync transaction containing a different key with similar data, e.g. `{ id: 'real-1', text: 'A' }`.
5. Assert the server-key row is not visible while the mutation function is still pending, and the collection does not contain both rows.
6. Resolve the mutation function and await `tx.isPersisted.promise`.
7. Assert the temp row is no longer visible and the queued server-key row is visible after pending sync replay.

If current main already has equivalent coverage, prefer tightening/renaming existing tests over adding duplicate coverage.

Secondary docs-oriented test, only if easy and not redundant:

- Verify `tx.isPersisted.promise` remains pending while the mutation function is pending and resolves only after the mutation function resolves.
- This should be skipped if existing transaction tests already cover it clearly.

## Implementation notes

- Do not edit generated `docs/reference` directly unless the repository docs workflow expects generated files to be checked in for source comment changes.
- First update source comments. Then run the relevant docs generation command only if project scripts indicate generated reference docs are part of normal PR output.
- Keep test assertions focused on behavior, not private internals, unless public state cannot express queued sync state. Prefer visible collection state assertions.
- If a test fails because main currently violates the clarified contract, make the smallest code fix possible. Do not expand into mutation-log or identity-mapping work.

## Verification

Minimum verification:

```bash
pnpm --filter @tanstack/db exec vitest run tests/collection.test.ts --pool-options.threads.maxThreads=2
pnpm --filter @tanstack/db exec tsc --noEmit
```

If generated docs are updated, run the repository's docs generation/check command if available.

## PR framing

Suggested PR title:

> Clarify local write status docs and pending sync contract

Suggested PR body points:

- Clarifies `$synced` and `isPersisted.promise` source docs so generated references do not imply backend/read-path confirmation.
- Adds core collection coverage for ambiguous temp-key optimistic insert plus possible server-key sync echo.
- Does not add new public write status APIs; those are reserved for a follow-up PR.
