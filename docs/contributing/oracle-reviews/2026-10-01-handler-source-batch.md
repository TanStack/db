# Source batches written inside a mutation handler

Pre-repair executable revision: `34095aa6d` (oracle extension on `f2f92c5b2`).
Repair executable revision: `3ab428439`.

## Law

A direct `insert`, `update`, or `delete` hands its request to the
Collection's handler. The handler may confirm the request through sync before
it returns. That source batch is the same event as a batch written while the
new request is active: it waits for settlement unless it is immediate or a
truncate, and ordinary publication then retires the accepted snapshot.
Authority: the optimistic-history contract in
`packages/db/tests/optimistic-history-oracle.ts` ("After success it remains
as an accepted local snapshot until source acknowledgement retires it") and
the virtual-property definitions in `docs/guides/live-queries.md`.

## Gap

The direct paths in `packages/db/src/collection/mutations.ts` committed the
transaction before they registered it. `commit()` runs the handler
synchronously up to its first `await`, so a synchronous confirmation found no
persisting request and applied at once. It acknowledged nothing. Registration
then installed the optimistic overlay over the confirmed row, and nothing
retired it:

- the row kept its optimistic value with `$hasPendingWrites: true` after the
  transaction completed;
- the next remote write to the key reported `$origin: 'local'`.

The oracle missed it because its grammar wrote every source batch after the
edit call returned. No generated history reached the handler's synchronous
body.

The gap was found while classifying survivors of a code-weight mutant run on
`state.ts`. A probe for mutant B4 showed `main` violating the documented
`$hasPendingWrites` contract in this history.

## Repair and witnesses

- The grammar lets `edit` and `delete` steps carry a source batch that the
  shared handler writes before it returns, about one step in four. The model
  applies that batch with `sync` right after `author`, and both views are
  allowed publication cuts. The driver asserts that the handler wrote the
  batch.
- Six pinned replays confirm an insert, an update, and a delete inside their
  own handlers, immediate and not, then settle and receive a later remote
  write.
- A sampling witness requires the fixed campaign (seed `86103`) to generate
  in-handler batches for edits and deletes, immediate and not, with rows.
- Each direct path now registers the transaction, schedules its cleanup, and
  recomputes optimistic state before it commits. The production change is net
  −2 lines.

| Run | Result |
| --- | --- |
| Owner on `34095aa6d` (oracle only) | 7 failed of 95: 5 of 6 pinned cases and both campaigns. The first failure is the batch publishing the server row as synced before the overlay. |
| Owner on `3ab428439` | 95 passed |
| Mutant: one path commits before it registers (insert, update, delete) | assertion failure: 4, 4, and 3 of 95 |
| Mutant: one path registers, commits, then recomputes | assertion failure: 2 of 95 on each path |

The immediate delete case also passed before the repair: an immediate delete
batch applies at once either way, and the delete leaves no overlay to retire.

## Limits

- The handler writes one batch, synchronously, before any `await`. A batch
  written after an `await` was already in the grammar as an ordinary sync
  step.
- Transactions from `createTransaction` and `createOptimisticAction` register
  through `mutate()` before the caller commits, so they never had this gap.
  This change adds no witness for them.
- Local-only collections reach the repaired path: their wrapper confirms
  synchronously when no user handler is given. Their rows never report
  pending writes, so the old order had no visible effect there.

## Verification

On `3ab428439`, with the built `dist`:

- `packages/db` Vitest, typecheck off: 200 files, 7,857 tests.
  `tsc --noEmit`: no errors.
- `pnpm --filter @tanstack/db test:dist` (290 tests) and
  `pnpm test:minified-db` pass.
- Package unit tests: `query-db-collection` 558, `electric-db-collection` 629,
  `offline-transactions` 73.

## Note added 2026-10-03

The settlement contract changed after this record. A transaction's optimistic
state now drops when its mutation function settles. A source batch written
inside the handler is held and publishes with that drop, and it is
`$origin: 'local'` because it was committed while the transaction persisted.
A write committed after settlement is `'remote'`. The evidence above is
historical.
