# Query readiness oracle review

- Reviewed semantic head: `552312f58c823a8140b39d16406231864124c29c`
- Base: `34c78be670b215a994394a73bdfb800a48c91ddd`
- Runtime: Node `24.19.0`, Vitest `3.2.4`
- Primary owner: `packages/db/tests/query/ordered-lifecycle-oracle.property.test.ts`
- Reported behavior: TanStack DB #1894

The repair adds a bounded initial-settlement refinement to the existing ordered
lifecycle owner. It does not change the owner's generated 192-cell lifecycle
product or nullable multi-term product.

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Pass. `ARCHITECTURE.md` owns applied settlement, ordered continuation, and atomic window publication. The oracle opening limits the new law to ordinary initial ordered requests whose adapter returns literal `true` after every establishing receipt is applied. It excludes source exhaustion, broader coverage, explicit windows, repair, replay, and framework render-time behavior. |
| ORC-002 | Pass. `expectedInitialSettlementObservation` derives the expected rows and initial-query status from a two-row finite source and the public literal-`true` versus Promise contract. It imports no ordered-loader classifier, continuation state, generation, or production helper. |
| ORC-003 | Pass. The opening states the contract and limits; `InitialSettlementShape` plus the four indexed/prefix cells are the bounded grammar; `expectedInitialSettlementObservation` is the model; `observeInitialSettlement` is the production driver; and `assertInitialSettlementObservation` is the refinement check. |
| ORC-004 | Not applicable to the new refinement. It is a fully enumerated deterministic 2×2 grammar and makes no generated-history coverage claim. The existing generated lifecycle products are unchanged. The four cells reconstruct both settlement shapes across indexed page and unindexed prefix loading; the Promise cell is the adjacent non-synchronous state. |
| ORC-005 | Pass. The driver uses a real on-demand source, `createLiveQueryCollection`, a live subscription, and public `preload()`. It records the same-call-stack and settled rows/status plus request and release identity. `sync.commit() === true` is the positive witness that every establishing write and event was applied before the adapter returned literal `true`. |
| ORC-006 | Pass. `rejects the old Promise-wrapped observation at the synchronous checkpoint` supplies the prior design's exact wrong answer. The refinement check rejects its empty/loading observation as an assertion failure. Existing direct-loader controls separately reject synchronous write-then-throw, cleanup reentry, and unsafe continuation designs. |
| ORC-007 | Not applicable to the new deterministic refinement. No important generated property, generator, recorder, refinement check, budget, seed, or replay interface changed. The unfiltered owner run still executed both existing generated campaigns. |
| ORC-008 | Not applicable. The new finite model is stateless recomputation; it does not introduce, combine, split, or remove state in a stateful reference model. |
| ORC-009 | Pass. Model `synchronous` means the adapter returns literal `true`; `promise` means it returns `Promise<void>`. Existing `AcquisitionPath` prose maps indexed ordered work to `page` and unindexed ordered work to `prefix`. The observed checkpoint is named initial query readiness, distinct from Collection and subscription readiness. |
| ORC-010 | Pass. The refinement performs no shrinking or capture. Its driver releases the live subscription and cleans both live and source Collections in `finally`; it then checks exact request/release identity. The existing lifecycle owner retains failure diagnostics, abort observations, terminal cleanup, and one-release checks for failing histories. |
| ORC-011 | Pass. The named shared-fault risk is collapsing an adapter's return with public visibility before applied receipts or continuation complete. The source driver requires `commit() === true`; warm Query-cache integration tests exercise a different adapter path with zero fetches; and React receiving-driver tests independently observe first layout-commit rows/status while preserving render-time inactivity. |
| ORC-012 | Pass. This versioned record reports ORC-001 through ORC-011 and is tied to the exact reviewed semantic head above. |

## Verification receipts

- Unfiltered ordered lifecycle owner: 227 tests passed, including both existing
  generated campaigns and the four new initial-settlement cells.
- Ordered loader, loader-state, lifecycle, work, pagination, default-work, and
  demand-retirement suites: 659 tests passed.
- Query Collection runtime: 180 tests passed; Query Collection type checks:
  348 tests plus package `tsc` passed.
- React regular and infinite conformance: 63 tests passed.
- DB IVM, DB, Query Collection, and React DB builds passed.

The source-isolated loss audit is preserved outside the repository at
`/private/tmp/pr2-query-readiness-loss-audit.md`; verdict-critical evidence is
repeated here so this record does not depend on that temporary file.
