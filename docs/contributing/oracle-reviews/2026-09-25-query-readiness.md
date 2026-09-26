# Query readiness oracle review

- Reviewed semantic head: `44d1d4507455064df2a51235ca17212706987e90`
- Base: `34c78be670b215a994394a73bdfb800a48c91ddd`
- Runtime: Node `24.19.0`, Vitest `3.2.4`
- Primary owner: `packages/db/tests/query/ordered-lifecycle-oracle.property.test.ts`
- Reported behavior: TanStack DB #1894

The repair adds a bounded initial-settlement refinement to the existing ordered
lifecycle owner. It does not change the owner's generated 192-cell lifecycle
product or nullable multi-term product. It adds the missing fixed-seed campaign
for the existing nullable property without changing that property's domain.

| Requirement | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORC-001     | Pass. `ARCHITECTURE.md` now names the synchronous initial-query observation cut: an ordinary initial ordered chain whose acquisitions return literal `true` after their establishing applied receipts are visible drains its synchronous continuations and graph work before the initiating call stack returns. It excludes source exhaustion, broader coverage, explicit windows, repair, replay, and framework render-time behavior.                                                                                                                                                                           |
| ORC-002     | Pass. `expectedInitialSettlementObservation` derives the expected rows and initial-query status from a two-row finite source and the public literal-`true` versus Promise contract. It imports no ordered-loader classifier, continuation state, generation, or production helper.                                                                                                                                                                                                                                                                                                                               |
| ORC-003     | Pass. The opening states the contract and limits; `InitialSettlementShape` plus the four indexed/prefix cells are the bounded grammar; `expectedInitialSettlementObservation` is the model; `observeInitialSettlement` is the production driver; and the observation, acquisition-path, boundary-continuation, and release checks form the refinement check.                                                                                                                                                                                                                                                     |
| ORC-004     | Not applicable to the new refinement. It is a fully enumerated deterministic 2×2 grammar and makes no generated-history coverage claim. The four cells reconstruct both settlement shapes across an observed indexed page and unindexed prefix request; both require the predicate-only boundary continuation. The Promise cell is the adjacent non-synchronous state.                                                                                                                                                                                                                                           |
| ORC-005     | Pass. The driver uses a real on-demand source, `createLiveQueryCollection`, a live subscription, and public `preload()`. It records the same-call-stack and settled rows/status, exact first-request shape, predicate-only boundary continuation, and request/release identity. `sync.commit() === true` is the positive witness that every establishing write and event was applied before the adapter returned literal `true`.                                                                                                                                                                                 |
| ORC-006     | Pass. `rejects the old Promise-wrapped observation at the synchronous checkpoint` supplies the prior design's exact wrong answer. The refinement check rejects its empty/loading observation as an assertion failure. A temporary adversarial mutation that routed indexed acquisition through the prefix path initially passed all five focused tests; after the request classifiers were added, both eager-index cells failed with observed `prefix` versus expected `page`. Existing direct-loader controls separately reject synchronous write-then-throw, cleanup reentry, and unsafe continuation designs. |
| ORC-007     | Pass. The owner has two important generated properties. Ordered lifecycle and nullable multi-term lifecycle now each run identical fixed-seed and seedless-random lanes with the same arbitrary, production observer, refinement check, run count, and timeout. The random nullable lane retains direct seed-and-path replay through `ordered-work.nullable-lifecycle`. The deterministic initial-settlement refinement remains outside those generated campaigns.                                                                                                                                               |
| ORC-008     | Not applicable. The new finite model is stateless recomputation; it does not introduce, combine, split, or remove state in a stateful reference model.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ORC-009     | Pass. Model `synchronous` means the adapter returns literal `true`; `promise` means it returns `Promise<void>`. Existing `AcquisitionPath` prose maps indexed ordered work to `page` and unindexed ordered work to `prefix`. The observed checkpoint is named initial query readiness, distinct from Collection and subscription readiness.                                                                                                                                                                                                                                                                      |
| ORC-010     | Pass. The refinement performs no shrinking or capture. Its driver releases the live subscription and cleans both live and source Collections in `finally`; it then checks exact request/release identity. The existing lifecycle owner retains failure diagnostics, abort observations, terminal cleanup, and one-release checks for failing histories.                                                                                                                                                                                                                                                          |
| ORC-011     | Pass. The named shared-fault risk is collapsing an adapter's return with public visibility before applied receipts or continuation complete. The source driver requires `commit() === true`; warm Query-cache integration tests exercise a different adapter path with zero fetches; and React receiving-driver tests independently observe first non-idle layout-commit rows/status while preserving render-time inactivity.                                                                                                                                                                                    |
| ORC-012     | Pass. This versioned record reports ORC-001 through ORC-011 and is tied to the exact reviewed semantic head above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Verification receipts

- Unfiltered ordered lifecycle owner: 228 tests passed, including fixed and
  random lanes for both generated properties and the four new
  initial-settlement cells.
- Guarded nullable-lifecycle replay reached seed `93472`, path `0`, executed 20
  runs, and reported the requested property witness.
- Full DB oracle campaign: 40 files and 2,135 tests passed.
- Ordered loader, loader-state, lifecycle, work, pagination, default-work, and
  demand-retirement suites: 662 tests passed.
- Query Collection runtime: 180 tests passed; 172 source type checks in the
  same owner plus package `tsc` passed.
- React regular and infinite conformance: 63 tests passed.
- DB IVM, DB, Query Collection, and React DB builds passed.

The source-isolated loss audit is preserved outside the repository at
`/private/tmp/pr2-query-readiness-loss-audit.md`; verdict-critical evidence is
repeated here so this record does not depend on that temporary file.

## Cross-source synchronous work follow-up

- Base: `0eb5b85ddf127e7c2fe5f23dbed2c3f9056c0ea7`.
- Reviewed semantic head: `c4689b746b2e3c402909ee7f05fe38a85a3005c0`.
- Added history: an indexed ordered `FROM` source reaches its predicate-only
  boundary continuation while a sibling `LEFT JOIN` source synchronously adds
  enough rows to fill the initial limit.

| Requirement | Outcome                                                                                                                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORC-001     | Pass. The architecture now requires graph work before another ordered acquisition when any sibling subscriber added synchronous input. The evidence is limited to the initial synchronous cut and does not claim behavior for asynchronous settlement, deoptimized joins, repair, replay, or explicit window moves. |
| ORC-002     | Pass. The expected two-row join and two-request trace come from a finite one-left/two-right relation and the graph-wide input law. The check imports no loader revision, continuation, or top-K helper.                                                                                                             |
| ORC-003     | Pass. The existing owner retains its contract, finite reference, bounded grammar, real live-query driver, and public refinement checks. The fixed cross-source history adds request-work and ready/immediate row observations without changing the generated models.                                                |
| ORC-004     | Not applicable. The follow-up is one deterministic regression and makes no generated-history coverage claim.                                                                                                                                                                                                        |
| ORC-005     | Pass. The driver uses two real source subscriptions and an indexed ordered live query. It proves the page and boundary paths ran, records the exact adapter request trace, and checks rows at the ready callback, immediate preload return, and settled checkpoint.                                                 |
| ORC-006     | Pass. At the base, the exact test failed because production issued a third cursor acquisition after the sibling source had already committed enough joined rows. The graph-wide revision removes that request while preserving both rows at every readiness checkpoint.                                             |
| ORC-007     | Not applicable. No important generated property or campaign changed.                                                                                                                                                                                                                                                |
| ORC-008     | Not applicable. The follow-up adds no reference-model state.                                                                                                                                                                                                                                                        |
| ORC-009     | Pass. `Sibling source input` means changes sent by another `CollectionSubscriber` to the same D2 graph. The production `graphInputRevision` records that graph-wide progress; it is not Collection readiness or source coverage.                                                                                    |
| ORC-010     | Pass. The regression has no shrinking or normalized capture and cleans the live query plus both source Collections in `finally`.                                                                                                                                                                                    |
| ORC-011     | Not applicable. The exact physical request trace directly distinguishes the reported stale-work fault; no plausible shared semantic fault needs a second formulation.                                                                                                                                               |
| ORC-012     | Pass. This versioned, base-identified follow-up records every ORC-001 through ORC-011 outcome and names the exact reviewed semantic head.                                                                                                                                                                                       |

The focused RED run observed page, boundary, then stale cursor acquisition. The
GREEN run observes only page and boundary, with both joined rows visible at all
three readiness checkpoints. Inner and right joins, ordering by a non-`FROM`
alias, and other unsafe plans deoptimize to full-source acquisition and remain
outside this fixed regression.

Verification after the semantic commit: the focused regression passed 1/1; the
complete ordered-lifecycle owner passed 229/229; six surrounding ordered-loader,
ordered-work, and live-query suites passed 311/311; DB build, changed-file lint,
format, and diff checks passed.

## Loss-audit and design-grammar closeout

- Production semantic head: `74e554937a439e89dcadef8ad4a0f61fef0635d4`
- Oracle/test head: `fb6d61421480980ef38037d13ef579e74a3de491`
- Runtime: Node `24.19.0`, pnpm `11.1.0`, Vitest `3.2.4`
- Extraction target: the smallest oracle grammar that preserves ordered initial
  readiness, graph progress, repair precedence, and failure evidence without
  multiplying unrelated lifecycle dimensions.

The closeout changed tests and oracle evidence only. The intended production
behavior remains the behavior at the semantic head. The loss audit recovered
independent ordering directions, continuation depth, Promise-parent ownership,
captured-failure replay, and primary-versus-cleanup diagnostics as material
properties that the earlier review did not fully preserve.

### Model

The preservation contract was frozen before the final grammar changes:

| ID | Preserved property | Authority |
| --- | --- | --- |
| DG-P1 | A literal-`true` initial ordered acquisition publishes its complete initial window before the initiating stack returns. | Architecture and existing public readiness contract |
| DG-P2 | A Promise-returning acquisition promises the settled checkpoint, not the synchronous checkpoint. | Adapter settlement contract |
| DG-P3 | A synchronous ordered continuation drains until it reaches real pending work, exhaustion, failure, or graph input that requires a graph turn. | Architecture and reviewed semantic behavior |
| DG-P4 | Sibling-source input reaches the shared graph before the loader decides that another ordered acquisition is necessary. | Architecture and cross-source regression |
| DG-P5 | Ordering repair takes precedence over a staged ordinary continuation and an explicit window cannot consume stale work. | Reviewed repair semantic head |
| DG-P6 | A fulfilled Promise parent remains owned when its continuation throws; repair debt is recorded without retiring the successful acquisition. | Acquisition ownership and repair contract |
| DG-P7 | Nullable multi-term ordering varies each term's direction and null placement independently. | Public order-by semantics |
| DG-P8 | Readiness evidence includes rows and status; work evidence includes the exact acquisition and release trace. | Oracle observation contract |
| DG-P9 | A primary oracle mismatch remains primary while every cleanup failure remains distinguishable and every cleanup is attempted. | `oracle-tests.md` ORC-010 |
| DG-P10 | Explicit-window, replay, repair, and Effect scheduling laws keep their existing owners; this grammar does not silently absorb them. | Coverage map and user-confirmed scope |

The surviving grammar has four separate subgrammars rather than one artificial
Cartesian product:

1. Initial readiness is `acquisition path × settlement` (`page` or `prefix` by
   literal `true` or Promise), exactly four cells.
2. The existing ordered lifecycle product remains 192 cells:
   acquisition path × delivery phase × window action × outcome × sync-run
   generation × initial/replay barrier.
3. Post-success failure remains its bounded settlement × failure-phase grammar;
   it is not multiplied into initial readiness.
4. Query same-result reentry remains with the Query Collection result-settlement
   owner and is reviewed in the companion result-settlement record.

Graph progress is expressed as three overlays: a quiet multi-step continuation
drain, sibling-source graph progress, and ordering-repair precedence. The
nullable lifecycle grammar retains its 22 declared lifecycle cells and adds a
four-cell primary/secondary direction overlay. Random generation varies both
directions independently. This preserves the missing relation without turning
every lifecycle cell into another four-way product.

### Evidence

Reconstruction reaches every declared cell: four initial-settlement cells, all
192 original lifecycle histories, all 22 nullable lifecycle cells, and all four
direction pairs. Exact uniqueness checks prevent a duplicated declaration from
masquerading as coverage. A four-step synchronous trace
`page → boundary → page → boundary` proves continuation depth rather than only
one-step reentry.

One-at-a-time ablation gave each retained coordinate a distinct job:

- Removing settlement shape erases the synchronous-versus-Promise readiness
  boundary; removing acquisition path erases indexed page versus unindexed
  prefix behavior.
- Removing any original lifecycle axis erases a distinct public checkpoint,
  request shape, terminal outcome, sync generation, window transition, or
  replay barrier.
- Coupling the two sort directions removes `asc/asc` and `desc/desc`; the
  four-cell overlay prevents that false grammar.
- Removing quiet drain, sibling progress, or repair precedence respectively
  permits shallow return, stale extra acquisition, or stale-continuation work.
- Removing Promise-parent retention permits a continuation failure to discard a
  successful acquisition that repair still needs.
- Removing failure-safe cleanup lets a teardown error hide the oracle mismatch.

The nearby invalid designs are therefore concrete: readiness before applied
receipts and continuations, a third stale acquisition after sibling progress,
ordinary continuation before repair, early parent release after a continuation
failure, coupled sort directions, and cleanup replacement of the primary
failure. Explicit-window histories, replay histories, repair histories, and
Effect scheduling remain valid neighboring domains, but their laws stay with
their existing owners. Framework render-time scheduling is outside this
grammar.

The independent formulations have deliberately narrower equivalence claims:

- Direct source and warm Query cache must agree on final rows and readiness,
  while a warm cache has no source acquisition chain to compare.
- Direct source and React must agree on rows and status at React's receiving
  checkpoint; this says nothing about render-time scheduling.
- The sibling-source wait-for-graph history adds an exact physical request
  trace, so it constrains work as well as final rows.

### Process

The extraction source was frozen at the production semantic head, with the
architecture, oracle guide, coverage map, ordered lifecycle owner, loader
regressions, Query Collection owner, and existing framework/cache formulations
as named evidence. Production semantics were not changed to satisfy the
grammar. Candidate coordinates survived only when reconstruction or
one-at-a-time ablation showed a distinct law, checkpoint, exclusion, or active
overlap; otherwise they remained separate overlays or with their existing
owner.

Two hostile controls demonstrate detection and replay:

- A temporary early-release mutant made the Promise-parent continuation test
  fail at the exact lease assertion. Restoring production made the focused test
  pass.
- A temporary `secondary-order` fault failed the random nullable property at
  seed `-1998078481`, shrink path `0:0:0:0:0`, after four shrinks. Direct replay
  with `TANSTACK_DB_ORACLE_PROPERTY=ordered-work.nullable-lifecycle` reproduced
  the same `success-rows` mismatch with zero additional shrinks. Restoring the
  oracle made that exact replay pass.

The cleanup control injects one primary mismatch and two teardown failures. It
proves both teardown callbacks run, the `AggregateError.cause` is the primary
mismatch, and `errors` retains the primary plus both cleanup diagnostics in
order.

The decomposition loss is explicit: separate subgrammars do not prove every
cross-product interaction. The overlays preserve the intersections implicated
by the issue and loss audit; unrelated combinations remain with their existing
owners. This avoids combinatorial confidence without hiding the boundary.

### ORC disposition at the oracle/test head

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Pass. DG-P1 through DG-P10 name the intended laws, authorities, and exclusions. |
| ORC-002 | Pass. Expected rows come from finite-source sorting and slicing; settlement and ownership expectations come from public contracts, not loader continuation or repair machinery. |
| ORC-003 | Pass. The opening contract, scenario grammar, finite reference, real live-query driver, and mismatch/refinement checks remain visible and distinguishable. |
| ORC-004 | Pass. Reconstruction, one-at-a-time ablation, bounded range, overlays, and nearby invalid designs are recorded above; executable uniqueness checks guard the enumerated cells. |
| ORC-005 | Pass. Real source Collections and live queries expose rows, status, requests, releases, repair, and readiness at named checkpoints. |
| ORC-006 | Pass. The early-release mutant and secondary-order fault both reached their intended checkpoints and failed by assertion; neither was a setup failure or timeout. |
| ORC-007 | Pass. Both important generated properties retain equal fixed and random campaigns, and the captured nullable failure was replayed directly by seed, shrink path, and property name. |
| ORC-008 | Not applicable. The closeout introduces no reference-model state and neither combines nor splits existing model states. |
| ORC-009 | Pass. Settlement, acquisition, graph input, repair, readiness, replay, and applied receipt retain their architecture/glossary meanings; overlay-only terms are identified above. |
| ORC-010 | Pass. The harness preserves the primary failure as cause, retains every cleanup diagnostic, attempts all cleanup callbacks, and has an executable hostile control. |
| ORC-011 | Pass. Warm-cache, React receiving-driver, and sibling wait-for-graph formulations state exactly which observations are equivalent and which work or scheduling facts differ. |
| ORC-012 | Pass. This section records every ORC-001 through ORC-011 outcome against exact semantic and oracle/test heads. |

Verification at the oracle/test head: the ordered loader and lifecycle owners
passed 298/298 with test type checking; the Query Collection ownership owner
passed 227/227 across runtime and source type-check projects. DB and Query
Collection builds passed. Changed-file lint reported no errors (two existing
`require-await` warnings remain elsewhere in the Query Collection owner), and
format plus diff checks passed.
