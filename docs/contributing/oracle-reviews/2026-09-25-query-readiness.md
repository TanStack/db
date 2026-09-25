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

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Pass. `ARCHITECTURE.md` now names the synchronous initial-query observation cut: an ordinary initial ordered chain whose acquisitions return literal `true` after their establishing applied receipts are visible drains its synchronous continuations and graph work before the initiating call stack returns. It excludes source exhaustion, broader coverage, explicit windows, repair, replay, and framework render-time behavior. |
| ORC-002 | Pass. `expectedInitialSettlementObservation` derives the expected rows and initial-query status from a two-row finite source and the public literal-`true` versus Promise contract. It imports no ordered-loader classifier, continuation state, generation, or production helper. |
| ORC-003 | Pass. The opening states the contract and limits; `InitialSettlementShape` plus the four indexed/prefix cells are the bounded grammar; `expectedInitialSettlementObservation` is the model; `observeInitialSettlement` is the production driver; and the observation, acquisition-path, boundary-continuation, and release checks form the refinement check. |
| ORC-004 | Not applicable to the new refinement. It is a fully enumerated deterministic 2×2 grammar and makes no generated-history coverage claim. The four cells reconstruct both settlement shapes across an observed indexed page and unindexed prefix request; both require the predicate-only boundary continuation. The Promise cell is the adjacent non-synchronous state. |
| ORC-005 | Pass. The driver uses a real on-demand source, `createLiveQueryCollection`, a live subscription, and public `preload()`. It records the same-call-stack and settled rows/status, exact first-request shape, predicate-only boundary continuation, and request/release identity. `sync.commit() === true` is the positive witness that every establishing write and event was applied before the adapter returned literal `true`. |
| ORC-006 | Pass. `rejects the old Promise-wrapped observation at the synchronous checkpoint` supplies the prior design's exact wrong answer. The refinement check rejects its empty/loading observation as an assertion failure. A temporary adversarial mutation that routed indexed acquisition through the prefix path initially passed all five focused tests; after the request classifiers were added, both eager-index cells failed with observed `prefix` versus expected `page`. Existing direct-loader controls separately reject synchronous write-then-throw, cleanup reentry, and unsafe continuation designs. |
| ORC-007 | Pass. The owner has two important generated properties. Ordered lifecycle and nullable multi-term lifecycle now each run identical fixed-seed and seedless-random lanes with the same arbitrary, production observer, refinement check, run count, and timeout. The random nullable lane retains direct seed-and-path replay through `ordered-work.nullable-lifecycle`. The deterministic initial-settlement refinement remains outside those generated campaigns. |
| ORC-008 | Not applicable. The new finite model is stateless recomputation; it does not introduce, combine, split, or remove state in a stateful reference model. |
| ORC-009 | Pass. Model `synchronous` means the adapter returns literal `true`; `promise` means it returns `Promise<void>`. Existing `AcquisitionPath` prose maps indexed ordered work to `page` and unindexed ordered work to `prefix`. The observed checkpoint is named initial query readiness, distinct from Collection and subscription readiness. |
| ORC-010 | Pass. The refinement performs no shrinking or capture. Its driver releases the live subscription and cleans both live and source Collections in `finally`; it then checks exact request/release identity. The existing lifecycle owner retains failure diagnostics, abort observations, terminal cleanup, and one-release checks for failing histories. |
| ORC-011 | Pass. The named shared-fault risk is collapsing an adapter's return with public visibility before applied receipts or continuation complete. The source driver requires `commit() === true`; warm Query-cache integration tests exercise a different adapter path with zero fetches; and React receiving-driver tests independently observe first non-idle layout-commit rows/status while preserving render-time inactivity. |
| ORC-012 | Pass. This versioned record reports ORC-001 through ORC-011 and is tied to the exact reviewed semantic head above. |

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
