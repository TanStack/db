# loadSubset minimal-stack checklist

This is the durable execution log for simplifying the RFC #1657 stack. Keep it
current as review findings, oracle laws, and implementation choices change.

## Chosen design

- Keep exact request deduplication and per-subscription ownership.
- Keep relational rows and query semantics in D2 and collection state.
- Keep only the async demand facts that cannot live in D2.
- Recover uncertain replay/publication state with a conservative retained
  snapshot plus authoritative refetch.
- Do not infer coverage, exhaustion, or progress from a request alone.
- Prefer correctness and bounded work over speculative subset algebra.

## Test-preservation rule

Do not equate deleting a topology-bound test file with deleting its contract.
Before removing a test, classify each public behavioral law it contains:

1. retain it unchanged when it still tests the public contract;
2. map it to an existing independent oracle and record the exact destination;
3. rewrite it against public rows, errors, liveness, request/release traces, or
   publication boundaries when it asserts removed private machinery;
4. remove it only when the product contract was deliberately removed, and
   record that design decision in the review ledger.

The denotational pagination oracle, production replay oracle, includes
publication oracles, adapter conformance tests, and all deterministic bug
regressions remain valuable. Registry/WindowState/TotalOrder tests may go only
after their public laws have a destination.

## Oracle design from the reviews

- [x] Keep full recomputation from authoritative source truth structurally
      independent of production helpers.
- [x] Add an exhaustive micro-domain plus fixed-seed and random-seed runs.
- [x] Compare live collections and Effects over the same generated query,
      source truth, and adapter contract.
- [x] Compare final rows, error/liveness state, semantic request traces, and
      bounded publication histories without requiring identical bootstrap
      batching or cursor-vs-offset implementation details.
- [x] Generate valid post-join underfill through a LEFT JOIN residual filter;
      do not fake it with an adapter that ignores its requested predicate.
- [x] Assert each progressive publication is a valid prefix of independent
      recomputation and the final publication is exact.
- [x] Add same-tick obsolete/current replay settlements with `fc.scheduler`;
      release/restart combinations remain in the law map audit.
- [x] Prove stale-settlement erasure and replay equivalence with the public
      replay model, fixed stale/newest cases, and same-tick scheduled races.
- [x] Add fixed/random independent-history commutation for disjoint source
      keys at the D2 reconciliation boundary.
- [x] Require fixed and generated adapter fixtures to honor every requested
      predicate and window. Invalid boundary fixtures had hidden real page
      loads and produced false failures in the window-controller suite.
- [x] Compare the same generated demand through live collections and Effects,
      including rows, errors, liveness, semantic request traces, and batches.
- [ ] Audit alpha-renaming coverage in the query-identity suite.
- [x] Add explicit generator-reach checks for exact-demand repetition and
      window shapes plus shared, failed, stale, released, and post-replay
      histories. Pagination's exhaustive fixtures cover beyond-end, tied, and
      null windows.
- [ ] Run a focused mutation audit after the oracle surface is stable.

## Review-loss audit

The lossless 70-item ledger is `/private/tmp/loadsubset-review-ledger.md`.
Every item A01-A37, AO01-AO09, B01-B08, and BO01-BO16 needs one final state:
fixed with red/green evidence, preserved by a named test, removed by a named
contract decision, refuted with evidence, deferred with an issue, or open.

- [ ] Reconcile all production findings.
- [ ] Reconcile every oracle/maintenance recommendation.
- [ ] Map every public law from deleted full-flow/lifecycle/model files.
- [ ] Confirm no production-only oracle counters or test hooks remain.

## Behavioral-law preservation map

This map is the merge gate for the deleted topology-bound suites. A row is not
complete until its destination proves public behavior or the old contract is
explicitly removed.

| Still-valid law from the large stack                                                                       | Public destination                                                                                                                     | State                                 |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Exact demand identity includes predicate, order, cursor, offset, and limit but excludes owners             | `ir-stable-identity.test.ts`; `subset-dedupe.test.ts`                                                                                  | covered                               |
| Exact unabortable peers share work; abortable owners do not; reject/reset/restart permit retry             | `subset-dedupe.test.ts`; `collection-subscription-replay-oracle.property.test.ts`                                                      | covered                               |
| Ordered windows equal independent full recomputation for live collections and Effects                      | `pagination-oracle.property.test.ts`; `ordered-work-oracle.property.test.ts`                                                           | covered                               |
| Multi-source residual filters refill an underfilled ordered window                                         | `ordered-work-oracle.property.test.ts` exhaustive and generated LEFT JOIN cases                                                        | covered                               |
| Locale, nullable, reverse-index, multi-column, public-key-tie, offset, and beyond-end windows stay correct | `pagination-oracle.property.test.ts`; focused `order-by.test.ts` cases                                                                 | covered                               |
| A non-ordering visible-row update does not cause new ordered source work                                   | `ordered-work-oracle.property.test.ts`                                                                                                 | covered                               |
| Truncate/replay retains the last complete snapshot and publishes one atomic replacement                    | `collection-subscription-replay-oracle.property.test.ts`; `load-subset-replay-refinement-oracle.test.ts`; includes publication oracles | covered                               |
| Stale or released replay settlements cannot overwrite the current generation                               | replay model, fixed stale/newest cases, restart histories, and same-tick scheduler property                                             | covered                               |
| Optimistic rows remain above a private replay and converge after settlement                                | `collection-subscription-replay-oracle.property.test.ts`; collection metadata/state oracles                                            | covered                               |
| Cleanup fences pending replay and ordered continuation work                                                | collection replay oracle; D2 source reconciliation oracle; focused subscription/Effect tests                                           | covered; audit exact old variants     |
| Load errors preserve the exact error, do not hang readiness, and allow a later retry                       | `subset-error-matrix.test.ts`; source-readiness and replay-refinement suites                                                           | covered                               |
| Abort before apply cancels; abort after publication begins cannot undo committed rows                      | `load-subset-transaction-refinement-oracle.test.ts`                                                                                    | covered                               |
| Source truth survives D2 graph teardown/restart and exact prior rows drive retractions                     | `d2-source-reconciliation-oracle.property.test.ts`                                                                                     | covered                               |
| Independent source histories commute                                                                       | `d2-source-reconciliation-oracle.property.test.ts`                                                                                     | covered                               |
| Predicate subtraction behavior outside loadSubset                                                          | existing `predicate-utils.test.ts` unit matrix                                                                                         | retained; generated algebra oracle removed after exposing unrelated pre-existing gaps |
| Binary, Date, Temporal, opaque-reference, and invalid-value identity match evaluator semantics             | comparison, cursor, and `ir-stable-identity.test.ts`                                                                                   | covered; run focused suite            |
| PowerSync tracks the latest demand revision and isolates load/release failures                             | PowerSync on-demand and load-hook suites                                                                                               | retained; run adapter suite           |
| Persistence keeps replacement ownership and preserves reject/abort semantics                               | persistence adapter suite                                                                                                              | retained; run adapter suite           |
| Query DB releases idle ownership without recreating work                                                   | Query DB ownership lifecycle suite                                                                                                     | retained; run adapter suite           |
| The same public demand path yields the same rows and lifecycle state across entry points                   | live collection/Effect parity in `ordered-work-oracle.property.test.ts`                                                                | covered                               |
| Out-of-order settlements and same-tick cleanup/restart preserve the recomputed result                      | replay settlement-order model and scheduler property; pagination multi-source recomputation                                            | covered                               |
| Generated histories visibly reach failure, sharing, restart, tied/null, and beyond-end regimes             | explicit reach checks plus pagination's exhaustive fixtures                                                                            | covered                               |
| Ready transitions survive callback failure, stop when superseded, and restart as a fresh cycle             | `collection-lifecycle.test.ts`; `collection-events.test.ts`; `query/scheduler.test.ts`                                                  | restored and covered                  |
| An already-aborted demand starts no eager, deferred, or adapter work and rejects with `AbortError`         | `collection.test.ts`                                                                                                                    | restored and covered                  |

### Deliberately removed contracts

- Requested options do not prove broader coverage or source exhaustion. Tests
  for `CoverageRegistry`, subset-union/subtraction reuse, `hasMore`, applied row
  evidence, and inferred source extent describe the rejected design.
- `WindowState` and `TotalOrder` are not public abstractions in the minimal
  design. Their public row-order, boundary, truncate-generation, and refill laws
  live in the pagination, ordered-work, cursor, and replay suites above.
- Exact request deduplication does not promise split/merge equivalence across
  different demands. Those demands may each load and must still produce the
  same final public rows.
- The generated predicate-subtraction oracle existed to justify algebraic
  request refinement. That path is gone. Its fixed unit tests remain; its
  broader failures are not a prerequisite for this RFC.

## Current red/green results

- [x] Listener and scheduler failures attempt all callbacks and preserve the
      first exact error.
- [x] D2 input reconciliation retains exact previous rows by key.
- [x] Same-key optimistic/sync publication does not duplicate transitions.
- [x] Sync generations fence stale sessions; rollback is terminal; reentrant
      committed sync batches drain in FIFO order.
- [x] Layout revisions occur only when visible key order or membership changes.
- [x] Ordered live collections and Effects share one source loader.
- [x] A contract-valid LEFT JOIN residual filter red-tested forward refill
      after a boundary request.
- [x] Rows from an active tie request invalidate the next cursor without
      cancelling that request's settlement continuation.
- [x] Restored the public EventEmitter, first-ready, preload, reentrant-ready,
      scheduler-error-priority, and already-aborted request regressions. The
      restored tests red-tested real gaps; the focused seven-file run is
      279/279 green.
- [x] Window operations now synchronously drain the graph work they create and
      wait for both the page request and tie-boundary refinement. Contract-valid
      controller fixtures red/green async rejection and superseding reset.
- [x] Kept the existing includes oracle replay API working while adding named
      replay coordinates. The six includes oracle suites plus utility tests are
      278/278 green.

## Remaining execution

- [ ] Finish the behavioral-law map before accepting test deletions.
- [ ] Run focused core, pagination, replay, includes, Effect, identity, and
      transaction suites after each coherent change.
- [ ] Run Electric, PowerSync, Query DB, and persistence adapter suites.
- [ ] Merge current `origin/main` with a normal merge commit; never rewrite the
      published branch history.
- [ ] Run typecheck/build and the full package suite.
- [ ] Run the 100x fixed/random campaign.
- [ ] Run the focused mutation audit.
- [ ] Measure source and compressed bundle size against both `origin/main` and
      the large RFC stack; keep simplifying if the result is not compelling.
- [ ] Ask multiple fresh reviewers for final coherence, hostile-assay, and
      loss-audit passes.
- [ ] Update RFC/PR text and changeset to match the final design.
