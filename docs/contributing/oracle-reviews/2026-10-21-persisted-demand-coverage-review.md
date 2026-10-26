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

## 2026-10-26: code-review findings after merging `main`

Merge head: `5c0e04dce` (merges `main` at `5649a07d4`; the network-first wait
now lives in `waitForPersistedInitialRender`, and the on-demand gate moved
into it). Oracle extension: `e4add5b18`. Repair: the next commit.

A code review reported ten findings. Four were defects under the accepted
contract, one needed a product decision, and the rest were refuted or a cost
only. The oracle was extended first and run against unchanged production:

- three session-1 histories put a reset after a load's rows and before it
  settles: a source truncate, a completed scoped recovery that rotates the
  cache generation, and a scoped recovery still pending;
- Part 3 adds a shape that reaches the on-demand source through two live
  queries, with a history that covers only the inner query's demand.

RED on `5c0e04dce`: 35 failed and 137 passed of 172, all by assertion at a
named checkpoint. In 22 cells an obsolete load recorded coverage. In 12 cells
a coverage record during pending recovery failed the session-1 load. The
two-reader inner-only history released the wait.

Repair: a load records coverage only if no lifecycle change, reset (rotation
or scoped recovery), or source truncate happened since it was forwarded
upstream. The observer gives an on-demand source one gate entry for each live
query that reads it. Because scoped recovery marks a reset before it can abort
the coverage commit, the epoch check also closes the failed-record case; a
`.catch` on the commit had no reachable history and was removed.

GREEN: 172 of 172. Also `db` 13,462, `db-sqlite-persistence-core` 1,535,
`react-db` 601, and the Electric and Query DB witnesses pass. Solid did not
run: its test environment needs a package that the registry proxy blocks.

Mutants, all killed by assertion with no timeout or unreached checkpoint:

| Mutant | Outcome |
| --- | --- |
| Restore the original: any settled load records coverage | 34 cells fail across all three in-flight histories |
| Narrow fix: check only for a source truncate | 23 cells fail in the two scoped-recovery histories |
| Restore the original gate: the first live query reached on a source stands for all | The two-reader inner-only history fails |

By maintainer decision (2026-10-26), multi-tab coordinators are outside the
law: under a coordinator other than `SingleProcessCoordinator`, demand routes
through the coordinator, so a covered demand neither settles from SQLite nor
records coverage. A probe showed a covered demand staying loading offline even
in the leader tab. The coverage map, law record, architecture paragraph, and
guide state the limit.

Refuted: scoped recovery and reload truncates keep coverage (they refresh
memory only; rotation starts a fresh storage target and schema reset deletes
collection metadata); a raw on-demand root releases early (granular mode waits
for its load; wholesale mode requests no demand online or offline). Cost only,
no law: a source's literal `true` becomes a promise, and each load writes one
metadata record. Accepted: coverage keys grow until a truncate or expiry
(#2211).

## 2026-10-26: CodeRabbit and xhigh reviews of PR #2263

Reviewed head: `3de5a922f` (CI green). CodeRabbit review `5655576117` gave five
findings (CR1-CR5) and an xhigh code review gave fifteen (X1-X15). The oracle
was extended first and run against the parent's production code. Maintainer
decisions: Query DB retention expiry ends coverage, through a row-count check
that also covers deletes in a limited window; the certified-baseline clause
is dropped; multi-tab coordinators stay out of scope.

Oracle and witness changes:

- Part 1 adds `settled-then-row-deleted`, and its wrong design "coverage
  ignores rows deleted after it settled".
- Part 2b adds two same-session histories: a load of D after a cache rotation,
  and a `refetch: true` load of D. Both must wait for the network.
- Part 3 adds a source failure on a never-covered demand, which must not
  release the wait.
- The Query DB witness adds a retention-expiry history.
- The Electric witness driver now serializes work, as the driver contract
  requires.

RED on the parent production code (`3de5a922f`): the oracle failed 14 of 188
(11 row-deletion cells, and the refetch, rotation, and source-failure
histories), and the Query DB witness failed its retention history. All
failures were assertions at a named checkpoint.

Repair: a coverage record stores the cache generation's storage ID and the
number of rows the demand reads from SQLite. It counts only for the current
generation and while the restore returns at least that many rows. A load
rewrites the record only when that count changes. A `refetch` load never
settles from coverage. An aborted load clears its wait timer. The gate checks
on-demand settlement on the network-failure path too, and the observer keeps
one entry for each source and owning live query.

GREEN: the oracle passes 188 of 188 and the Query DB witness 4 of 4. Also:
`db` 13,462, persistence 1,415, `react-db` 601, `solid-db` 99,
`electric-db-collection` 719, `query-db-collection` 929. Size against `main`:
`app` +78 B gzip, `db-sqlite-persistence-core` +475 B gzip.

Mutants, all killed by assertion:

| Mutant | Outcome |
| --- | --- |
| Drop the row count | 11 row-deletion cells and the Query DB retention history fail |
| Require more rows than recorded | 28 covered cases fail |
| Ignore the cache generation | The rotation history fails |
| Let a refetch settle on coverage | The refetch history fails |
| Let a network failure bypass on-demand settlement | The source-failure history fails |

Counters, not oracle cases: five loads of one covered demand now cause one
coverage commit, not five. Releasing a covered load leaves no settlement timer
behind, while the unfixed code keeps one.

| ID | Verdict | Action |
| --- | --- | --- |
| CR1, X11 | Confirmed: the glossary entry claimed demand settlement | Fixed: the entry now names the source status only, and the network-first entry carries the demand rule |
| CR2 | Confirmed | Fixed: the law record states its implementation and the query-level signal |
| CR3 | Confirmed | Fixed in the guide |
| CR4, X4 | Confirmed (RED) | Fixed |
| CR5 | Confirmed by reading the driver | Fixed |
| X1 | Confirmed (RED) | Fixed by the row count |
| X2 | Confirmed (RED) | Fixed by the generation check |
| X3 | Confirmed (RED) | Fixed |
| X5 | Refuted: a truncate clears hydrated demand, so the later load must hydrate, and the wrapper rejects a source transaction that crosses a hydration cycle | Recorded as an excluded, illegal history in the oracle |
| X6 | Confirmed by counter | Fixed for writes; each load still reads its row count, and a synchronous `true` result settles asynchronously |
| X7 | Not reproduced; read from the code | Open in the coverage map |
| X8 | Confirmed by reading; deletes are now reached through `settled-then-row-deleted` | Fixed by the row count for deletes; an order change without a delete stays open |
| X9 | Confirmed by counter | Fixed |
| X10 | Confirmed by reading | Fixed: one entry for each source and owner |
| X12 | Accepted as the design direction | The generation and the row count replace per-path invalidation, except the truncate deletion that empty demands still need |
| X13 | Confirmed | Fixed: the observer reuses the exported type |
| X14 | Confirmed | Partly fixed: the eager deadline is read once per source; the demand key is still computed more than once per load (cost only) |
| X15 | Confirmed | The clause is dropped from the law record and the glossary |

## 2026-10-26: second CodeRabbit review

Reviewed head: `f62f9dc19`. CodeRabbit review `5656501808` gave two findings.

| ID | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| CR6 | Confirmed | A real-timer probe with a driver that answers reads on a later macrotask: a load that rejects as soon as it is forwarded raised one `unhandledRejection` during the coverage read, and none after the fix | Fixed: `settleCoveredDemand` observes the upstream rejection before the read |
| CR7 | Confirmed (RED) | The new Part 2b history "keeps a synchronous answer for an already hydrated demand synchronous" failed by assertion: the second request reported a promise | Fixed: a literal `true` returns unchanged, and its coverage record follows without holding the load |

The oracle adds the session-2 schedule `fails-at-once`. Its driver answers
SQLite reads within the same microtask turn, so it reaches the failure path but
cannot hold the rejection across the coverage read. Under the fake clock, a
driver that delays reads with a timer stopped session 2 before its first
checkpoint, so CR6 keeps the probe as its witness. GREEN: the oracle passes
215 of 215, persistence 1,442, Electric 719, and Query DB 929.

The CI failure on `f62f9dc19` in `ordered-work-oracle.property.test.ts` is
issue #2221. Its seed `1535602160` fails the same way on `main` at
`5649a07d4`, in the core ordered loader. The fixed-seed case of that run timed
out under CI load and passes locally in about one second.

## 2026-10-26: closing open limits and the expired-claim finding

Starting head: `5ba90763d` (CI green). The maintainer asked to close the open
limits and then evaluate CodeRabbit review `5657028264` (CR8: a coverage read
under an expired cache claim fails a load whose rows applied).

Test-only commit `0949bc478` turned open limits into enforced cases, with no
production change. Each passed on the existing code except where noted:

- the restore-before-forward invariant;
- macrotask reads in session 2, which put CR6 inside the oracle (removing the
  early rejection handler raises six unhandled rejections);
- a schema reset over an empty covered demand (killed by a mutant that keeps
  collection metadata);
- an optimistic write that rolls back on a demand settled from SQLite;
- ordered windows (Part 4): row deleted, moved out, moved in, swapped, and
  page 2 with an index (killed by a coverage key that ignores cursor and
  offset);
- Electric on-demand must-refetch, and Electric's own load after release;
- React and Solid Suspense over a real persisted on-demand Collection (each
  killed by a mutant that ignores coverage).

An on-demand Electric mock that ended a subset with `snapshot-end` instead of
`subset-end` let Electric settle its load before its rows committed. Coverage
then recorded zero rows, and the offline session went ready on `[]`. The SDK
ends injected subsets with `subset-end`, so the mock now does. The law record
states the dependency on source settlement.

CR8, confirmed on two paths. RED on the parent production code: the session-1
query went to `error` when the claim expired before the coverage record, and
D went to `error` when it expired before the coverage check. With coverage
recording disabled, the first history stays `ready`, so the coverage read
caused it. Repair: a coverage read that fails under an expired claim returns
no count and schedules claim recovery; other failures propagate. GREEN: the
oracle passes 227 of 227.

X7 stays open: a probe that queued an empty load's coverage record during
another demand's hydration, truncated, and started scoped recovery left the
Collection `ready`, but it did not prove that the record was queued when the
truncate listed metadata.

