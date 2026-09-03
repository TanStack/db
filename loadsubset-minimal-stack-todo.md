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
- [ ] Add stale-settlement erasure and replay-equivalence laws.
- [x] Add fixed/random independent-history commutation for disjoint source
      keys at the D2 reconciliation boundary.
- [ ] Add demand-path equivalence where the same demand can enter through two
      public consumer paths.
- [ ] Audit alpha-renaming coverage in the query-identity suite.
- [ ] Add generator reach/statistics for beyond-end exhaustion, failures,
      shared demand, restarts, and tied/null windows.
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
