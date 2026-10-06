# Insert, not update, for a key subscribers saw removed

Pre-repair executable revision: `721a607e8` (oracle extension on `ef1e6a4aa`).
Repair executable revision: `182b99262`.

## Law

Each change message must be valid for a consumer that has applied every
earlier message: an insert names an absent key, and an update or delete names
a present one. Authority: the change-message contract in
`packages/db/tests/change-event-history-oracle.test.ts` and issue #1901, which
require a consumer that applies every message to agree with the Collection.

## Gap

When a sync commit made a previously absent key visible, `state.ts` checked
for a completed optimistic request on that key. If one existed, it emitted an
`update` whose `previousValue` was that request's value. Subscribers had last
seen the key removed, usually by a completed optimistic delete, so they got an
update for a row they did not hold.

The change-event oracle missed it because its mirror applied inserts and
updates with the same `Map#set`. The message type was never checked.

A mutation round on the state stack found it. The mutant that limited this
branch to updates (E3) survived the whole suite. With a strict mirror, the
oracle's histories showed 78 invalid updates on `main` and none under E3.

## Repair and witnesses

- The oracle's mirror records each message that is invalid for its state, and
  every history asserts that the list is empty. The deferred-sync lane already
  compared exact per-key traces.
- A previously absent key now always gets an `insert`. When a buffered delete
  for the key is still batched, `composeBatchedChange` turns the pair into an
  update, as before.
- The completed-request map becomes a key set, the only part that
  virtual-property derivation reads. The `state.ts` module is 194 minified and
  39 gzip bytes smaller.

| Run | Result |
| --- | --- |
| Owner on `721a607e8` (oracle only) | 26 of 378 fail, each on an update for a key the mirror lacks |
| Owner on `182b99262` | 378 pass |
| Mutant: the old update branch | the 26 failures above |
| Mutant: no event for a previously absent key | 92 of 538 owner tests fail |

## Limits

- The strict mirror runs in the change-event oracle's local-only histories.
  Other owners that build mirrors may still accept an update for an absent key.
- Survivor: building the completed-key set empty changes no test result. The
  set only feeds the fallback for previous `$synced`/`$origin` when the
  pre-sync capture lacks the key. This repair keeps that use unchanged; the
  next mutation round owns it.

## Verification

On `182b99262`, with the built `dist`:

- `packages/db` Vitest, typecheck off: 200 files, 7,857 tests.
  `tsc --noEmit`: no errors.
- `pnpm --filter @tanstack/db test:dist` (290 tests) and
  `pnpm test:minified-db` pass.
- Package unit tests: `query-db-collection` 558, `electric-db-collection` 629,
  `offline-transactions` 242.
