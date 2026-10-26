# Eager cleanup-restart truncate audit

Reviewed code commit: `bb21220123b857e5ff9b8f4ecc332481014fd884`.

This review covers the Collection lifecycle oracle repair and production change
for issue #2163 and PR #2173. The accepted law comes from the Collection restart
contract in `packages/db/src/query/live/ARCHITECTURE.md` and the glossary's
distinct demand, acquisition, sync-run, readiness, and settlement boundaries.
It does not turn an internal direct-subscription result into a public preload
success rule.

## Law, histories, and observation cuts

A demand created while its Collection is cleaned up remains detached until a
new sync run supplies its evidence. For an eager Collection, Collection
readiness supplies that evidence without a subset acquisition. Its direct
subscription reports a pending `onLoadSubsetResult` promise synchronously. A
truncate replay or recoverable error before readiness does not fulfill that
promise. At readiness, the promise fulfills and the subscriber has received the
exact replacement rows. An on-demand control instead uses one settled physical
acquisition.

The bounded matrix enumerates 26 histories:

- explicit eager and default eager configuration;
- absent and present adapter loaders;
- empty and one-row replacements;
- no interruption, truncate replay while loading, and recoverable error before
  same-run readiness; and
- two on-demand controls, one for each replacement.

The direct production driver publishes an old row, cleans up the Collection,
creates demand through `requestSnapshot`, starts a new sync run, and holds eager
readiness. It compares the result promise's settlement, subscription readiness,
Collection status, accepted physical-acquisition count, and final
subscriber-applied rows. The Query Collection receiving witness uses a real
QueryClient, automatic Collection garbage collection, an eager Query
Collection, and `DbClient.preloadLiveQuery`; it holds the second query result
and compares public preload settlement, Collection status, and final rows.

The matrix does not govern demand first admitted after an eager restart,
terminal eager failure, retired or concurrent eager owners, same-turn
interruption schedules, or asynchronous on-demand acquisition. Those limits are
recorded in the coverage map. Public preload failure remains separate from the
same-run internal recovery participant exercised here.

## RED, calibration, and GREEN

Before the truncate repair, 22 of 26 matrix cells passed. Exactly the four eager
cells with a present loader and a truncate replay fulfilled their result promise
and reported subscription readiness while Collection status was still
`loading`. The corresponding absent-loader cells stayed pending. This rejected
the plausible wrong rule that adapter loader presence, rather than sync mode,
decides whether truncate replay reacquires demand.

Production now permits subset reload after truncate only for an on-demand
Collection with an installed loader. The same matrix passes 26 of 26 cells, and
the complete lifecycle history file passes 86 of 86 tests. The related lifecycle,
truncate-readiness, and Query Collection run passes 538 of 538 tests across four
files. Both affected packages build; their linters report no errors, only
pre-existing warnings. Prettier and `git diff --check` pass.

## ORC-001–014 review

| Requirement | Outcome |
| --- | --- |
| ORC-001 contract authority and limits | Applicable. The architecture's direct-subscription restart contract requires cleanup-detached demand to wait for new-run evidence and says eager Collections have no subset reacquisition barrier. The executable prose and coverage map state the bounded histories and open eager regimes. |
| ORC-002 independent judgment | Applicable. The expected function derives settlement, readiness, exact replacement rows, and accepted acquisition count from sync mode and authored history axes. It imports no production classifier, loader-presence branch, or subscription helper. |
| ORC-003 distinguishable responsibilities | Applicable. Opening prose states the law and limits. The companion grammar contains the bounded cases and independent expected observations. The test keeps its real Collection driver and comparisons beside the named checkpoints. |
| ORC-004 generated-history grammar controls | Not triggered by this repair. The 26 cases are bounded enumeration, not a generated property. Every axis and marginal value is listed above. The broader generated lifecycle grammar remains on-demand only, and the coverage map no longer attributes eager coverage to it. |
| ORC-005 production path and observation | Applicable. The driver calls real `requestSnapshot`, cleanup, restart, truncate, error, and readiness boundaries. It observes immediate promise creation, promise settlement, subscription readiness, Collection status, accepted physical acquisitions, and exact final subscriber rows. The recorder does not claim callback-cardinality coverage; the existing acquisition-cell and reentrancy owners retain that separate law. No missing source fact was identified for these checkpoints. |
| ORC-006 checker calibration | Applicable. The pre-repair loader-presence design reached the intended loading checkpoint and failed exactly four eager truncate cells by assertion. Loader-absent, no-interruption, recoverable-error, and on-demand neighbors passed, distinguishing the repaired rule from a trace-only expectation. |
| ORC-007 fixed/random campaigns and replay | Not triggered. This repair changes fixed bounded enumeration, not an important generated property. The surrounding lifecycle owner's existing fixed/random campaigns and replay interface are unchanged. |
| ORC-008 stateful-model minimality | Not triggered. The focused expected function is a stateless projection over one enumerated history. It adds no state to the surrounding stateful lifecycle model. |
| ORC-009 vocabulary mapping | Applicable. Collection status and subscription status stay distinct. Demand, physical acquisition, truncate replay, sync run, readiness, settlement, public snapshot, and private replacement follow the glossary. `result` is the local observation of the `onLoadSubsetResult` promise, not a new production state. |
| ORC-010 failure fidelity and cleanup | Applicable. The focused driver uses `withOracleCleanup`, which preserves a primary refinement failure as the error or `AggregateError.cause`, retains later cleanup failures separately, unsubscribes, and cleans up the Collection. The surrounding generated driver keeps its existing failure-preserving cleanup and shrink context. |
| ORC-011 independent second formulation | Applicable with a recorded limit. The Query Collection witness independently receives the ordinary successful-restart law through automatic garbage collection, Query adapter restart, and live-query preload with a real QueryClient. It does not exercise loader-present truncate replay or recoverable error. Those histories remain evidence at the controlled core boundary only; no public second formulation is claimed for them. |
| ORC-012 review evidence | Applicable. This record is tied to the exact executable commit, accounts for every numbered requirement, records RED/GREEN evidence and the original finding ledger, and makes only the bounded closure claim above. |
| ORC-013 distinguishing boundary witness | Applicable. Loader-present and loader-absent eager truncate cells share sync mode and replacement but differed under the wrong design. Eager and on-demand cells share loader shape but require different acquisition outcomes. Empty and one-row replacements require exact deletion or replacement at settlement. |
| ORC-014 controlled-premise handoff | Applicable. The controlled core adapter establishes the cleanup/restart/readiness premise. The Query Collection witness receives only the ordinary successful-restart premise through automatic garbage collection and a real QueryClient. It does not receive the loader-present truncate or recoverable-error premises, and a live network provider is not part of the claim. |

## Original review ledger

The source review contained eight numbered findings and one execution caveat.
No item is dropped here.

| ID | Original claim | Verdict and evidence | PR action | Durable value |
| --- | --- | --- | --- | --- |
| R1 | A truncate during eager restart loading can resolve early when a loader exists. | Confirmed. Four loader-present eager truncate cells failed before the repair; loader-absent neighbors stayed pending. | `fixed-now` by the sync-mode truncate gate and matrix expansion. | The loader-shape distinction remains a permanent calibration witness. |
| R2 | An eager restart entering error must settle rather than hang. | Split by boundary. The matrix proves that the direct-subscription promise remains pending through legal same-run recovery, while public preloads have their own rejection boundary. The accepted contract does not decide a direct subscription's terminal eager-failure outcome. | `accepted-design` for this PR's scope; the user explicitly chose not to add a terminal direct-subscription contract. The matrix observes `loading -> error -> ready` without claiming terminal or public preload recovery. | Terminal eager failure remains explicitly open in the coverage map. |
| R3 | A second eager request admitted during loading must wait. | Refuted as a product defect. Public authority requires initial live-query readiness to wait for eager source Collection readiness, not every internal eager snapshot result. | No production change and no overbroad oracle rule. | Demand first admitted after restart remains an explicit coverage limit rather than an invented contract. |
| R4 | The eager rule belongs only in a readiness listener, not restart-demand code. | Refuted as a universal repair. It depended on R2 and R3's unsupported internal rule. The confirmed truncate defect belongs at truncate replay's acquisition decision. | No universal listener change; R1 is fixed at `handleTruncate` using sync mode. | Future fixes must keep Collection readiness separate from subset reacquisition. |
| R5 | The coverage map overstates eager coverage because the broader history driver is on-demand. | Confirmed. | `fixed-now`; the coverage map now identifies the bounded eager owner and open eager histories. | Prevents generated on-demand histories from being cited as eager evidence. |
| R6 | The old matrix is pinned cases and misses truncate and error paths. | Confirmed as a coverage criticism, not a demand to convert it to random generation. | `fixed-now`; bounded enumeration grew from 10 to 26 cells with truncate and recoverable-error cuts. | Same-turn schedules and additional owners remain named limits. |
| R7 | The eager physical-acquisition counter is vacuous because eager mode bypasses the adapter loader. | Partially confirmed. The adapter counter cannot detect the wrong eager replay attempt, so it was insufficient calibration by itself. It still correctly observes zero accepted physical acquisitions; counting `_sync.loadSubset` would instead count an acquisition attempt or replay start. The added settlement and readiness assertions kill the loader-driven early-fulfillment design. | `fixed-now` for checker sensitivity through the new loading checkpoints; the proposed metric replacement is rejected. | The record preserves both the valid sensitivity criticism and the acquisition-attempt versus physical-acquisition distinction. |
| R8 | The Query Collection regression relies on one microtask and can leak fake timers when setup throws. | Confirmed. | `fixed-now`; semantic `waitFor` checks replace the single microtask, and an outer `finally` always restores timers. | The receiving witness now fails on behavior rather than incidental microtask count. |
| E1 | Nothing in the original review was confirmed by execution. | Correct for the review at head `5f2210ab`; its Vitest attempt lacked installed dependencies. | `already-fixed` as an evidence gap in this worktree by the RED calibration and GREEN runs above. | Code-reading claims remain labeled separately from executed evidence. |

Ledger totals: five `fixed-now` findings or durable gaps (R1, R5, R6, R7, and
R8), two refuted overclaims with retained coverage value (R3 and R4), one
`accepted-design` scope limit (R2), and one `already-fixed` evidence caveat
(E1). Accounting is complete for the raw review. The accepted bounded
implementation and oracle repair are complete; the coverage map owns the
remaining eager histories named above.

The review supplied a valuable truncate counterexample and correctly challenged
the coverage map, checker sensitivity, and test harness. Its proposed universal
readiness-listener rule conflated public preload readiness with internal
direct-subscription settlement, while its proposed counter replacement
conflated attempts with accepted work. The reviewer showed strong adversarial
instincts but needed better contract-boundary discipline before its complete
proposed fix could be accepted.
The hire recommendation is no for unsupervised oracle ownership at this stage;
the reviewer would still add value in an adversarial code-review role with a
contract-focused reviewer reconciling the findings.
