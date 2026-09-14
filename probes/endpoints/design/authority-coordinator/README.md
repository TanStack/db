# Authority coordination: implementation and evidence

The coordinator preserves bare writable query collections and synchronous real
Transaction actions. Isolated actions install their inline authoritative results.
Overlapping actions run concurrently, then settle as a covered group after every
handler outcome is known and a fresh read covers all retained collections.

## What changed

- Ordinary and initial reads use the same authority admission boundary. Write
  epochs and collection lifetimes invalidate obsolete attempts even after older
  Transactions retire. Obsolete transports cannot block replacement reads.
- DB installs coordinated state before change callbacks. Reentrant notifications
  preserve causal order; public rollback restores all recipient collections before
  notifying. Existing whole-row optimistic ownership and manual pending rollback
  cascades remain intact.
- The Query adapter accepts an optional data-bound application signal. Aborting it
  prevents obsolete queued rows and readiness from publishing. Runtime separately
  cancels Query requests and mirrors approved authority into its cache.
- Cleanup/restart works through the same Collection object. Late collections join
  coverage. A local rollback does not erase a still-running remote operation.
- Handler closure, read success and local persistence receipts are separate.
  Known read failures can recover without retrying writes. Unknown remote outcomes
  stay explicit errors; a later successful read cannot discharge them.

Runtime implementation: `../../integrated-todo/src/runtime.ts`. Small supporting
changes live in DB's publication scheduler, Transaction and DbClient, and Query
Collection's result-application boundary. These use internal batch/settlement
helpers; the authored Endpoint API is unchanged.

## Design trace

The accepted plan ran in order: [Ground Condition](ground.md),
[state machine v1](state-machine-v1.md), [fresh Hostile Assay](hostile-v1.md),
[revised contract](state-machine-v2.md), then red/green implementation.
`freeze-v1.json` preserves the initial artifacts. The existing
[Field Log](../field-trip-optimistic-coherence/field_log.md) records the selections,
readings and implementation receipts.

The hostile audit exposed causal event inversion and unbatched public rollback.
Its repair distinguishes historical event payloads from current reads after a
reentrant action. Graphs agree after the outer publication context drains.
The broader existing oracle also caught a regression introduced by queued
notifications: cleanup must invalidate a prepared child-collection callback.
That now uses a publication lifetime token, and its original test passes.

The adapter probe showed why a generic permit must belong to the result data:
a retained-cache success notification must not acquire fresh authority merely
because a new read started. The adapter supplies the data to its permit callback.
The Endpoint runtime's ordinary Query results are mirrors of already admitted
coordinator state; its publication permit cancels queued mirror applications.

## Verification

Receipts under `../../integrated-todo/evidence/`:

| Check                           | Result / receipt                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original failures               | `authority-red.tap`, `authority-reentry-red.tap`: overlap, stale read, torn fanout, late creation, event inversion                                                                                       |
| Actual runtime                  | `authority-runtime-final.tap`: authority/overlay, read repair, lifetime, local rollback, unknown outcome and authoring failure regressions                                                               |
| DB and adapter                  | `authority-boundary-oracles-final.tap`: 352 tests across 12 suites, including existing lifecycle, ownership, scheduler, optimistic and child-collection oracles                                          |
| Existing contracts              | `authority-contracts.tap`: 18 top-level checks; includes compiler/server-boundary and runtime suites                                                                                                     |
| Generated concurrent full stack | `authority-concurrent-siblings/report.json`: 3 programs × 3 sequences, 25 operations, 81 source notifications, 84 checkpoints; 12 production client artifacts inspected                                  |
| Three-query controls            | `authority-sibling-controls/report.json`: 3 sequences, 6 operations, 20 notifications, 21 checkpoints; all/active/completed views, reverse server/response order, partial failure and insert dependency  |
| Negative controls               | `authority-mutant-inline`: accepting overlapping inline responses fails early-settlement assertion. `authority-mutant-publication-final`: unbatched fanout fails notification-level PostgreSQL equality. |
| Existing sequential path        | `authority-sequential-controls`: inline update and server-code exclusion controls pass                                                                                                                   |

The concurrent oracle executes generated, compiled endpoint code in Chrome over
actual Start requests, Drizzle and the application PGlite. A separate PGlite
database computes tentative and confirmed results. It checks every recorded
source notification, independently folds event history, checks receipts, and
checks rendered consumers. Server execution and response delivery have separate
gates. Fast-check records the actual final shrunk counterexample for replay.

From the app directory:

```sh
ENDPOINT_ORACLE_SCENARIOS=3 ENDPOINT_ORACLE_SEQUENCES=3 npm run test:oracles:concurrent
node --experimental-strip-types tests/oracles/concurrent.mjs --replay tests/fixtures/authority-siblings.json
npm run test:contracts
```

## Bounds and cost

The generated concurrent campaign currently uses waves of 2–4 operations, then
retires the covered cohort together. More complex lifecycle, repair interruption,
local rollback and reentry schedules are actual-runtime regressions, not yet
dimensions in the full-stack generator. This is a foundation, not an exhaustive
concurrency proof.

An isolated mutation keeps one response round trip. The conservative overlap
fallback presently makes one raw read request per retained collection after
closure. For example, two writes with three retained queries used five POSTs.
Combining those repair reads into one server response remains an optimization.
Byte counts measure decoded bodies; harness timings do not establish latency wins.

The Todo query grammar and nonempty optimistic-target restriction remain.
Tables and column schemas are not generated yet, and Endpoints does not implement
on-demand subset loading. The [SQL and on-demand coverage plan](../../SQL-COVERAGE-PLAN.md)
defines that expansion. The pinned embedded oracle is PostgreSQL 17.5.
External writers, replicas with stale reads, auth changes, cross-tab coordination
and durable unknown-outcome recovery are outside this implementation's guarantee.
