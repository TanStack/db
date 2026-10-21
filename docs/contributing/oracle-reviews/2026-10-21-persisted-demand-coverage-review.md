# Persisted demand coverage: implementation review

Reviewed head: `cd2aceaec858e0d090fa330d67a9d511c51ba5da`.
Implementation commits: `4fecdc75835ea7b706772b88e9c02caaa60f5caf` (production
change), `42e15a33fc0a7cff5e569bb00f60d3758035b5a2` (truncate history).
RED head: `85372868c05ed933a2234fcf7c5365aa281e48d9` (oracle before the
production change). Merge base with `main`:
`9aecbab4cacb3f1123b1716e6f063abb5affc74f`.

The law, the oracle design, and the wrong designs are in
[the law record](2026-10-20-on-demand-network-first-law.md). This record
contains the evidence obtained against the implementation.

## Law and result

An opted-in persisted wrapper over an on-demand source may settle a demand's
load from SQLite when the persisted subset restore of that demand is visible,
the exact demand key has persisted demand coverage in the current cache
generation, and the wait since the load started has passed or the upstream
load has failed. The upstream load keeps running. Coverage survives release
and ends at a source truncate. For network-first initial rendering, an eager
source permits local rendering after its restore and deadline; an on-demand
source permits it when the query's demands on it have settled.

Authority: the maintainer decisions recorded in the law record (exact keys, the
same wait option and default as eager, joined sources combine, a late failure
leaves the query ready, coverage written through the source-transaction
pipeline). `packages/db/src/query/live/ARCHITECTURE.md` (the persisted-wrapper
paragraph, the initial-readiness limit, and law 7) states the same contract.

Production path: `persistedCollectionOptions` over a generic on-demand source
and `SQLiteCorePersistenceAdapter` on `node:sqlite`. The wrapper's
`PersistedCollectionRuntime.loadSubset` and `loadHydratedSubset` settle a
covered demand. The wrapped `loadSubset` records coverage after the source
load in a metadata-only source transaction. The wrapped `truncate` deletes
coverage keys in its own transaction. In core, `CollectionConfigBuilder`
exposes `initialDemandsSettled()` and notifies subscribers from
`updateLiveQueryStatus`, and `LiveQueryObserver.preloadForInitialRender`
combines the sources.

## RED and GREEN

RED, at `85372868c` with the 96-cell grammar: every production case failed at
setup with `InvalidPersistedCollectionConfigError`. A probe without the opt-in
(recipe in the law record) passed all 72 uncovered cells. It failed 22 of 24
covered cells at the first checkpoint where the law applies; the two
early-network-answer cells pass under both designs. The lifecycle case and the
covered joined case failed, and the uncovered joined case passed.

GREEN, at the reviewed head: the coverage oracle passes all 139 tests (108
cells, the lifecycle history, two joined histories, and calibration). Also at
this head, `packages/db` passes 13,422 tests, `db-sqlite-persistence-core`
passes 1,327, and `electric-db-collection` passes 719. The type errors at
`persisted-oracle.test.ts:4730` and `:4871` also occur with this change's
sources reverted, so this change does not cause them.

Two driver repairs reached production paths for the first time. Neither
changed an expected result:

- Session 1 attached its rejection handler to `preload()` only after the
  answer loop, so the `failed` history produced unhandled rejections.
- The joined comparison included virtual row properties (`$key`, `$synced`,
  ...), which the law does not govern.

## Production mutants (ORC-006)

Each mutant edited one production line. The script lives outside the
repository. Every kill is an assertion failure at a refinement comparison. No
mutant failed at setup, at a `checkpoint not reached` witness, or by timeout.

| Mutant | Outcome |
| --- | --- |
| Coverage ignored (always wait for upstream) | Killed: 24 cells, first `settled-empty, wait 0, pending` at `restored` |
| Wait ignored (settle at restore) | Killed: 13 cells, `wait 1000` covered cells at `restored` |
| Half deadline | Killed: 9 cells at `beforeDeadline` |
| Failure errors a covered demand | Killed: `settled` and `settled-empty`, `wait 1000, fails-early` |
| Coverage recorded before the upstream load settles | Killed: 33 cells, first the `failed` history |
| Deadline from the sync run, not the load | Killed: lifecycle history at checkpoint 1000 |
| Truncate keeps coverage | Killed after `42e15a33f`: 11 `truncated` cells; it survived at `4fecdc758`, before that history existed |
| On-demand opt-in permits fallback alone | Killed: joined `never requested` |
| Gate ignores the eager deadline | Survives this oracle (Part 3 uses a 0 ms eager wait); killed by `persisted-readiness-oracle.test.ts` ("does not hide a query failure behind an available persisted source") |

The "coverage recorded before the upstream load settles" mutant is coarser
than the wrong design it stands for: it records coverage for a load that later
fails, not only for one whose rows fail to persist. The model-level
`durable-write-failed` calibration and the rejecting adapter keep the narrower
design distinguished. No production mutant that writes coverage through a
separate durable path, outside the source-transaction pipeline, was run.

## Requirement outcomes

- **ORC-001:** The opening prose names the law, its sources, and its limits.
  Truncate moved from the limits into the grammar.
- **ORC-002:** The model reads only the history label. It never reads SQLite,
  coverage keys, or the wrapper. The positive witness compares session-1 and
  session-2 keys through `getLoadSubsetDemandKey`. That is a trusted base for
  the witness only; it does not compute any expected result.
- **ORC-003:** The contract, grammar, model, driver, and refinement check are
  separate, and each has prose beside it. The `truncated` history has its own
  prose and ablation note.
- **ORC-004:** Not triggered; the grammar is a bounded enumeration, not
  generated. The file still records ablation for each history, wait, and
  schedule value, and the excluded pre-restore event.
- **ORC-005:** A positive witness checks session-1 demand keys, and a
  checkpoint witness checks the restored rows. For `truncated`, another witness
  checks that the truncate replayed D and that the load stays pending. No
  missing-information hypothesis was identified; this is not a claim of an
  exhaustive search.
- **ORC-006:** Sixteen model-level wrong designs (thirteen in Part 1, two
  lifecycle, one joined), each distinguished at a named case, and the
  production mutants above.
- **ORC-007:** Not triggered; there is no generated property.
- **ORC-008:** The model keeps four facts: covered, visible rows, settled, and
  failed. Each one changes a later observation, as the model prose explains. The
  `truncated` history adds no state; it maps to "not covered" with no rows.
- **ORC-009:** The glossary terms are persisted subset restore, persisted demand
  coverage, and load settlement, and the model prose maps them.
- **ORC-010:** `withCleanup` keeps a primary failure and cleanup failures apart
  in one `AggregateError`, and a calibration test checks this.
- **ORC-011:** No shared-fault hypothesis was named. Demand-key identity is the
  candidate: the oracle trusts `getLoadSubsetDemandKey` to tell the session-1
  demands apart. A second formulation that derives keys independently was not
  added.
- **ORC-013:** The wait threshold has checkpoints at `wait - 1` and `wait`, and
  the lifecycle history has checkpoints ±1 ms around each load's own deadline.
  The half-deadline and sync-run-deadline designs are rejected there.
- **ORC-014:** The controlled premise is a source whose load settles after its
  applied receipt. Two receiving witnesses supply it with a real source. In
  the Electric progressive witness, subset-only coverage settles offline and a
  never-loaded subset waits. In the Query DB witness
  (`persisted-on-demand-offline-witness.test.ts`, added after the reviewed
  head), a covered query settles at the wait or at once on a rejected
  `queryFn`, and a never-loaded query waits. The coverage-ignored mutant fails
  both covered Query DB histories.

## Open in-scope cells

The [coverage map](../oracle-coverage.md#persisted-readiness-and-network-first-initial-rendering)
owns these. Each needs a witness:

- ordered windows and cursor pages in session 2, including a key that ignores
  offset or cursor;
- must-refetch, schema reset, and cache-claim rotation in the coverage oracle;
  Electric must-refetch goes through `truncate`, but no Electric history
  exercises it;
- a failure that arrives before the persisted subset restore publishes;
- optimistic writes on a covered demand;
- nested live queries beyond one outer query over the joined query. After
  the reviewed head, Part 3 adds that nested shape and reads rows at release;
  a gate that reads the root query's demands fails only the nested cells.
- Suspense over a real persisted on-demand Collection. After the reviewed
  head, React and Solid tests receive the joined gate with capability fixtures,
  and the gate mutant that lets the on-demand opt-in permit fallback alone
  fails both.

This record claims a new law, not the closure of a bug class.
