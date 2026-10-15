# Live-query automatic-loading review

Reviewed implementation: `4bef0fbbe16a09e360f085af1a9af5302087088f`.

## Why this design

`autoLoad: false` queries data already in collections and keeps results reactive.
Application-owned fetching is one use case: some remote API requests cannot be
derived from the query IR, so the application constructs the request and ingests
its results. The contract is defined in the architecture's
[Automatic loading](../../../packages/db/src/query/live/ARCHITECTURE.md#automatic-loading)
section.

Suppressing `loadSubset` alone is insufficient because subscriptions can start
source sync, which can fetch independently. The implementation suppresses both
and determines readiness after evaluating available rows, without depending on
source loading. Other consumers can still load and update the shared rows.

Filtering, joins, includes, and pagination use the ordinary query engine.
Subscriptions skip the provider-loading callbacks, and ordered windows evaluate
the available rows. This avoids a separate implementation of query evaluation.

Loading mode is part of query identity, including explicit keys, because queries
that request data and queries that only read available rows have different
readiness behavior. The discriminator sits outside the user-supplied key array
to prevent collisions. The default remains `true`, with unchanged default hashes.

## Evidence and limits

The [core oracle](../../../packages/db/tests/live-query-auto-load-oracle.test.ts)
compares real Collection results with independent array calculations.
[React tests](../../../packages/react-db/tests/live-query-auto-load.test.tsx)
cover loading-mode changes, identity isolation, and pagination. The
[Query Collection integration](../../../packages/query-db-collection/tests/live-query-auto-load.test.ts)
checks application-owned ingestion without invoking the collection fetcher.
The requirement numbers below refer to the [oracle guide](../oracle-tests.md).

- ORC-001–003: the proposed contract, authority, model, production path, and
  limits are stated. Array filter/join/sort/slice calculations preserve selected
  values, duplicates, and order independently of incremental execution.
- ORC-004–005: generated replacements and windows cover eager/on-demand sources,
  windows, joins, and includes, with and without explicitly created indexes.
  Index presence is asserted. Checks cover subscription, preload, truncate,
  restart, readiness, and zero acquisition; pinned cases cover incremental
  updates, provider failure, and coexistence with a fetching consumer.
- ORC-006: enabling acquisition in the source subscription makes the replay
  below fail at the source-start assertion. Restoring `autoLoad: false` passes.
- ORC-007: all twelve mode/index/shape combinations run fixed and random
  campaigns with ten cases each, scaled by the standard multiplier. Seed/path
  replay is supported; command-model replay does not apply.
- ORC-008–010: the reference calculation is stateless, so additional model-state
  obligations do not apply. Cleanup preserves primary failures, and the reduced
  failing input retains the source-start assertion.
- ORC-011–012: no shared-fault hypothesis requiring another relational
  formulation is claimed. This record identifies the reviewed implementation
  and evidence limits; it does not claim general bug-class closure.
- ORC-013–014: empty/nonempty inputs and zero/nonzero windows distinguish
  available-row readiness from loading. The fetching-peer and Query Collection
  cases check shared ownership and direct ingestion. Arbitrary nested plans,
  remote provider protocols, and other frameworks remain outside this coverage.

## Validation

The automatic-loading oracle passes 27 tests. Focused identity/preload checks
pass 33 core tests; React checks pass 153 tests and type checks. Scoped lint and
formatting pass. The full workspace suite remains incomplete because of four
undiagnosed SQLite CLI runtime test timeouts. A separate ordered-window timeout
also reproduces on unchanged upstream code.

Run the calibrated replay from `packages/db`:

```sh
TANSTACK_DB_ORACLE_SEED=112919 TANSTACK_DB_ORACLE_PATH=0:0:0:0:0 TANSTACK_DB_ORACLE_PROPERTY=live-query-auto-load.on-demand.false.window pnpm exec vitest run --coverage.enabled=false tests/live-query-auto-load-oracle.test.ts
```
