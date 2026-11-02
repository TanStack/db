# @tanstack/db-adapter-conformance

Conformance oracles for TanStack DB sync adapters (issue #2118). An adapter
author supplies a production driver; the package supplies the laws, an
independent model, a history grammar, and the check that compares the
adapter's public behavior with the model at each checkpoint.

The package is private while its first oracle settles.

## Eager live-source oracle

`src/eager-live-source-oracle.ts` checks an eager Collection whose provider
pushes a complete result and then committed change batches. Its opening
comment states the laws and their limits. In short:

| Law                        | Checked behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| READY-2, READY-3           | `loading` until the first complete delivery; then `ready` with exactly its rows                                                                                                                                                                                                                                                                                                                                                                                                                         |
| READY-4                    | A failure before ready: status `error`, `preload()` rejects with the value, `health.error.cause` is the value                                                                                                                                                                                                                                                                                                                                                                                           |
| HEALTH-1                   | A failure after ready: status stays `ready`, rows kept, `health.error.cause` is the value                                                                                                                                                                                                                                                                                                                                                                                                               |
| PUB-1                      | Every change publication during a step is one whole committed state, in commit order; per batch or per change, as the driver declares                                                                                                                                                                                                                                                                                                                                                                   |
| PUB-2, PUB-3, PUB-7, FID-4 | Change events fold to the rows, with no insert of a held key and no update or delete of a missing one; batches fold onto rows; a complete delivery replaces (PUB-7 with `complete-snapshot`)                                                                                                                                                                                                                                                                                                            |
| FID-1                      | A delivered row is the whole backend row: a row without the optional `note` removes a `note` the Collection held. With declared `valueKinds`, each `value` strictly equals the delivered one on the initial load and on a live change: same type and prototype, `Object.is` for numbers (`-0` is not `0`), Dates by time, nested arrays and plain objects element by element. With declared `fieldKinds`, each row's `typed` record holds one field per kind, as typed columns do, checked the same way |
| LIFE-2, LIFE-5             | Cleanup releases the provider subscription; a restart is a fresh, empty sync run                                                                                                                                                                                                                                                                                                                                                                                                                        |
| LIFE-10                    | A failed provider's subscription is released at the failure, and no subscription is released twice                                                                                                                                                                                                                                                                                                                                                                                                      |
| HEALTH-5                   | No unhandled rejection and no undeclared `console.error` or `console.warn`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| EVID-1, EVID-2, EVID-3     | `awaitTxId` fulfills after its batch applies, stays pending before, rejects after its timeout, and rejects at retirement                                                                                                                                                                                                                                                                                                                                                                                |
| HEALTH-2, RETRY-1          | A retried failure stays hidden before ready, joins `failureReason` after it, and clears on the next delivery (`retry-policy`)                                                                                                                                                                                                                                                                                                                                                                           |
| RECON-1                    | Disconnect and reconnect keep status and rows                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| RENEW-1                    | Capability renewal reuses the provider subscription and changes nothing visible                                                                                                                                                                                                                                                                                                                                                                                                                         |
| READY-8, READY-10          | With `listen-before-fetch`: no fetch before the listener is live; batches committed during the fetch apply after its result, before ready                                                                                                                                                                                                                                                                                                                                                               |
| PUB-5, PUB-9               | With `listen-before-fetch`: the cut publishes only backend states at or after the read point, in order; no replay regresses a row                                                                                                                                                                                                                                                                                                                                                                       |
| READY-3, READY-10          | When status becomes `ready`, the rows already equal the initial cut                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| PUB-4, PUB-3               | With `duplicate-key-delivery`: a complete delivery holding two rows with one key follows the driver's `duplicateInsert` policy. Under `error` it is rejected: no row written, nothing published, earlier rows kept, a sync failure reported. Under `replace` the later row wins                                                                                                                                                                                                                         |

The law IDs come from the adapter conformance law set, version 18.

### Writing a driver

Implement `EagerLiveSourceDriver`:

- **`create()`:** returns the Collection built by your adapter's options factory.
- **A `ControlledProvider`:** delivers exactly what the oracle asks for. It delivers snapshots and batches, fails, reports retried failures, disconnects, and completes renewals. `releases()` returns, for each subscription the adapter opened, how many times the adapter released it.
- **`awaitTxId`:** your adapter's utility, if you declare `await-evidence`. It receives the oracle's timeout.
- **`changeCommits`:** `per-batch` if your adapter commits a provider batch as one transaction, `per-change` if it commits each change alone.
- **`declaredDiagnostic`:** optional; accepts console diagnostics your adapter documents, so HEALTH-5 does not reject them.
- **`seed` and `fetchesBeforeListening`:** with `listen-before-fetch`, the provider holds backend rows set by `seed`, treats a batch before the first ready as a backend commit during the fetch, and counts fetches issued while its listener was not live (READY-8).
- **`fieldKinds` and `excludesValue`:** `fieldKinds` are the kinds your backend stores in typed columns; rows then carry `typed`, one field per kind, which the driver writes in the column's form. `excludesValue` names generated values the backend itself cannot store as given (a platform limit, not adapter behavior); record each use in the coverage map.
- **`duplicateInsert`:** with `duplicate-key-delivery`, the law set's policy for an insert of a held key, `error` or `replace`.
- **`valueKinds`:** the kinds of FID-1's `valueDomain` your backend represents; `jsonValueKinds` for a JSON backend. The driver delivers each value in the backend's own form and the Collection must show it decoded.
- **Asynchronous steps and `settle`:** provider methods may return a promise, which the check awaits. A fixture whose deliveries reach the Collection later than a few event-loop turns supplies `settle()`, its law-set `propagationStep`, which the check awaits before every comparison.
- **`source-failure-after-ready`:** declare it when your provider can fail terminally after the first ready (the law set's `terminal-source-end`, or an `errorMapping` that reports a terminal failure); otherwise `fail` is generated only before ready.
- **`observedView`:** if your rows or keys differ from the conformance row, wrap the Collection with `observedView` and a one-to-one mapping. `conformanceKey` maps string keys; `toSqlRow` and `fromSqlRow` map an absent `note` to and from SQL `NULL`.

Declare only the capabilities your adapter supports; the grammar generates
only the steps they allow. Then run `checkEagerLiveSourceHistory` over
`eagerLiveSourceHistoryArb(capabilities)` in a fast-check property. Pass a
reach counter, so the run fails when histories miss a state the laws need.

## Drivers

- **Reference adapter** (`tests/reference-adapter.ts`): a small push adapter
  written to conform. `tests/reference-adapter-oracle.property.test.ts` runs a
  fixed-seed and a random campaign with declared reach, a per-change variant,
  an outage-threshold variant, and 45 hostile mutants of the adapter, each of which the check must reject
  with its law.
  It runs in the default `pnpm test`.
- **Neon Realtime** (`tests/neon/`): `@neon/realtime-tanstack` 0.1.1, vendored
  unchanged from `neondatabase/neon-pkgs` at
  `7ac55e3e7b9e491cc53fa6225bab29d700b729e2` (Apache-2.0, see
  `tests/neon/vendor/LICENSE`), except a `@ts-nocheck` header because it
  targets the TanStack DB 0.9 sync API. It runs on this workspace's TanStack
  DB with a controlled raw live-query subscription. It is expected to fail
  until the adapter is updated, so it has its own config:
  `pnpm --filter @tanstack/db-adapter-conformance test:neon`.

- **Convex** (`packages/convex-db-collection/tests/conformance-driver.ts`):
  the published adapter in eager mode over the real Convex JavaScript
  client, through a controlled WebSocket that answers the sync protocol,
  with complete results and per-batch commits. It runs in that package's
  default `pnpm test`.
- **Electric** (`packages/electric-db-collection/tests/conformance-driver.ts`):
  the published adapter in eager mode over the installed
  `@electric-sql/client`, through a controlled `fetchClient` that answers
  the HTTP shape protocol, with typed Postgres columns and per-batch
  commits. It runs in that package's default `pnpm test`.
- **PowerSync** (`packages/powersync-db-collection/tests/conformance-driver.ts`):
  the published adapter in eager mode over a real local PowerSync database,
  with per-batch commits and a declared propagation step (`settle`). It runs
  in that package's default `pnpm test`.
- **TrailBase** (`packages/trailbase-db-collection/tests/conformance-driver.ts`):
  the published adapter in eager mode over a controlled `RecordApi`, with
  per-change commits and no optional capability. It runs in that package's
  default `pnpm test`.

## Evidence (2026-10-29)

- **Law:** the table above. Authority: the sync callback contract in
  `packages/db/src/types.ts`, the status and health terms in
  `docs/contributing/glossary.md`, and the adapter law set v18.
- **Reach:** in the fixed campaign (seed 2118, 600 histories) on the reference
  adapter, the histories that reached each declared state:

  | Declared state                 | Histories |
  | ------------------------------ | --------- |
  | first-ready                    | 248       |
  | replacing-snapshot             | 77        |
  | change-batch                   | 97        |
  | multi-change-batch             | 327       |
  | failure-before-ready           | 124       |
  | failure-after-ready            | 64        |
  | restart                        | 116       |
  | wait-before-evidence-fulfilled | 48        |
  | wait-timed-out                 | 75        |
  | wait-rejected-at-retirement    | 188       |
  | transient-failure-reported     | 67        |
  | transient-failure-recovered    | 33        |
  | reconnect                      | 62        |
  | renewal                        | 141       |
  | change-before-ready            | 514       |
  | read-missed-change             | 101       |
  | seen-change-superseded         | 26        |
  | field-removed                  | 27        |
  | value:string:load              | 66        |
  | value:string:change            | 95        |
  | value:integer:load             | 85        |
  | value:integer:change           | 130       |
  | value:float:load               | 49        |
  | value:float:change             | 61        |
  | value:negative-zero:load       | 54        |
  | value:negative-zero:change     | 103       |
  | value:boolean:load             | 64        |
  | value:boolean:change           | 104       |
  | value:null:load                | 62        |
  | value:null:change              | 95        |
  | value:date:load                | 51        |
  | value:date:change              | 93        |
  | value:bigint:load              | 74        |
  | value:bigint:change            | 91        |
  | value:array:load               | 71        |
  | value:array:change             | 99        |
  | value:object:load              | 56        |
  | value:object:change            | 99        |
  | zero-sign-flipped              | 74        |

  Each campaign fails when a state is reached fewer than five times. Across
  20 other seeds, the lowest count for any state was 12 (`field-removed`), across 12 seeds.

- **GREEN:** `pnpm exec vitest run tests/reference-adapter-oracle.property.test.ts`:
  68 tests pass (both campaigns, the per-change pair, 32 calibrations, and the
  grammar controls). TrailBase: its full suite, 151 tests, passes.
- **Mutants:** the fixed campaign rejects each with the law it breaks:

  | Mutant                                          | Law                        |
  | ----------------------------------------------- | -------------------------- |
  | `ready-before-delivery`                         | READY-2                    |
  | `wraps-loading-failure`                         | READY-4                    |
  | `failure-clears-rows`                           | HEALTH-1                   |
  | `transient-is-fatal`                            | HEALTH-1                   |
  | `never-recovers`                                | HEALTH-2                   |
  | `transient-fails-loading`                       | RETRY-1                    |
  | `splits-batch`                                  | PUB-1                      |
  | `reverses-batch` (per-change)                   | PUB-1                      |
  | `drops-deletes`                                 | PUB-3                      |
  | `snapshot-merges`                               | PUB-7                      |
  | `leaks-subscription`                            | LIFE-2                     |
  | `restart-replays-rows`                          | LIFE-5                     |
  | `keeps-failed-source`                           | LIFE-10                    |
  | `double-release`                                | LIFE-10                    |
  | `detached-rejection`                            | HEALTH-5                   |
  | `logs-failure`                                  | HEALTH-5                   |
  | `wait-off-by-one`                               | EVID-1                     |
  | `wait-ignores-timeout`                          | EVID-3                     |
  | `disconnect-fails`                              | RECON-1                    |
  | `renew-resubscribes`                            | RENEW-1                    |
  | `drops-buffered`                                | READY-10                   |
  | `buffer-before-rows`                            | READY-10                   |
  | `replays-per-batch`                             | PUB-5                      |
  | `ready-before-buffer`                           | READY-10 (rows when ready) |
  | `merges-updates`                                | FID-1                      |
  | `relabels-inserts` (checker calibration)        | PUB-2                      |
  | `dates-as-strings` (live changes only)          | FID-1 (values)             |
  | `bigints-as-numbers` (initial load only)        | FID-1 (values)             |
  | `drops-nulls`                                   | FID-1 (values)             |
  | `loses-negative-zero`                           | FID-1 (values)             |
  | `typed-booleans-as-numbers` (live changes only) | FID-1 (values)             |
  | `commits-malformed-prefix`                      | PUB-4                      |
  | `ignores-malformed`                             | PUB-4                      |
  | `shows-buffered`                                | READY-10/PUB-9             |

  `reverses-batch` reverses only batches of distinct keys, so its final rows
  are right and only the intermediate publications are wrong. An earlier
  mutant, which fulfilled a wait once any later txid was seen, was equivalent
  within this grammar, because txids are sequential. It was replaced.

- **Shrinking keeps the first violation (ORC-010):** `eagerLiveSourceProperty` treats a smaller history that fails a different law as passing. A shrunk counterexample therefore violates the law the campaign found. A cleanup error after a violation is kept with it in an `AggregateError`.
- **Grammar controls (ORC-004):** these run in the reference oracle file.
  - **Reconstruction:** thirteen witnesses (eleven without values, run on the reference driver without value kinds, and two with values) from the Neon, TrailBase, and RxDB suites and the retry contract are rebuilt as histories. Each is accepted with no skipped step and passes.
  - **Exclusion:** six nearby invalid histories are each skipped by exactly one step; a batch before the first ready is invalid only without `listen-before-fetch`.
  - **Ablation:** removing each step kind loses the declared state that only it reaches, reading after every buffered batch loses `read-missed-change`, rows without notes lose `field-removed`, and live changes without values or retouches lose `value:date:change` while `value:date:load` stays reached.
- **Replay:** during a path replay, fixed campaigns and calibrations stand aside (`oracleReplayTest`).
- **Core finding (typed values):** a random campaign (seed 95028) found
  that a synced update changing only `-0` to `0` published no change
  event: the Collection held `0` while every subscriber kept `-0` (PUB-2).
  Core compared the rows with `deepEquals`, which treats `-0` as `0`. By
  maintainer decision (2026-10-29), `-0` and `0` are distinct row values;
  the synced commit path now compares with `sameRowValue`. A fix that tells
  `-0` from `0` only at the top of a value survives without the `retouch`
  dimension and is rejected with it.
- **RED (Neon):** `pnpm test:neon`. Both campaigns fail. The fixed campaign
  shrinks to `[fail, wait]`: READY-4, status `loading` where `error` is owed.
  Random seeds find READY-4 or, after ready, HEALTH-1: `health.error` is
  `null`.
  The adapter calls `markError`, which the current sync API does not provide,
  so the failure never reaches core.
  - A probe without failure steps passed 300 histories: deliveries, restart,
    timed and untimed waits, reconnect, renewal, publications, and HEALTH-5.
  - A probe with `markError` mapped to `fail` then fails LIFE-10: Neon keeps
    its raw subscription open after the error state until cleanup.
  - A probe that also releases the subscription once at the error state
    passed 300 histories. Those two changes are the scope of the Neon update.
- **Limits:**
  - No on-demand loading, mutation handlers, or reload. These belong to
    other conformance families.
  - Publications are recorded only through `subscribeChanges`. A framework
    adapter's scheduling is not observed.
  - EVID-3 passes a 5 ms timeout and checks for rejection 30 ms later. A
    timed wait settles within its own step, so no evidence arrives during
    it. An adapter that rejects a timed wait at once, before its timeout,
    is not distinguished from one that waits.
  - FID-1 generates ten value kinds (string, integer, float, `-0`, boolean,
    `null`, Date, bigint, array, plain object). Temporal values, Map, Set,
    typed arrays, and class instances are not generated, and a stored
    field's reference identity is not checked.
  - PUB-4 covers one malformed shape, two rows with one key in a complete
    delivery. A malformed key, a row the adapter cannot decode, and an
    out-of-domain value (FID-3) are not generated: a driver needs a backend
    form for each. Whether an adapter releases its provider subscription
    when it rejects a delivery is not checked; no law fixes it.
  - READY-8's fetch order is checked only by a provider that implements
    `fetchesBeforeListening`. Commit receipts resolve at once in every
    driver, so a live commit whose receipt is still pending at the cut
    (READY-10's "does not delay it") is not generated.
  - The Neon and TrailBase claims are limited to the controlled providers. A
    claim about a real client needs a receiving witness against it (ORC-014).
