# loadSubset minimal-stack checklist

This is the durable execution log for simplifying the RFC #1657 stack. Keep it
current as review findings, oracle laws, and implementation choices change.

## Current checkpoint — 2026-09-06

- Pagination transfer repair committed at88fad51b:110 selected rows instead
  of560 in the bounded traversal probe, +38 net production lines. Its focused
 100x and broader1x gates pass; assumptions and local-read costs are below.
- Remaining publication witness corrected in the test model at667ec972:
  raw future source events differ from held-snapshot replacements. Production
  unchanged. Publication100x69/0 and the original failing seed replay pass.
- Full100x oracle/loader run at667ec972 has1469 passing assertions and none
  failed, but exited1 despite JSON success:true. A diagnostic rerun is pending
  with normal error reporting and test console logging suppressed. Do not call
  the full campaign green. Post-commit loss audits are complete; runtime/tests
  remain frozen during verification.
- Still open: whole-branch size goal (+3263 net package-source lines against
  fixedmain68366eca), package test type diagnostics, final coherence/review and
  RFC/PR/changeset reconciliation. Older unchecked entries are phase records;
  reconcile them with later evidence before treating them as current bugs.


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

The compact suite must keep four layers distinct:

1. an independent denotational model computes the right public rows from
   authoritative source truth;
2. a public event-trace model records rows, errors, liveness, adapter requests
   and releases, and publication boundaries without copying production maps;
3. generated commands exercise demand, settlement, source mutation, replay,
   cleanup/restart, failure, and observation in legal orders;
4. metamorphic laws compare consumers and equivalent histories, while fixed
   regressions pin every bug that shaped the implementation.

No correctness comparison may use a production-only counter or infer results
from the same helper that production uses. A counter may enforce an explicit
work bound when row correctness is proved independently.

- [x] Keep full recomputation from authoritative source truth structurally
      independent of production helpers.
- [x] Add an exhaustive micro-domain plus fixed-seed and random-seed runs.
- [x] Preserve named-property shrink replay (`seed + path + property`) while
      pruning the large topology-bound suites. A simplification attempt that
      kept only the seed was rejected because it made failures in a broad
      oracle campaign harder to reproduce.
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
- [x] Assert laws over every relevant request in a trace, not only the last
      request. Ordered loading may add a valid tie-boundary request after the
      page request.
- [x] Compare semantic request content instead of forbidding all extra work.
      In particular, distinguish an unsafe pushed join predicate from a safe
      ordered tie-boundary predicate.
- [x] Compare the same generated demand through live collections and Effects,
      including rows, errors, liveness, semantic request traces, and batches.
- [x] Audit alpha-renaming coverage in the query-identity suite. Explicit
      projections erase lexical aliases, while implicit joined, union, and
      grouped result shapes retain observable aliases.
- [x] Add explicit generator-reach checks for exact-demand repetition and
      window shapes plus shared, failed, stale, released, and post-replay
      histories. Pagination's exhaustive fixtures cover beyond-end, tied, and
      null windows.
- [x] Add a fixed no-progress script to the cross-consumer oracle. It must
      compare rows, error/liveness state, request traces, and the fact that no
      identical continuation is scheduled forever. Under the exact-only
      adapter contract, an empty page is a valid settled underfilled result;
      neither consumer may invent broader source exhaustion.
- [x] Compare normalized semantic request histories across consumers. Keep
      per-consumer request and batch assertions: Effects may expose progressive
      source work, while an ordered live Collection keeps bootstrap and
      imperative-window refinement private until the chosen window is complete.
- [x] Complete the public lifecycle trace: generated histories observe
      demand/release, settlement, source mutation, replay, cleanup/restart,
      failure, and public snapshots at intermediate points. The release path
      now generates a later reacquisition instead of ending the history.
- [x] Complete the atomic-publication observer for root rows and
      collection-valued children so no callback can observe a mixed epoch.
      The replay oracle checks each public batch and callback snapshot; the
      includes publication suites check matching root/facade snapshots.
- [x] Name the retained metamorphic laws: ordered-work consumer parity proves
      consumer equivalence; cleanup/restart and obsolete-replay cases prove
      stale-event erasure; the replay model proves replay equivalence; the
      independent-history property proves commutation; and the demand oracle
      plus `DeduplicatedLoadSubset` tests prove exact sharing. Split/merge
      acquisition equivalence is deliberately absent because the product no
      longer promises subset algebra.
- [x] List each deliberate mutation and the assertion that kills it: - count an aborted obsolete replay as failed and let any attempt choose
      the final outcome -> `lets the newest successful replay replace an
older failed replay` rejects the missing publication; - remove identical page/boundary suppression -> `settles an underfilled
source without repeating one continuation forever` exceeds its finite
      request bound; - page a joined source instead of taking the conservative full-source
      path -> `refills a joined result window through a contract-compliant
source` rejects the extra limited requests; - unload the same physical acquisition twice -> `releases every
successful overlapping replay acquisition` rejects the release count; - flush a truncate replay before its pending demands settle -> `uses the
newest complete multi-demand replay` observes a partial empty snapshot; - disable sync-session epoch checks -> the fixed-seed cleanup/restart
      property observes an old session row in its replacement; - cache an asynchronously completed request after owner abort -> `does
not cache work that settles after its owner aborts` rejects the skipped
      retry; - cache a rejected request -> `retries an exact demand after rejection`
      rejects the skipped retry; - seed an ordered cursor from an unrelated local row -> `does not derive
an ordered boundary from another demand's local row` rejects the
      foreign cursor.
- [x] Do not add a shared on-demand source fixture: only two current tests need
      the protocol, and their local fixtures remain clearer than a premature
      helper.
- [x] Run a focused mutation audit after the oracle surface is stable. Every
      required fault above was killed by its named retained assertion; all
      deliberate source edits were then removed.

The mutation audit must prove that the retained oracle surface kills at least
these faults:

- accept a stale replay settlement;
- repeat an identical ordered continuation forever;
- stop after an underfilled joined page when eligible rows remain;
- release one exact physical request twice;
- publish a partial truncate replacement;
- let a cleaned source session publish into its replacement;
- treat a rejected or aborted request as completed work;
- use a live row outside established source rows as a continuation boundary.

## Review-loss audit

The lossless 70-item ledger is `/private/tmp/loadsubset-review-ledger.md`.
Every item A01-A37, AO01-AO09, B01-B08, and BO01-BO16 needs one final state:
fixed with red/green evidence, preserved by a named test, removed by a named
contract decision, refuted with evidence, deferred with an issue, or open.

- [x] Reconcile all production findings.
- [x] Reconcile every oracle/maintenance recommendation. The final loss audit
      found no runtime gap. It recovered only final naming/docs work and one
      omitted deleted-suite entry. The pre-existing public `getRunCount`
      remains because non-oracle scheduler tests use it to enforce the requested
      no-over-render contract; this branch adds no production-only test hook.
- [x] Map every public law from deleted full-flow/lifecycle/model files.
- [x] Confirm no production-only oracle counters or test hooks remain. The
      Query DB ownership-map hook is gone; the live-query run counter and
      Electric hook both predate this stack and serve existing non-oracle
      suites.
- [x] Verified the audited test reduction against the full DB runtime suite
      (3,297 passed, 6 skipped) and the persistence package's runtime and type
      suites (122 passed, no type errors). The first cross-package run caught
      and fixed an inferred callback return-type mismatch.

### Deleted-suite audit

Audit each removed stack-only suite by test title, not only by file. A checked
row means every distinct public law has a named destination and has been run.

- [x] `load-subset-projection-oracle.property.test.ts` was removed
      deliberately. Every law depended on the discarded outcome/coverage
      projection API (`getLoadSubsetOutcome`, `hasMore`, `appliedRowKeys`, and
      evidence selection); exact settlement makes none of those claims.

- [x] `load-subset-outcome.test.ts`: retain exact sharing, release retry,
      mutable-demand snapshots, source scoping, stale settlement, and cleanup
      fencing; reject only applied-outcome and inferred-coverage contracts.
- [x] `coverage-registry-oracle.property.test.ts`: retain release retry,
      no-reuse-after-release, stale settlement, source scoping, and final-owner
      lifetime; reject registry topology, claims, antichains, and row-coverage
      bookkeeping.
- [x] `load-subset-full-flow-oracle.property.test.ts`: mapped every
      deterministic case by public law. Ordered result and request cases move
      to the pagination and cross-consumer oracles; initial multi-source
      settlement moves to the source-readiness suite; replay, cleanup,
      optimistic overlay, and publication cases move to the public replay
      oracle and focused replay refinements; abort and error cases move to the
      transaction and error matrices; identity and release cases move to exact
      dedupe and subscription ownership tests. The old applied-outcome,
      inferred-coverage, boundary-provenance, and request-refinement cases
      describe the rejected state machine and have no surviving contract.
- [x] `load-subset-lifecycle-oracle.property.test.ts`: retain durable release,
      retry debt, and stale/provisional settlement laws through adapter traces.
- [x] `load-subset-refinement-model.property.test.ts`: retain only laws that
      execute production paths: exact sharing, source isolation, stale-event
      fencing, release, and readiness. Remove model-agrees-with-itself cases.
- [x] `total-order.test.ts`: retain public-key tie breaking, row/boundary
      comparator agreement, and NaN ordering in semantic pagination tests.
- [x] `window-state.test.ts`: retain live-row admission, stale-boundary fencing,
      replay recovery, and shrink/regrow behavior through public rows and
      requests. Reject inferred-coverage state transitions.
- [x] `includes-collection-oracle.property.test.ts`: retain recovery retry,
      cleanup during publication, callback-created work, nested-window failure
      recovery, order-only moves, and root/facade atomicity unless a stronger
      public test names the same law.
- [x] `includes-publication-oracle.test.ts`: retain pending-derived-mutation
      source publication through the collection state/publication oracles.
- [x] `electric.test.ts`: retain adapter-specific applied-commit waiting,
      cancellation/error priority, two-request cursor settlement, refresh
      cleanup, progressive snapshot cancellation, and listener lifetime. Core
      cancellation tests do not replace proof that Electric maps its protocol
      to those contracts.
- [x] Audited every other test file reduced by more than 20% against its prior
      title inventory. The `db-client`, order-only move, persistence,
      predicate, stable-identity, and duplicate-insert reductions have exact
      destinations below. The includes optimistic rewrite retains every test
      title and removes only repeated setup; the collection-index reduction
      removes no test.

## Behavioral-law preservation map

This map is the merge gate for the deleted topology-bound suites. A row is not
complete until its destination proves public behavior or the old contract is
explicitly removed.

| Still-valid law from the large stack                                                                          | Public destination                                                                                                                     | State                                                                  |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Exact demand identity includes predicate, order, cursor, offset, and limit but excludes owners                | `ir-stable-identity.test.ts`; `subset-dedupe.test.ts`                                                                                  | covered                                                                |
| Exact unabortable peers share work; abortable owners do not; reject/reset/restart permit retry                | `subset-dedupe.test.ts`; `collection-subscription-replay-oracle.property.test.ts`                                                      | covered                                                                |
| Ordered windows equal independent full recomputation for live collections and Effects                         | `pagination-oracle.property.test.ts`; `ordered-work-oracle.property.test.ts`                                                           | covered                                                                |
| Multi-source residual filters refill an underfilled ordered window                                            | `ordered-work-oracle.property.test.ts` exhaustive and generated LEFT JOIN cases                                                        | covered                                                                |
| Locale, nullable, reverse-index, multi-column, public-key-tie, offset, and beyond-end windows stay correct    | `pagination-oracle.property.test.ts`; focused `order-by.test.ts` cases                                                                 | covered                                                                |
| Every locale continuation and reversed-index demand stays bounded by a limit or cursor predicate              | `pagination-oracle.property.test.ts` whole-trace bounded-load assertions                                                               | restored and covered                                                   |
| Cursor predicates denote the same nullable mixed-direction tuple order used by pagination                     | `cursor.property.test.ts`; compact semantic `cursor.test.ts`                                                                           | restored; red/green found null-placement bug                           |
| A non-ordering visible-row update does not cause new ordered source work                                      | `ordered-work-oracle.property.test.ts`                                                                                                 | covered                                                                |
| A zero-sized ordered demand starts no adapter work through either a live collection or an Effect              | Cartesian live collection/Effect cases in `ordered-work-oracle.property.test.ts`                                                       | restored and covered                                                   |
| Truncate/replay retains the last complete snapshot and publishes one atomic replacement                       | `collection-subscription-replay-oracle.property.test.ts`; `load-subset-replay-refinement-oracle.test.ts`; includes publication oracles | covered                                                                |
| A joined replacement stays private until every recovering source settles                                      | `load-subset-replay-refinement-oracle.test.ts` “waits for every recovering source…”                                                    | restored and covered                                                   |
| Stale or released replay settlements cannot overwrite the current generation                                  | replay model, fixed stale/newest cases, restart histories, and same-tick scheduler property                                            | covered                                                                |
| Optimistic rows remain above a private replay and converge after settlement                                   | `collection-subscription-replay-oracle.property.test.ts`; collection metadata/state oracles                                            | covered                                                                |
| Cleanup fences pending replay and ordered continuation work                                                   | collection replay oracle; D2 source reconciliation oracle; focused subscription/Effect tests                                           | covered; audit exact old variants                                      |
| Failed adapter release remains retryable for exact and in-flight replay acquisitions                          | `collection-subscription.test.ts` exact-release and replay-release regressions                                                         | restored and covered                                                   |
| Ownership exists before reentrant release for direct/deferred and sync/async adapter starts                   | `collection-subscription.test.ts` Cartesian reentrant ownership matrix                                                                 | restored and covered                                                   |
| A caught or escaped reentrant release failure keeps the exact acquisition retryable                           | `collection-subscription.test.ts` Cartesian failed-release matrix                                                                      | restored and covered                                                   |
| A synchronous replay that drops its demand releases each physical acquisition exactly once                    | `collection-subscription.test.ts` synchronous replay-release regression                                                                | restored and covered                                                   |
| Load errors preserve the exact error, do not hang readiness, and allow a later retry                          | `subset-error-matrix.test.ts`; source-readiness and replay-refinement suites                                                           | covered                                                                |
| Abort before apply cancels; abort after publication begins cannot undo committed rows                         | `load-subset-transaction-refinement-oracle.test.ts`                                                                                    | covered                                                                |
| Source truth survives D2 graph teardown/restart and exact prior rows drive retractions                        | `d2-source-reconciliation-oracle.property.test.ts`                                                                                     | covered                                                                |
| Independent source histories commute                                                                          | `d2-source-reconciliation-oracle.property.test.ts`                                                                                     | covered                                                                |
| Predicate subtraction behavior outside loadSubset                                                             | `predicate-utils.test.ts` semantic unit matrix                                                                                         | restored; null, duplicate-term, and nested-expression laws red/greened |
| Binary, Date, Temporal, opaque-reference, and invalid-value identity match evaluator semantics                | comparison, cursor, and `ir-stable-identity.test.ts`                                                                                   | covered; focused suite 323/323 green (6 skipped)                       |
| Temporal and opaque sortable range operands cross the public subscription boundary unchanged                  | Cartesian adapter-boundary cases in `collection-subscription.test.ts`                                                                  | restored and covered                                                   |
| PowerSync publishes only active demand, fences startup/cleanup, settles current tracking, and retries release | compact public trigger/request/release tests in PowerSync on-demand and load-hook suites                                               | restored; red/green; adapter suite 105/105 green                       |
| Persistence keeps replacement ownership and preserves reject/abort semantics                                  | persistence adapter suite                                                                                                              | retained; run adapter suite                                            |
| Query DB keeps exact owners, idles after eager cache GC, restarts on remount, and clears retained metadata    | Query DB ownership lifecycle suite plus public cache/metadata cleanup tests                                                            | restored; red/green; adapter suite 336/337 green (1 skipped)           |
| Electric waits for public commit application, waits for both cursor requests, and removes session listeners   | focused Electric sync-mode tests                                                                                                       | restored and covered; compact adapter suite 219/219 green              |
| Electric starts no work for an already-aborted request/session and cancels a pending refresh on cleanup       | Cartesian abort-source cases and pending-refresh cleanup in `electric.test.ts`                                                         | restored; red/green found two adapter regressions                      |
| A failed include-demand release cannot suppress a later incarnation or poison a valid source commit           | `includes-temporal-oracle.test.ts` fixed/generated release-reentry laws                                                                | restored and covered                                                   |
| Effect cleanup reports release failure, retains only failed cleanup debt, and retries on the next dispose     | `effect.test.ts` Error and falsy-throw cleanup cases plus obsolete-demand release                                                      | restored; red/green found retry loss                                   |
| The same public demand path yields the same rows and lifecycle state across entry points                      | live collection/Effect parity in `ordered-work-oracle.property.test.ts`                                                                | covered                                                                |
| Out-of-order settlements and same-tick cleanup/restart preserve the recomputed result                         | replay settlement-order model and scheduler property; ordered multi-source public traces                                               | restored and covered                                                   |
| Generated histories visibly reach failure, sharing, restart, tied/null, and beyond-end regimes                | explicit reach checks plus pagination's exhaustive fixtures                                                                            | covered                                                                |
| No-progress ordered loads stop without false exhaustion, hidden diagnostics, or an identical request loop     | `ordered-work-oracle.property.test.ts`; focused live/Effect no-progress script                                                         | covered                                                                |
| A filtered join starts one exact demand per source rather than repeating graph work                           | `ordered-work-oracle.property.test.ts` “loads each source of a filtered join once”                                                     | restored and covered                                                   |
| A zero-sized indexed query can widen later and publishes only its complete window                             | `ordered-work-oracle.property.test.ts` “publishes one complete batch…”                                                                 | restored; red/green found index setup bug                              |
| Reentrant cleanup cannot erase the exact synchronous ordered-load error                                       | `subset-error-matrix.test.ts` “preserves a synchronous ordered error…”                                                                 | restored and covered                                                   |
| Ready transitions survive callback failure, stop when superseded, and restart as a fresh cycle                | `collection-lifecycle.test.ts`; `collection-events.test.ts`; `query/scheduler.test.ts`                                                 | restored and covered                                                   |
| An already-aborted demand starts no eager, deferred, or adapter work and rejects with `AbortError`            | `collection.test.ts`                                                                                                                   | restored and covered                                                   |
| Cleanup during a root/facade publication suppresses callbacks from the cleaned facade                         | `includes-collection-oracle.property.test.ts`                                                                                          | restored as a public observation                                       |
| Internal order-only swaps propagate through root, Collection, array, scalar, and materialized consumers       | generated adjacent swaps in `includes-collection-oracle.property.test.ts`                                                              | restored without private revision counters                             |
| Pending optimistic work never exposes a mixed source/query publication, including same-key confirmation       | collection metadata/state oracles plus the layered-query publication oracle                                                            | retained through independent public-state models                       |
| Canceling one metadata owner cannot cancel a retained owner or publish a row change                           | `collection-metadata-publication-oracle.property.test.ts` fixed/generated public adapter traces                                        | rewritten without private transaction/snapshot topology and covered    |
| Root and facade state cannot diverge when either side rejects a publication                                   | includes root/facade failure regressions plus `bucket-facade-adapter.test.ts` rollback laws                                            | child preparation now precedes the final root commit; covered          |

### Main-branch test audit

- No test file that exists on `origin/main` is deleted.
- The tied-order offset test remains under the clearer name “loads an identical
  orderBy tie class before later window moves.”
- Independent-model nullish reference ordering is restored in the compact
  exact-demand oracle.
- Mutable Date cursor identity and nested order-option snapshots remain as
  compact exact-dedupe regressions.
- Deterministic pagination regressions for settled rank updates, rejected
  cursors, and multi-column tie expansion remain in the pagination oracle.
- Removed main-branch cases that asserted predicate union, subtraction,
  inferred coverage, or shared cancellation ownership describe the rejected
  algebra. Their still-valid exact-demand, error, and mutation laws remain in
  the compact suites above.
- The five removed `db-client.test.ts` cases are covered by the direct/deferred
  ownership Cartesian matrix: adapter-option identity, reentrant release,
  failed-release retry, and failed-acquisition cleanup. The deleted private
  `deferredAdapterOptions` size check described the old implementation, not a
  separate public contract.
- The parked order-only move test replaces the old claim that source order may
  publish through an unrelated persisting mutation. The crossed-peer case is
  subsumed because all source sync stays private until that mutation settles.
- Exact prior-row retraction moved from one helper example to the generated D2
  source-reconciliation law, which covers batches, truncate, teardown, and
  restart. The older duplicate-insert integration tests remain unchanged.
- Demand-value cloning moved from the stable-query identity file to the compact
  exact-dedupe suite. It retains mutable Date/binary snapshots, intrinsic and
  cross-realm bytes, nested ordering arrays, wrapped IN candidates, observable
  accessor rejection, and opaque identity. Fake Temporal-branded objects are
  deliberately outside the contract; genuine Temporal values are immutable.
- Tests added by the large RFC stack are not disposable merely because their
  production topology is gone. Each deterministic regression in the deleted
  full-flow, lifecycle, outcome, total-order, and window-state files must map
  to a named public test or be rewritten before the file deletion is accepted.

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
- The generated predicate-subtraction request-refinement oracle is gone. The
  exported helper still keeps its independent public semantic laws.

## Earlier red/green checkpoints

These are historical results, not a current whole-branch green claim. The
lifecycle completion dashboard below owns current counts. In particular, the
old rollback and superseding-reset statements predate the retained-snapshot
contract; their controller assertions are now named follow-ups below.

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
- [x] The cross-consumer no-progress case exposed duplicate page and boundary
      requests caused by reentrant source publication before request identity
      was recorded. The shared ordered loader now records each request before
      adapter entry; its exhaustive domain includes underfilled source truth
      and rejects repeated exact requests.
- [x] An authoritative truncate row now replaces a completed same-key direct
      mutation instead of restoring the stale client value from the optimistic
      snapshot. Active optimistic work still survives the same rebuild. The
      focused truncate, retained-state, and reentrant-publication suites are
      82/82 green.
- [x] Public unsubscription is terminal even when a publication has already
      snapshotted its listeners. Internal fan-out still uses a fixed snapshot
      so one callback cannot starve sibling graph work; `emitEvents` now skips
      only subscriptions explicitly closed during that fan-out.
- [x] Cross-consumer comparisons now include the complete normalized request
      trace. Each consumer must publish only monotone prefixes of independent
      recomputation; batching itself may differ at bootstrap.
- [x] Restoring the atomic zero-to-n indexed-window regression red-tested a
      missing index: the ordered loader returned early for `limit(0)` before
      installing its index. Index setup now precedes that early return, and the
      loader publishes the two-row result in one public batch.
- [x] Restored the multi-source replay barrier as a public joined-result test.
      Settling one source cannot expose a mixed generation; the pair changes
      in one callback only after both source replays finish.
- [x] Restored exact adapter-release retry for ordinary and pending replay
      acquisitions. These test the adapter trace and logical ownership, not
      the removed coverage registry.
- [x] Consolidated the old reentrant ownership cases into Cartesian public
      adapter-trace matrices. They cover direct/deferred start, sync/async
      completion, caught/escaped release failure, and replay-time release;
      removed coverage-registry assertions were not retained.
- [x] Restored the full adapter failure-value matrix. It red-tested raw
      non-`Error` throws escaping graph commits, release failures turning a
      healthy live query fatal, and failed teardown becoming impossible to
      retry. The adapter boundary now normalizes failure values, demand changes
      keep flowing after cleanup failure, and teardown retains only failed
      callbacks for the next cleanup pass. All 44 cases are green.
- [x] Replaced the old exact ordered-load count with the stronger public law:
      after a source change, a synchronous failure cannot trigger the same
      semantic request twice. Distinct refinement requests remain allowed.
- [x] Unfroze release/reacquire in generated replay histories. This red-tested
      a released row leaking back through a failed peer replay: the stale
      baseline still marked its key as sent, so reacquisition suppressed the
      newer authoritative value. Release now prunes only rows no remaining
      demand owns, updates the retained baseline, and publishes one exact
      delete. The five affected suites are 150/150 green.
- [x] Existing includes, subquery-order, and union tests now model the adapter
      contract and inspect the whole request trace. No useful regression test
      was removed to accommodate the new boundary work.
- [x] Kept the existing includes oracle replay API working while adding named
      replay coordinates. The six includes oracle suites plus utility tests are
      278/278 green.
- [x] The full DB runtime suite is 3,429/3,429 green (6 skipped). The focused
      pagination/typecheck rerun is 102/102 green with no type errors after
      fixing the generic adapter receipt type.
- [x] The focused pagination, ordering, stable-identity, comparison, cursor,
      and binary-value suite is 323/323 green (6 skipped) with no type errors.
- [x] Preserved value identity for large binary keys without restoring the old
      comma-decimal allocation cost. Binary keys now use one code unit per byte
      inside a collision-proof namespace, read indexed bytes rather than a
      custom iterator, and remain content-equal at every size. The comparison,
      binary-ID integration, index, and stable-identity suites are 160/160
      green with no type errors.
- [x] Restored the retained-demand snapshot boundary as a compact unit matrix.
      The reduced suite red-tested four gaps left by the first simplification:
      overridden Date and typed-array methods, cross-realm bytes, computed IN
      candidates, and nested array ordering operands. `cloneOptions` now reads
      intrinsic value state, propagates operator context through wrappers, and
      rejects observable membership/order accessors. The focused identity and
      dedupe suites are 65/65 green with no type errors.
- [x] Rejected the reduced facade tests that had changed retry into data loss.
      Restoring the five public laws red-tested pending parent loss, duplicate
      order entries, a rollback-visible truncate/revision, and early readiness.
      Failed facade installs now retain their root delta, restore by exact diff
      without rebuilding indexes, roll back deferred revisions, and mark new
      facades ready only after every child and root state is installed. The
      facade suite is 5/5 green and the four related publication suites are
      34/34 green with no type errors.
- [x] Ported the full-flow void-result truncate failure into the compact
      ordered oracle. The public regression proves that a live query replaces
      its retained ordered snapshot and reaches a bounded fixed point instead
      of staying stale while scheduling requests forever. Also aligned the
      ready-listener test with terminal unsubscribe. Both focused suites are
      51/51 green with no type errors.
- [x] Removed the unused source-outcome API and its stale architecture claim.
      `loadSubset` again exposes only exact successful settlement; `hasMore`
      never becomes inferred coverage. This deletes the unsafe outcome-free
      state distinction while keeping old `true` and `Promise<void>` adapters
      source-compatible. The four focused core suites are 67/67 green and the
      persistence package is 122/122 green, both with no type errors.
- [x] Kept transaction rollback terminal. Once rollback has rejected the
      public persistence promise, a later adapter settlement is obsolete and
      cannot complete or fail the transaction a second time. The abort/public
      application oracle now states that rule directly instead of consulting
      the deleted event-model projection; the two transaction suites are
      34/34 green with no type errors.
- [x] Preserved terminal-cleanup cost as a public law: clearing a 100-row
      collection emits no synthetic delete batch. Cleanup clears retained
      state directly and reports only the lifecycle transition. The lifecycle
      suite is 42/42 green with no type errors.
- [x] Reconciled the remaining ownership findings from the reviews. Inferred
      coverage no longer exists, so releasing an exact peer cannot erase
      another request's proof. Release retries keep the same acquisition,
      skip no successful external release, and stop after success; the direct,
      deferred, replay, and failure matrices remain in the focused suites.
- [x] Restored Electric's public settlement and resource-lifetime laws instead
      of retaining the deleted applied-commit-capture helper. The external
      signal cleanup law red-tested a real listener leak; cleanup now removes
      each session's forwarding listener. Electric is 495/495 green.
- [x] Rewrote stale Electric and Query DB request-count tests around the exact
      demand contract. Adapter fixtures now honor the full pushed predicate,
      distinguish a logical cursor demand from its two physical Electric
      requests, and reject repeated exact continuations without assuming
      broader requested windows establish coverage. Query DB is 334/334 green.
- [x] Replaced the deleted PowerSync private-state lifecycle matrix with compact
      public traces. The restored laws red-tested four regressions in the
      minimal version: provisional predicates leaked into trigger SQL, cleanup
      could start a queued trigger, release failures were neither isolated nor
      retried, and an overlapping acquisition could lose a row during eviction.
      The suite also preserves current-revision settlement, all-batch applied
      settlement, startup cancellation, eager startup flushing, observation
      failure, superseded-trigger disposal, and cleanup-after-trigger-creation.
      PowerSync is 105/105 green
      with no type errors.
- [x] Replaced Query DB's private ownership-map inspection with six public row,
      cache, request, and metadata laws. The new idle-GC law red-tested an eager
      refetch loop. The retained-metadata law then found that explicit cleanup
      left a GC marker behind, and the restart law found that async cleanup could
      remove the next sync session's Query. Cleanup is now synchronous at the
      adapter boundary, eager cache GC stays idle until remount, and the full
      adapter suite is 336/337 green (1 skipped) with no type errors.
- [x] Replaced cursor AST-shape properties with an independent denotational
      tuple-order oracle. It red-tested cursor predicates that ignored explicit
      null placement. The reference evaluator also falsely modeled SQL
      comparisons as null ordering; it now returns SQL unknown for nullish
      comparisons. The four focused DB suites are 144/144 green, and the
      Electric and PowerSync compiler suites are 88/88 and 30/30 green.
- [x] Restored bounded-work regressions without pinning request counts. The
      reversed-index case checks the whole adapter trace, the zero-window law
      covers both consumer entry points, and Temporal plus opaque sortable
      operands are observed at the adapter boundary. The three focused files
      are 145/145 green with no type errors.
- [x] Audited every removed includes-collection case. Combined recovery is
      covered by the retained root and facade failure/retry tests; nested
      window rollback is covered at the public window-controller boundary;
      callback-created work and deferral cleanup are covered by the sync
      reentrancy suite. Restored the two unique public laws: cleanup during a
      root/facade publication and generated internal order-only swaps across
      every materialization. The five-file includes/publication run is 106/106
      green with no type errors.
- [x] Replaced the metadata oracle's deleted private snapshot contract with
      public adapter behavior. Cancellation now uses the public abort signal
      and observes rows, batches, receipts, and `metadata.row.get`; the
      fixed/generated suite is 6/6 green. Child facades are prepared before
      the root commit, so a child failure cannot require a whole-collection
      rollback. Existing root-failure and facade-rollback tests cover the two
      real publication boundaries; the combined five-file run is 224/224
      green.
- [x] Restored runtime reference identity for function and symbol equality
      values. The preservation audit caught that the reduced factory accepted
      only objects even though the evaluator can compare all three domains by
      reference. Entropy is now allocated lazily, symbol identity uses a small
      runtime map, and query/demand identity remains stable and collision-free.
      Identity and exact-dedupe suites are 70/70 green with no type errors.
- [x] Derived cross-source replay gating from each subscription's pending
      replacement instead of mirroring source IDs in the query builder. The
      focused ownership test also exposed a false-green assertion and a real
      handoff bug: reentrant release during synchronous replay unloaded the old
      acquisition twice and leaked the new one. The test now compares exact
      acquisition identities, the replay retires each once, and the focused
      replay/publication run is 184/184 green.
- [x] Strengthened the PowerSync release oracle from “one transient failure
      retries” to “one permanently failing release cannot block an independent
      release.” The first assertion draft was itself false-green because the
      first release's SQL mentioned the second active predicate; the corrected
      assertion identifies the departing predicate. It red-tested the queue's
      head-of-line blocking, and the drain now tries every queued release once
      before backing off. All three focused retry/revalidation cases are green.
- [x] Removed duplicate live-query builder bookkeeping and reused the shared
      run-all/throw-first callback law for source loaders. Window rollback and
      nested failure behavior remain unchanged; the focused builder, ordered,
      error, and window-controller suites are 279/279 green (6 skipped).
- [x] Collapsed PowerSync's demand lifecycle to the two states that can exist
      in its map: provisional and active. Released and failed entries are
      removed immediately; stopped plus the tracking revision already fence
      cleanup, so the mirrored lifecycle generation is gone. A post-commit
      loss audit found that terminal cleanup still needed to remove each record
      before invoking its hook: a later hook could otherwise reentrantly unload
      and clean an earlier demand twice. The new public resource-lifetime law
      red-tested that bug; PowerSync is 106/106 green.
- [x] Kept PowerSync's tracking revision ahead of user cleanup hooks. A loss
      audit found that extracting the shared cleanup helper had moved the
      revision bump after the hook, so a reentrant unload could repeat the
      same physical release query. The public reentrancy test failed first;
      the full PowerSync suite is now 107/107 green.
- [x] Derived replay-publication control from the subscription's existing
      options and centralized unknown-value error normalization. The focused
      subscription, replay, live-query, and error suites are 144/144 green.
- [x] Mapped the removed pending-derived-mutation matrix to the independent
      collection metadata and state-retention oracles, then verified both
      through the layered-query publication oracle. The old Cartesian matrix
      repeated the same collection law at each query shape; the retained tests
      keep the collection law and the graph transport law separate.
- [x] Audited the removed Electric settlement matrix. Retained public commit
      application, both physical cursor requests, progressive pre-application
      cancellation, refresh cleanup, retry, and listener lifetime. The compact
      abort-source and refresh-cleanup cases red-tested two regressions: an
      already-aborted session resolved successfully, and cleanup left a load
      parked on the refresh timeout. Electric is 219/219 green with no type
      errors. Request-scoped cancellation after `requestSnapshot()` begins is
      not claimed: Electric exposes neither a request signal nor request IDs on
      streamed rows, so the adapter cannot safely retract one overlapping
      request. The source documents that upstream boundary.
- [x] Reduced Effect cleanup to failed-callback debt without weakening
      reentrancy. A loss audit found that nested disposal could remove a
      callback whose outer invocation then failed. Cleanup now iterates a
      snapshot and restores that failed release; the public test failed first
      and all 69 Effect tests pass.
- [x] Derived scheduler publication failure from the presence of the active
      context instead of storing a second boolean. Scheduler, lifecycle, and
      change-event suites are 124/124 green.
- [x] Treat a changed or deleted row from a finite ordered prefix as loss of
      source-order authority. The 10x state campaign found implicit-key top-K
      windows retaining an updated row after it fell below an unseen row. The
      pinned top-one, offset, and wider tie cases failed first. They now reuse
      the existing full-source recovery path; the pagination suite is 127/127
      green and its 10x transition campaign also passes.
- [x] Preserve each real adapter failure while its public error callback
      performs reentrant cleanup. A loss audit found that the first guard only
      covered observer-release failures. The Cartesian regression failed for
      synchronous load throws, asynchronous load rejections, and truncate
      replay rejections; all error delivery now shares one scoped cleanup
      barrier, so cleanup debt cannot emit a second error or replace
      `lastError`.

## Remaining execution

- [x] Make equality identity the actual D2 grouping key while preserving one
      raw representative only for output. Red/green the full equality-class
      matrix, including Date/number, invalid Date/NaN, and unhashable symbols.
      The loss audit then recovered four false-greens: the first correlated D2
      join still used raw keys, compiler aggregate names could collide with
      selected aliases, representative choice depended on insertion history,
      and raw cyclic values still entered D2 hashing. Each now has a failing
      regression and uses canonical join keys, a disjoint local field namespace,
      stable row-key selection, and an opaque exact-identity carrier.
- [x] Replace string-keyed parent-context metadata with a collision-free
      carrier. A loss audit found that the first fix covered only
      `__parentContextIdentity`; valid `__parentContext` and `__correlationKey`
      aliases still shared the compiler's route namespace. Route metadata now
      uses a private symbol, and the grammar crosses all three former internal
      names with parent aliases, selected fields, and direct, `QueryRef`, join,
      and group boundaries.
- [x] Repair the route-metadata gaps recovered by the fresh loss audit of the
      symbol carrier. The grammar now crosses object-valued `QueryRef` scalars,
      nested functional projections that spread source rows, and implicit
      joined output with all three include forms and parent/child updates. It
      failed first on all three shapes. Opaque values now retain their identity,
      and an immutable recursive boundary copy removes internal symbols without
      corrupting D2 retractions. The context grammar is 89/89 green and the four
      broader includes oracle suites are 207/207 green.
- [x] Close the public-surface product gaps found by the loss audit of that
      repair. Four new grammar cells failed first: an opaque wrapper exposed a
      routed descendant, clean nested payloads lost reference identity, and an
      enumerable `__proto__` key was lost while changing the output prototype.
      Callback and facade boundaries now share one cycle-safe copy-on-write
      transform that copies only private paths and defines keys safely. The
      symbol assertion now permits user-owned symbols and traverses opaque,
      `Map`, and `Set` containers. Context, facade, functional, grouping, and
      broad includes suites are 450/450 green.
- [x] Scope symbol correlation identity to releasable graph state. Every
      compiler path now shares one identity scope through its compile cache;
      the scope dies with the graph, and demand-controller cleanup replaces its
      scope. The regression failed first because two independent compiled
      graphs reused the same process-global symbol token. Grouping, stable
      identity, route-context, and temporal-demand suites are 281/281 green.
- [x] Keep graph-local group identity out of public Collection keys. The prior
      scope regression encoded the leaking token as success. Its corrected law
      failed first: opaque keys were arrays and changed across graphs. Grouping
      now uses scoped equality only inside D2 and derives a stable public key
      from process identity. Two same-description symbols remain distinct, and
      a retained key works after delete/reinsert. Grouping and includes suites
      are 226/226 green.
- [x] Bound local-symbol identity retention within long-lived scopes where the
      runtime supports weak symbol keys. Local symbols now use weak identity
      storage when available, registered symbols use their registry strings,
      and older runtimes keep the correctness-preserving strong fallback. The
      focused identity suite fails on the old strong maps and passes 54/54.
- [x] Close the routed-callback and public-value gaps from the next loss audit.
      Recursive and union sources now remove every compiler-owned field before
      user callbacks. The copy-on-write boundary preserves descriptors without
      evaluating unused accessors. Tightened child-update cells then exposed a
      D2 hash collision for symbol-only changes; structural hashes and deep
      equality now include enumerable symbol keys and keep distinct symbols
      distinct. The follow-up audit caught that registered symbols cannot be
      weak keys; those now use their registry string while local symbols remain
      weakly held. The regressions failed first, all 329 db-ivm tests pass, and
      the six focused includes/grouping suites are 155/155 green.
- [x] Make equality auto-indexing safe for symbol-valued join fields. The
      comparator now gives symbols a stable runtime-local total order instead
      of throwing during B-tree construction. The direct auto-index regression
      failed by falling back to a scan and logging a warning; comparator,
      auto-index, and symbol-route suites now pass 65 focused tests and the DB
      package build is green.

- [x] Restore the exported `minusWherePredicates` laws for SQL nulls,
      duplicate terms, and nested `NOT`/range expressions; fix the false-green
      syntax-only assertion and stack overflow. All 145 predicate utility
      tests pass.
- [x] Restore the end-to-end hydration → adapter replacement → late hydration
      authority law. A mutation that retained provisional hydration authority
      failed the restored public assertion; all 38 DbClient tests pass.
- [x] Restore ordered multi-source late and out-of-order settlement laws. Two
      compact public traces replace the topology model: tied primary rows
      exhaust before either a delayed child publishes or an empty child source
      settles, and two independent ordered joins settle their child loads in
      reverse across separate commits without sharing readiness. All 17
      ordered-work tests pass.
- [x] Restore the `Effect × autoIndex: off × joined limit(0)` no-work law and
      its live-collection peer. The test red-tested a real child-source fetch:
      a zero window suppressed the ordered source but still eagerly loaded an
      unindexed join source. Both runtimes now suppress every initial source
      load for a zero window; the eager/off × collection/Effect matrix passes.
- [x] Finish the behavioral-law map before accepting test deletions.
- [x] Run focused core, pagination, replay, includes, Effect, identity, and
      transaction suites after each coherent change. The final recovered-law
      pass is 172/172 green with no type errors.
- [x] Run Electric, PowerSync, Query DB, and persistence adapter suites.
      Electric is 504/504 green, PowerSync 108/108, Query DB 336/336
      (1 skipped), and SQLite persistence core 122/122; all typechecks pass.
- [x] Merge current `origin/main` with a normal merge commit; never rewrite the
      published branch history. The only conflict preserved main's lazy
      runtime-identity initialization and this branch's object/function/symbol
      identity domains; the focused identity suite is 70/70 green.
- [x] Run typecheck and the full package suite. The standalone package
      typecheck passes, and the full DB run is 3,515/3,515 green (6 skipped)
      across 139 files with no type errors. The same full run passes after the
      main merge, and every package in the monorepo builds successfully.
- [x] Run the 100x fixed/random campaign. The demand, replay, ordered-work,
      pagination, and includes suites pass every fixed and random property.
      After the fail-closed replay repair, the affected demand, replay,
      ordered-work, and pagination suites passed another 100x campaign with an
      extended per-property timeout. After the final loss-audit additions, the
      ordered suite passed 4,000 more generated histories (2,000 fixed-seed
      and 2,000 random-seed) plus its full deterministic matrix. The final
      replay pass covered 30,000 multiplier-controlled histories and the
      pagination pass covered 6,400 histories across nullable cursors, pending
      mutations, multi-action races, and window transitions.
      The long includes oracle passes 133/133 assertions with no type errors
      in two isolated runs. Vitest 3.2 then reports its own
      `[vitest-worker]: Timeout calling "onTaskUpdate"` after the file has
      passed, even with one worker, coverage disabled, and all test logs
      silenced; treat that non-assertion runner failure as a harness limit.
- [x] Run the focused mutation audit.
- [x] Close the graph-replay boundary missed by the direct subscription model.
      A delayed full-source load created from the replay start hook was not part
      of the replay barrier, so an ordered query could expose a partial window.
      Reopening the graph after a rejected replay was also unsafe: later source
      changes could mix the old graph baseline with a partly replayed source.
      Both bugs failed first through public live-query assertions. Loads started
      during replay now join its barrier; synchronous recovery throws are
      contained; and failure keeps the old public result while partial graph
      state stays private until a later authoritative replay succeeds.
      Releasing a demand removes its barrier and loading-status participants
      even when its adapter promise never settles. The direct replay oracle
      cannot see the graph boundary, so the retained live-query regressions
      remain in the ordered-work and graph replay suites.
- [x] Retire the graph replay gate when its last logical demand leaves after a
      failure. A public include trace first proved that an unrelated parent
      deletion stayed hidden forever; it now publishes as soon as the failed
      child route retires.
- [x] Keep one ordered full-source demand across an asynchronous recovery
      failure. The next truncate now replays that exact demand once, restores
      the authoritative source, and publishes one complete top-K replacement.
- [x] Separate retired cleanup leases from active logical demands. A failed
      unload remains retryable at cleanup but no longer joins later truncate
      replay or contributes to loading status.
- [x] Make the ordered-provider oracle apply ordinary predicates before its
      window. This red-tested a locale-collation hole: boundary equality was
      mistaken for a safe refinement even when provider and local ordering can
      disagree. Unsupported string order now falls back to one unbounded load.
- [x] Use the same conforming provider model for ordinary boundary loads. It
      exposed another false green: multi-column prefix loading did not
      revalidate after a non-boundary delete because the prior prefix request
      stayed deduped. If the same finite prefix still underfills the local
      window, Collection and Effect now fall back once to a full-source load.
      This removes their duplicated broad invalidation rule while preserving
      exact rows and bounded source work.
- [x] Make every RFC oracle reachable from the package oracle script. Generated
      pagination histories now also assert ready/error state, bounded graph
      work, and exactly one public publication per semantic result change (zero
      for a no-op). A refill may require a second private graph run but cannot
      wake consumers twice.
- [x] Close the final loss-audit gaps. Sync throws and async rejects now prove
      that a failed replay reopens only after its last logical demand retires.
      Pending-status tests separate retired demand from a surviving demand and
      retry the same cleanup debt through two failures. Pagination histories
      capture rows at callback time, cover error identity and liveness on the
      rejecting cursor path, and bound async adapter work and publications.
      Ordered recovery asserts one complete public replacement. The root
      `test:oracles` command now includes both core and Query DB oracle suites.
      The architecture and changeset record the exact cleanup lease,
      underfilled-prefix fallback, and deferred full-source retry policy.
- [x] Close the queued and reentrant replay setup races. Back-to-back truncates
      in one turn first proved that a superseded microtask could start work
      outside the newer attempt's abort sweep. Exact option-identity assertions
      then proved that reentrant old-lease cleanup unloaded the old acquisition
      twice and leaked its replacement. Obsolete setup now exits before source
      work, and replacement ownership becomes visible before the old lease is
      released so each physical acquisition retires once.
- [x] Extend the live collection/Effect oracle through a multi-column ordered
      delete. It found an underfilled residual-join window that a repeated
      finite prefix could not repair. Both entry points now use the shared
      one-time full-source fallback; the existing pagination oracle killed the
      old behavior, and the cross-consumer oracle proves final rows, liveness,
      and bounded work without requiring identical graph schedules. The full
      core oracle gate is 514/514 green; Query DB adds 42/42 green (1 skipped),
      with no type errors.
- [x] Recover the two laws found by the post-fix loss audit. A tied primary
      order now mutates a later order term and proves the same rows and demand
      forms through live collections and Effects, while allowing their bounded
      refinement schedules to differ. Full-source recovery now fails twice
      before succeeding and proves every established acquisition is released
      exactly once. Both additions pass without another runtime change.
- [x] Reconcile the Query DB ownership test with shared physical acquisition.
      An ordered window may retain an already-complete broader acquisition so
      it can refill locally; releasing the first consumer must not discard the
      extra cached row while the ordered consumer still owns that acquisition.
      The final consumer release still empties the collection. The complete
      Query DB suite is 336/336 green (1 skipped).
- [x] Close snapshot reentrancy and exact replay-release gaps from the final
      hostile review. Unsubscription is now a terminal observation fence: a
      direct snapshot cannot deliver after adapter work unsubscribes, and a
      limited snapshot cannot start adapter work after its local callback
      unsubscribes. If an old replay lease release both retires the logical
      demand reentrantly and throws, cleanup retains that exact old lease as
      debt without releasing the replacement twice. The follow-up loss audit
      expanded that fence through result hooks, unoptimized fallback, async
      adapter settlement, and nested cleanup; an in-flight exact acquisition
      can no longer be released twice by reentrant unsubscribe. All 81 focused
      ownership and replay tests pass with no type errors.
- [x] Make replay authority generation-safe and bounded. Failed direct
      subscriptions keep ordinary deltas and snapshot requests private until a
      later authoritative replay, so they cannot expose a mixed generation.
      Private direct state is folded into one row map and settled historical
      attempts are pruned. Overlapping attempts still gate publication until
      they settle because Electric cannot cancel an in-flight shape snapshot;
      dropping that barrier would allow late stale rows from a supported
      adapter. A final cross-adapter audit rejected the never-settling
      predecessor law: `loadSubset` must settle, and Electric's in-flight
      snapshots cannot be canceled safely. The bounded form retains only
      unsettled overlap and passes all 86 replay-focused assertions with no
      type errors.
- [x] Make ordered settlement include synchronous adapter refinements. A
      prefix result no longer lets initial preload or `setWindow()` settle
      before its required tie-boundary and forward-refill chain. Initial
      boundary failure is fatal, incremental retry remains possible, and an
      imperative window publishes one completed snapshot even when a
      contract-valid source returns one row per request. The audit also found
      and removed redundant prefix loads after a full-source fallback.
- [x] Close the ordered-settlement audit gaps. A failed page/boundary chain now
      keeps its advanced source and D2 state private while the last complete
      public snapshot remains visible; a later retry publishes one coherent
      replacement instead of recomputing an old window over contaminated
      source state. Failed offset moves emit no false leave/re-enter batch,
      cleanup resets the settled window to the new sync session, and caller
      mutation cannot rewrite stored window options. A superseding window
      waits for any older refinement that still gates publication, even when
      the new window needs no new source rows. Sequential page and boundary
      requests settle their predecessor as soon as the next participant is
      registered, bounding retained promise state instead of keeping every
      ancestor alive. The audit also corrected the architecture: ordinary
      source mutations that arrive during a window rebuild join its private
      state and publish with the completed replacement.
- [x] Close the frozen-window loss-audit gaps. An asynchronously rejected
      full-source refinement clears its completion marker so the same window
      can retry. Partial window moves inherit omitted fields from the active
      request or last settled window. Cleanup rejects an abandoned imperative
      move with `AbortError` instead of falsely reporting that its discarded
      result became visible. All three public regressions failed before the
      fixes and passed after them.
- [x] Close the recovery follow-up audit. An explicit full-source retry now
      replaces its failed logical demand, so later replay and cleanup acquire
      and release each exact lease once. A successful authoritative replay
      clears the ordered publication latch and emits one complete window.
      Window-operation generations remain monotonic across cleanup/restart,
      preventing an abandoned rejection from corrupting the new session's
      partial-window base. All three public traces failed before the fixes.
- [x] Separate source-replay settlement from window-operation settlement. A
      window move now waits for an active replay and rejects against a failed
      replay without advancing `getWindow()`. Replay success removes only its
      source barrier; it cannot publish a physical window abandoned by an
      earlier failure or private rows from another joined source. Queued replay
      callbacks carry the sync-session token and do nothing after cleanup or
      restart. Pending, failed, same-source, publication, and cleanup traces
      fail the prior implementation and pass the revised boundary.
- [x] Make replay/window termination and error identity explicit. Cleanup now
      rejects a replay-blocked window move with `AbortError` instead of leaving
      it pending forever. Throw/reject × `Error`, `undefined`, `NaN`, `false`,
      and object cases prove that the replay event, `lastSubsetError`, and the
      waiting window promise share one normalized `Error`. Removing raw
      per-attempt error storage made that contract the simpler implementation.
      The public error guide now states that ordinary deltas remain private
      after failed replay until a later authoritative replacement succeeds.
- [x] Align correlation routes with evaluator equality. The independent
      cross-formulation oracle now compares fully loaded and lazy includes for
      same-shaped but reference-distinct correlation keys and projected parent
      context, including delete/reinsert transitions and grouped children.
      Equality tokens are confined to equality-keyed route, group, and demand
      state; output-producing expressions retain exact runtime values. The
      compiler records parent-context identity from projected leaves so D2 can
      retract the same route without structurally merging opaque references.
- [x] Measure source and compressed bundle size against both `origin/main` and
      the large RFC stack. Across all package `src` trees, the old stack was
      +10,545/-1,692 lines (net +8,853) while this tree is +2,006/-1,302
      (net +704, including the architecture document). Executable source alone
      falls from net +7,835 to net +666, reclaiming 91.5% of its growth. A
      tree-shaken minified ESM build of the public DB entry is 349,824 raw /
      98,651 gzip bytes here versus 339,394 / 96,043 on main and 431,323 /
      118,297 in the old stack. The retained cost is 10,430 raw bytes (3.1%) or
      2,608 gzip bytes (2.7%) over main. The simplification recovers 88.7% of
      the old raw bundle growth and 88.3% of its compressed growth.
- [x] Make replay startup atomic across adapter reentrancy. A tentative
      acquisition is now visible before `loadSubset` runs and is bound to the
      captured replay attempt, so a synchronous release cannot leave phantom
      loading work and a synchronous newer truncate aborts the obsolete
      acquisition before it can publish. Async replacement callback failures
      finish replay state, update the public snapshot, and surface the exact
      error in a host microtask instead of producing an unhandled derived
      rejection. The three focused regressions failed before the fix and the
      151-test subscription, replay, reentrancy, and lifecycle run is green.
- [x] Close the remaining replay callback boundaries. Superseded attempts stop
      before starting sibling demands; adapter and status callbacks recheck
      logical ownership before adding replay or readiness participants; and a
      self-released synchronous failure cannot defeat successful peer demand.
      Replacement publication now precedes `status:ready`, while release runs
      all cleanup steps even if publication throws. The six exact regressions
      failed before their fixes and the 157-test subscription, replay,
      reentrancy, and lifecycle run is green.
- [x] Close the replay settlement audit gaps. Replay completion, the error
      event, and `lastError` now share the exact normalized adapter error;
      replacement release cannot start new adapter work after reentrant
      teardown; and a generic status listener cannot cause a stale specific
      event. The live-query oracle also reads the public result from
      `status:ready` and proves that the replacement graph commit happened
      first. All four regressions failed before the fixes; the 192-test replay,
      subscription, and live-query run plus the DB build are green.
- [x] Close the symbol-cycle gap exposed by the routed-value audit. D2 now
      hashes cyclic back-references by structural traversal distance, preserving
      equal hashes for separately allocated equal cycles instead of overflowing
      when an enumerable symbol is the back-edge. The regression failed before
      the fix and the full 330-test db-ivm suite is green.
- [x] Bound cyclic structural hashing when a node repeats the same child on
      several direct branches. The first parent-local cache reduced the audited
      direct branching ring from exponential traversal to two property reads
      per node, but its loss audit found that distinct wrappers still hid the
      shared cyclic child.
- [x] Generalize bounded cyclic hashing across indirect object and Map
      diamonds. A traversal-local memo records the visited subgraph and only
      reuses it when its external ancestor dependencies match at the same
      relative positions. Fourteen-node object and Map cases fell from 32,766
      reads to 28; an adversarial shared child proves the cache rejects the
      wrong ancestor context. The full 333-test db-ivm suite and build are
      green.
- [x] Bound the remaining ancestor-context explosion. A hostile cyclic graph
      can encode exponentially many valid ancestor histories, so memoization
      alone cannot make every input cheap. Hashing now bounds recursion depth,
      first-traversal graph bookkeeping, and traversal-cache matching and
      adoption instead of stalling a graph turn. Structural cache entries
      publish only after the whole hash succeeds, while opaque reference leaves
      never enter structural frames, so retrying a rejected value cannot warm
      its way past a guard. Hostile context, cache-adoption, dense-ancestor,
      deep-recursion, same-input retry, and large opaque-leaf regressions now
      prove the deliberate limits. Getter probes show that cache-work, depth,
      and graph-context rejection publish no visited structural child. Buffer,
      Uint8Array, and File leaves remain opaque at the depth and cache-adoption
      boundaries; independently built accepted rings, chains, dense graphs,
      and cyclic component graphs retain equal hashes.
- [x] Defer functional projections over bare Collection includes until bucket
      references become public facades. The callback can now return an opaque
      wrapper around the Collection without retaining compiler state; child
      updates stay on the stable facade and route moves produce a new facade.
      The exact union regression failed before the fix, and all nine includes
      oracle suites pass 343 tests with no type errors.
- [x] Close the symbol-index loss-audit gaps. Symbol range predicates now use
      the evaluator instead of treating the B-tree's runtime-local symbol order
      as query semantics. Ordered traversal also merges exact value buckets
      that share one comparator position, so distinct array references cannot
      overwrite one another in the tree. A generated comparator-group law now
      varies duplicate groups and proves exact equality, forward/reverse order,
      and bounded range traversal together. The scan/index and comparator-group
      regressions failed before the fixes; 160 focused index, ordering, and
      routed-value tests plus the DB build are green.
- [x] Close the index audit's lifecycle and mixed-domain gaps. Basic and B-tree
      indexes now keep every comparator-equal value in stable public-key order,
      replace a retired B-tree representative with a live exact value, and
      translate open-ended reversed ranges without inventing opposite bounds.
      A small live-domain summary disables range optimization when the bound
      and stored values do not share relational ordering. Generated add,
      update, remove, rebuild, reverse-range, and comparator-group laws plus
      both index implementations' mixed-domain scan regressions pass 87 focused
      tests; the DB build and changed-file lint are green.
- [x] Correct the retained ordered-pagination regression. The runtime already
      advances through an implicit public-key tie class when callers await the
      `setWindow()` operation. The old test discarded that promise and observed
      page three while it was still in flight. The pagination oracle now varies
      explicit versus implicit public-key tie-breaking, real filter membership,
      provider tie order, and insertion order independently across static,
      on-demand, and mutation histories. Its eight-cell structural matrix is
      guaranteed rather than sampled, updates can cross the filter boundary,
      assertions compare full projected rows, and each async operation permits
      only one semantic publication of its exact completed window. It pins the
      three-page and filtered-mutation cases. The new structural cell found a
      real zero-window defect: a live row seen before the first provider request
      became the cursor and hid an earlier authoritative row when the window
      opened. The loader now starts its first request at the source prefix; the
      full 115-test oracle and corrected regressions are green.
- [x] Preserve explicit `undefined` bounds in `BasicIndex` range and cursor
      queries; absence and the indexed nullish value are distinct public
      inputs. Both index types now derive their executable comparator from
      advertised `compareOptions` when no custom comparator is supplied. An
      independent generated custom-comparator model covers forward/reverse
      order, exact equality, comparator groups, and representative retirement
      without using production comparison helpers.
- [x] Normalize a primitive rejection once per shared physical load promise so
      all logical demands, completion state, and `lastError` expose one Error
      object. The replay oracle now observes two logical demands sharing one
      rejecting transport and requires both events, the replay barrier, and
      `lastError` to expose the same normalized instance.
  - [x] Cross this law with ordinary (non-replay) shared loads.
  - [x] Preserve event provenance by proving each logical demand emits exactly
        one event with its own options.
  - [x] Cross shared rejection identity with releasing one of two distinct
        replay demands before the common promise rejects.
  - [x] Reject replay completion with `AbortError` when releasing every demand
        instead of letting participant removal resolve it first.
  - [x] Recheck replay completion after release callbacks. A delete observer
        may synchronously reacquire demand; the new demand joins the private
        replacement without letting the retired promise keep its gate open.
        Fixed witnesses cover both later and reentrant reacquisition, retained
        source republish, exact callback batches, gate settlement, and one
        unload per acquisition.
  - [x] Cover `none | first | second | both` release sets for ordinary and
        replay shared promises, and assert intended `where` provenance rather
        than only matching the adapter's captured option objects.
  - [x] Leave physical abort sharing to adapters that coalesce transports. Core
        owns one signal per logical adapter call and cannot retroactively turn
        two calls into one ref-counted transport lease.
- [x] Prevent reentrant specific-status listeners from delivering a stale
      status event to later listeners. A loss audit found that status-label
      equality still admitted ABA reentry and that generic and Collection
      status events had the same gap. Both status layers now guard each listener
      with a transition revision; regressions cover simple reentry and ABA from
      both generic and specific callbacks.
- [x] Stop a subscription status transition when an earlier listener
      unsubscribes, including teardown from generic or specific
      `loadingSubset` listeners when adapter cleanup throws. Clearing the
      listener map does not stop iteration of the current listener set, so
      later listeners could run after `unsubscribed`; status changes during
      teardown could also start a fresh `ready` delivery.
- [x] Make logical unsubscribe reentrantly idempotent while preserving retries
      of failed physical adapter cleanup. The `unsubscribed` event and
      subscriber-count decrement now happen once.
- [x] Snapshot each event's listener set and skip listeners removed before
      their turn. A listener that removes and re-adds itself cannot run twice
      in one emission, while an earlier listener can still cancel a pending
      `once` callback.
- [x] Pin one cross-channel trace for generic-before-specific status delivery,
      including nested ABA reentry, and add the missing Collection-level
      generic and specific ABA matrix promised by the architecture text.
- [ ] Close the ordered-pagination oracle gaps found after its runtime fix.
  - [x] Pin the zero-window defect against a true on-demand source and assert
        that its first request has no cursor.
  - [x] After that first request rejects, retry from offset zero without a
        cursor; a started request is not established remote coverage. Recovery
        now uses one authoritative filtered full-source request because the
        adapter result does not prove a finite prefix or source exhaustion.
  - [ ] Cross the same first-request law with real cancellation at both zero
        and nonzero offsets. Rejecting with an `AbortError` value does not
        exercise ownership-driven `options.signal.abort()` and must not count
        as cancellation coverage.
  - [x] Cross the zero-window/local-row case with a nonzero target offset and
        assert the exact finite-prefix request count and shape.
  - [x] Record every on-demand publication callback so an equal duplicate
        cannot hide behind snapshot deduplication. The oracle now checks each
        exact delta and post-callback row set, including the one empty readiness
        wake-up after a real initial acquisition and no wake-up for a zero
        window that requests nothing.
  - [x] Reject partial rows from a failed later page as continuation evidence.
        A successful prefix followed by a request that writes one row and then
        rejects now red/greens the rule that the next explicit retry loads the
        filtered full source with no cursor. The test also proves rejection
        does not start an eager retry.
  - [x] Keep a far-ahead row written by a failed request from becoming trusted
        after retry. Recovery uses one authoritative full-source request, so it
        does not derive finite-prefix coverage from a local row count polluted
        by the failed attempt.
  - [x] Keep failed rows out of a recovered tie boundary. A failed request can
        write an equal-rank or far-ahead row, but recovery does not use either
        as a boundary because it reloads the full filtered source.
  - [x] Keep failed rows out of a later same-window refill after authoritative
        rows leave. The recovery request already loaded the full source, so the
        refill derives its window from authoritative local state rather than a
        boundary left by the failed request.
  - [x] Avoid false finite-prefix success when an adapter returns fewer rows
        than requested. Recovery never treats a successful limited call as
        proof of extent; it makes one full-source request instead.
- [x] Cross partial writes with synchronous throws across page, prefix,
      full-source, and boundary requests. No failed `setWindow()` may start
      eager recovery before an explicit retry. An integration witness covers
      a page write followed by a throw; focused loader cells cover all four
      request routes and prove only a later operation generation may retry.
  - [x] Keep an ordinary source insert or update after the failure from clearing
        the failure gate and starting recovery without an explicit operation.
        Cursor invalidation no longer changes failure ownership.
  - [x] Reject a new explicit window operation started reentrantly inside the
        adapter request with `SetWindowReentrancyError`. A production-path
        regression writes synchronously, attempts the nested move, then throws;
        the nested operation can no longer report an unloaded window as settled.
  - [x] Ignore a successful result callback when the surrounding snapshot call
        later throws. The loader now observes settlement only after the full
        synchronous request returns and retires an acquisition whose later
        local read or publication fails. Page, prefix, full-source, and boundary
        cells all red/green callback-before-throw ordering.
  - [x] Mark callback-before-throw failure before retiring its acquisition.
        Adapter cleanup may reenter `loadMore()`; that nested call must not
        start recovery before the original request has entered its failure
        generation. The exact prefix witness failed with a second snapshot;
        failure state and the request guard now cover provisional retirement.
  - [x] Preserve the primary request failure when provisional-acquisition
        cleanup also throws. The caller, subscription error event, and stored
        error must report the request failure while the release remains cleanup
        debt. A real `CollectionSubscription` witness red/greened publication
        failure plus a throwing adapter release and its later cleanup retry.
  - [x] Normalize a non-`Error` primary failure once before recording and
        rethrowing it, so caller, event, and `lastError` share one `Error`
        object. String and `undefined` failures now red/green that identity;
        the shared normalizer is also total for unstringifiable thrown values.
  - [x] Never retain a demand-array index across `loadSubset:error` delivery.
        Reentrant listeners may remove the failed demand or an earlier demand;
        cleanup must re-find the same logical demand instead of unloading its
        successor or leaving the failed one live. A Cartesian witness now
        crosses whether the failed demand comes before or after the demand
        removed by the listener, and whether that nested release succeeds or
        becomes cleanup debt without replacing the primary public error.
  - [x] Preserve the primary public error across every reentrant release
        surface, including `unsubscribe()`. Cleanup still throws to its direct
        caller and remains exact retry debt, but it cannot emit a second error
        or replace `lastError` during primary-error delivery.
  - [x] Strengthen the provisional cleanup-debt witness: assert the exact
        options unload twice, no unrelated lease unloads, successful retry
        clears debt, and the primary stored error remains unchanged. The
        production witness now checks object identity and a second idempotent
        unsubscribe.
  - [x] Retire a provisional acquisition when the ordered-loader result
        observer throws. This is a defensive internal seam, not a public event
        listener path: event-listener throws are isolated by `EventEmitter`.
        The witness checks exact release, blocks reentrant replacement during
        retirement and ordinary retry after queued settlement, and permits
        only a later explicit operation generation.
  - [ ] Replace the synthetic callback-before-throw page cell with a reachable
        production integration that throws after adapter startup during local
        read or publication. Keep direct route cells only for method-selection
        laws that cannot be observed through the public API.
  - [ ] Prove the failure publication barrier through the real subscription
        boundary: provisional release may synchronously commit source work, but
        the prior public snapshot stays fixed and status cannot become `ready`.
  - [ ] Replace the direct loader-only route matrix with production-path
        witnesses where practical. The matrix currently proves method choice
        and reentry suppression, but only its page integration exercises
        adapter writes, graph work, operation generations, and publication.
  - [ ] Make failed-load recovery a true replacement, not an additive full-source
        request. A failed request may leave a row that no longer exists remotely;
        neither a normal `requestSnapshot()` nor an already-deduped unbounded
        load removes it. Red/green both a failed-only stale row and a completed
        unbounded acquisition that would otherwise suppress physical recovery.
  - [x] Retire the exact failed physical ordered acquisition when its explicit
        retry replaces it. The request callback now carries acquisition
        identity back to the loader; replacement releases that lease before it
        starts. A later truncate replays no obsolete cursor, and cleanup
        releases each remaining live lease once.
  - [x] Retire a failed logical demand even if truncate has already replaced
        its physical acquisition object. Cross failure, truncate, explicit
        retry, and another truncate; the obsolete cursor must not rejoin or
        veto the successful replacement. The request observer now retains a
        stable release closure over the logical demand instead of a mutable
        physical options object; the production replay regression red/greened
        both Error and AbortError-shaped failures.
  - [x] Fence explicit retry while failed-acquisition release is in progress.
        Reentrant `unloadSubset` must not start the replacement before the old
        release succeeds, and a failed release must leave no replacement work.
        The async-failure witness red/greened nested replacement followed by a
        release throw, then proved a later explicit generation can retry.
  - [ ] Extend failed-acquisition tests across async page, prefix, full-source,
        and boundary routes with real acquisition identity, real signal abort,
        final release counts, and exact replay request traces.
  - [x] Derive the zero-window no-load and readiness-wake expectations from the
        requested limit, not observed load count. Every publication now records
        callback-time status, so only one empty `ready` batch can satisfy the
        acquisition wake-up law and a zero window permits none.
  - [x] Preserve `previousValue` explicitly on every normalized public change;
        malformed insert/delete payload fields can no longer be discarded by
        the oracle normalizer.
  - [x] Compare the exact public change batch with the reference before/after
        rows. Generated mutation and window histories now check change type,
        key, value, prior value, batch count, and final rows together.
  - [ ] Give every structural matrix cell a fixed semantic witness: a rank tie,
        mixed filter membership, two meaningful windows, and a real mutation,
        while crossing provider tie order independently.
  - [x] Pin and fix both implicit-public-key tie update failures found by the
        10x state campaign: top-1 equal-rank replacement and offset-1 equal-rank
        replacement must choose the lowest public key after an update. A wider
        descending tie witness covers the same missing-prefix class. A changed
        or deleted delivered row now invalidates finite source-order coverage
        and takes the conservative full-source recovery path.
  - [x] Cross that implicit-key repair with asynchronous success and rejection.
        A post-ready recovery now joins the ordered publication barrier, so the
        public query retains its last complete window until the authoritative
        full-source request succeeds; rejection records the source error and
        leaves the old window intact. The audit also exposed an over-broad
        trigger: updates that compare equal under the source order no longer
        turn a finite lazy demand into a retained full-source demand.
- [x] Prevent a reentrant truncate started during synchronous replacement
      publication from letting the superseded attempt emit transient `ready`.
      Readiness now requires both zero tracked load participants and zero
      replay attempts whose setup or Promise settlement is still pending. The
      production regression starts a second truncate from the first replay's
      synchronous replacement callback and proves the status trace contains no
      intermediate `ready` event. The follow-up loss audit recovered two more
      exits that bypassed the shared predicate: releasing a demand during
      sibling replay setup and failing to unload the old lease after its async
      replacement had started. Both now stay `loadingSubset` until all current
      replay work settles. Subscription async work also carries the Collection
      sync-session generation, so cleanup retires an obsolete replay without
      publishing its private rows, reporting its error, or emitting `ready`.
- [ ] Close the public window-reentrancy follow-up audit:
  - [ ] Reject or defer `setWindow()` called synchronously from the initial
        ordered adapter load; it must not return `true` before the requested
        rows are visible. The public regression is red: the nested call returns
        `true` and advances `getWindow()`.
  - [ ] Reject or defer `setWindow()` called from an ordinary live-query
        publication listener; a coalesced graph turn must not look settled.
        The public regression is red with the same false `true` result.
  - [ ] Fence outer window settlement by sync-session identity. Synchronous
        cleanup during its adapter request must not let the old operation write
        a settled window into the restarted collection. The public regression
        is red: the abandoned operation returns `true` after cleanup.
  - [x] Preserve the existing async control: a superseding window move made
        after the adapter has yielded remains legal and waits for its own work.
- [ ] Close the subscription-teardown follow-up audit:
  - [x] Prevent a stale outer cleanup-debt snapshot from unloading an
        acquisition again after a nested `unsubscribe()` already released it.
        The red/green witness crosses two debts, repeated teardown, reentrant
        cleanup, exact release counts, and a duplicate-release failure trap.
  - [x] Give EventEmitter registrations their own identity. Removing and
        re-adding the same pending callback during an emission must defer the
        new registration until the next emission. The red/green event test
        proves both deferral and delivery on the following emission. Once-only
        callback identity now also lives in a private `WeakMap`; a user-owned
        function property cannot impersonate an internal registration.
  - [x] Do not register a subscription that unsubscribed reentrantly during
        automatic `includeInitialState` loading. The production witness checks
        exact acquisition release, live-set membership, and subscriber count.
  - [x] Apply the primary-error delivery barrier to actual synchronous,
        asynchronous, and truncate-replay adapter failures, not only failures
        reported through an observer's release callback. Reentrant teardown
        may still throw to its direct caller and retain cleanup debt, but it
        cannot publish a second error or replace the active primary failure.
- [ ] Close the replay-release follow-up audit:
  - [x] A synchronous delete callback that reacquires demand must not emit
        `ready` before its replacement row becomes public.
  - [x] A replay demand that rejects and then retires must not leave its
        attempt-global failure poisoning surviving successful demand.
  - [x] A demand reacquired from reentrant adapter `unloadSubset` must join the
        same private replay gate; completion cannot be decided before that
        release callback.
  - [ ] Preserve a surviving demand's successful replay when a different failed
        demand retires after the failed attempt has already settled. Cross
        direct and graph-controlled publication.
  - [x] Store each replay failure on its demand or attempt so an unrelated
        `unloadSubset` failure cannot replace the replay completion error.
        The bounded executable witness checks exact error identity and release
        debt retry; broader ordering permutations remain part of the product.
  - [x] Keep status non-ready while an untracked asynchronous demand acquired
        reentrantly from `unloadSubset` still gates replay publication.
- [ ] Reconcile the joined-recovery readiness wording with the public
      multi-source barrier: a single source can become ready before the joined
      replacement is public.

### Lifecycle completion dashboard

This is the bounded protocol census. Do not add another production patch until
every row is either green or has a named red witness.

Latest checkpoint: **601 passing / 0 failing** across 601 test functions.
The demand suite is **199/0**, and history is **37/0**. The initial-work
notification mismatch was a model error: readiness and publication have
different wait sets. Remaining failures: publication **0**, settled-peer replay **0**, ordered
work **0**. The twelve-suite checkpoint is **940/0** (601 bounded plus 339
adjacent), including the expanded window controller **57/0**. Its seven prior
failures are reconciled below: six contract/timing expectations and one pending
preload defect, now covered by two outcome cells. Live cleanup retry is repaired below. Six ordered incremental
failure cells now reach the intended post-startup phase and pass; no runtime
change was needed for those cells. These are separately queued below. Counts describe tests,
not unique confirmed runtime bugs; contract-alignment notes below distinguish
stale oracle expectations from implementation defects.

The functional-projection suite is now **205 green / 0 red** (144 product
cells, fourteen controls/census functions, 28 read-API cells, and two uncaught
index-guard cases, plus six subscription/failure/restart, eight pending-load,
and three two-stage cells). The API
extension started at **174/10**; correcting two receiver expressions fixes
iteration, forEach, map, and state in both order modes with zero net source
growth. The user then approved a clear error for draft-time index creation.
Its revised four rejection cases are **182/4** before the guard and **186/0**
afterward. They replace the two draft lookup expectations with exact errors
and post-publication index controls, not a private-index implementation.
All 158 earlier tests still pass. No skip or expected-failure classifier added.
Before the read-API extension, the same 158 tests on
baseline production are **130/28**; those baseline reds stop on incomplete
Collection-valued input. Only the updated-parent identity assertion for
separate functional calls changed by user decision; expression identity,
unchanged-parent identity, live contents, and isolation assertions remain.
The smaller continuation replaces the old deferred-callback machinery.
The captured-method isolation extension first failed on that candidate
(**157/1**) and now passes. The latest eleven adjacent suites reran **370/0**;
the twelve lifecycle suites now rerun **940/0** after all boundary extensions
below. Both fresh reports use fixed seed `1657011` and have no skips.
These are bounded test counts, not unique bugs or proof of the full draft
Collection API. Six synchronous subscription/failure/restart cells now pass;
eight pending-load cells cover resolve/reject and obsolete completion after
restart with expression controls. Two-stage success/callback/prepare failure
and remote virtual metadata now pass. Their products are bounded, not an
exhaustive cross of async/optimistic/nested/subscription histories. Copying and
retention now have the bounded checks below. The broader 1x oracle command
is **1,355 green / 0 red**, after aligning stale restart event expectations.
The six preceding failures reproduced before the snapshot change; no runtime
repair was needed for them. Do not combine this count with the projection count.
The slim replacement plus guard is **+125 net lines** (+119 replacement,
zero for helper receivers, +6 guard), down from the archived +227 candidate.
Whole-branch executable source is still **+3,220 net lines**
against main checkpoint `68366eca`; the below-main target is not met.

| Protocol slice                                       | Executable coverage                                                                                 | Current result                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Logical demand start/release and synchronous reentry | 28 start cells, 14 failure-delivery cells, 8 release cells                                          | green; queued replay status and failed-start rollback expectations reconciled |
| Sync loader availability                             | 6 phases × 5 entries: 13 executable cells and 17 true exclusions                                    | runtime reach checked through red suffixes                   |
| Physical acquisition interaction                     | 5 states × 5 causes: 18 executable cells and 7 true exclusions                                      | distinguishes no-op, abort, retire, preserve, discard, retry |
| Cleanup/restart ownership                            | 20 restart cells plus fixed callback boundaries                                                     | green, including unavailable-loader pending-result cases     |
| Async session fencing                                | 2–4 sessions, 1–2 demands, mixed outcomes, obsolete/current/interleaved settlement                  | green                                                        |
| Generated async lifecycle histories                  | one pure reducer drives async-pending and sync-success histories with one ordered event trace       | 37 green; readiness/publication membership distinguished; both async exclusions removed |
| Row-bearing lifecycle histories                      | independent public-row model; exact batches modulo independent-key order; fixed and random histories | 43 green / 0 red; duplicate snapshots and retained-row reset repaired; live source truth checked independently; no visible-row request omission remains |
| Replay phase transitions                             | setup/pending/settling/publishing crossed with release, reacquisition, supersession, abort, cleanup | 72 green; direct settled-peer recovery and consecutive failure/retry witnesses green |
| Ordered route mechanics                              | page/prefix/boundary/full-source × return/throw/resolve/reject/abort/cleanup                        | green                                                        |
| Ordered consumer integration                         | Collection/Effect parity, source-local recovery, public-window reentry, sync-session settlement     | bounded census green; synchronous recovery publication repaired; adjacent failures separately queued |
| Ordered generated histories                          | 192 checked route/delivery/window/outcome/session/barrier histories; finite/full request shapes     | 192 green cells; no known-red classifier remains |

The earlier 44-test red catalog grouped into these protocol faults. Later
checkpoints below add witnesses; the broader final campaign is still pending. Multiple
matrix cells are deliberate variants of one fault, not separate diagnoses.

| Red class                                 | Named witnesses | Observable failure                                                           |
| ----------------------------------------- | --------------- | ---------------------------------------------------------------------------- |
| Start/failure reentry through truncate    | 0 (5 stale expectations reconciled) | queued replay owns loading; a synchronous throw rolls back the tentative owner |
| Acquisition availability and callback ABA | 14              | demand starts on the wrong loader/session, settles early, or owns no lease   |
| Obsolete async replay readiness           | historical 3    | delayed cancellation still owes settlement; stale model expectations reconciled |
| Aborted replay generation                 | historical 5    | loading and delayed-settlement contracts reconciled; phantom unload fixed |
| Synchronous replay/restart readiness      | historical 12   | queued loading is valid; unacquired-unload suffix fixed; unrestricted synchronous generator passes |
| Released obsolete publication             | historical 1    | unsupported untagged canceled writes; conforming-source witness green; source/core ablations remain red |
| Independent write during replay           | historical 1; repaired | successful replacement now preserves unrelated source rows written behind its gate |
| Duplicate-owner snapshot                  | historical 1; repaired | snapshot reads now reuse known private/public rows to avoid duplicate inserts |
| Aborted acquisition publication           | historical 1    | source must suppress canceled request writes; conforming-source witness green, no core bug claimed fixed |
| No-acquisition truncate                   | historical 1; repaired | eager truncate and final release create neither a physical acquisition nor phantom unload |

- [ ] Finish the subset-demand lifecycle oracle before accepting more local
      runtime patches. Treat these as one protocol, not separate regressions:
  - Recovery policy (user decision): a red transition may be implemented as
    detection followed by stopping the affected collection and rebuilding it.
    Seamless continuation is not required for every exceptional interleaving.
    Before changing a red expectation, name its detection boundary and prove
    the recovery trace: retain a valid public snapshot, settle affected callers
    with an explicit error, retire old work, and publish a complete rebuilt
    snapshot before reporting ready. An arbitrary throw, an unresolved promise,
    leaked ownership, or partial publication is still a failure. Keep the
    original failing witness and add recovery assertions; do not classify any
    exception as success. Each red law needs an explicit choice of continuation
    or recovery before production changes.
  - [x] Model the logical demand states `absent`, `starting`, `active`, and
        `retired`, independently from physical acquisition state and cleanup
        debt. The production protocol records `starting`, `active`, and
        sync-session-detached demand; absence from the owner set is `retired`.
        A synchronous adapter failure never creates a releasable physical
        lease.
  - [x] Cross acquisition start outcome (`return`, `throw`, `resolve`,
        `reject`) with adapter-start reentry (`none`, release self, release
        peer, unsubscribe, cleanup) and assert the exact request, abort,
        release, error, status, and ownership trace. The finite census covers
        all 28 start cells and all 14 failure-delivery cells.
  - [x] Cross physical release outcome (`return`, `throw`) with unload reentry
        (`none`, reacquire self, release peer, unsubscribe) and prove logical
        retirement happens once while failed cleanup stays exact retry debt.
        The finite census covers all eight release cells.
  - [ ] Cross replay phase (`setup`, `pending`, `settling`, `publishing`) with
        release, reacquisition, truncate supersession, and cleanup. Assert the
        full status/publication trace, not only the settled row set. The new
        lifecycle suite adds cleanup-during-pending, external abort,
        queued-loading, and adapter-reentrant-cleanup cells; the existing
        replay oracle supplies release, reacquisition, supersession, and
        publication histories.
  - [x] Cross collection sync-session replacement with every pending async
        settlement. An obsolete operation may clean up its own acquisition but
        cannot write rows, report an error, change readiness, or settle a new
        window. Cleanup now detaches surviving demand and restart reacquires it
        under a fresh private barrier seeded from the new session's current
        rows. The follow-up loss audit found that requests made while already
        cleaned up became phantom active acquisitions, cleanup debt crossed
        adapter sessions, and restart had a false-ready microtask. Physical
        acquisitions now carry their source-session identity; all three cases
        red/greened. A 20-cell two-demand restart matrix and eight
        three-generation settlement orders cover return, throw, resolve,
        reject, release, unsubscribe, cleanup, and obsolete/current ordering.
        The next loss audit recovered four omitted restart boundaries and the
        first repair closed the coarse cases: demand created by the synchronous
        loading-status callback, false physical settlement while cleaned up,
        eager-mode restart, and failure of the replacement `sync()` function.
        A stricter acquisition-availability census is now red for four seams
        that collection status cannot describe: demand reentered from
        `markReady()` before the new loader is installed, demand reentered from
        the failed-start error callback, demand started by the retiring
        adapter's cleanup callback, and eager demand later sent to
        `unloadSubset` despite never calling `loadSubset`. The same census now
        includes a fifth red: a request aborted before adapter entry also owns
        no physical lease and must not call `unloadSubset`. Replace the status
        guesses with one explicit sync-session acquisition contract before
        making these cells green. The finite phase table also keeps three
        adjacent controls green: an installed handler works both before and
        after asynchronous readiness, a deferred acquisition reaches the
        eventual adapter once, and release before resume creates neither load
        nor unload. Four further red seams complete the table: `markReady`
        followed by an invalid handler-less return, an obsolete sync result
        returned after ready-callback cleanup, an installed loader used after
        initial `markError`, and deferred resume continuing after reentrant
        cleanup. The latest loss audit recovered two earlier-phase omissions:
        cleanup can falsely settle a request while start is still deferred,
        and `markError()` during synchronous `sync()` entry can falsely settle
        a reentrant request before a valid loader is returned. A same-session
        error-to-ready control proves an installed loader remains usable after
        recovery. The intended contract is now explicit: requests made while
        initial sync is in error remain detached and recover automatically on
        a later same-session `markReady()`; `requestSnapshot()` does not gain
        an undocumented synchronous error-state throw.
  - [x] Interleave logical owners and exact physical attempts across request,
        release, resolve/reject, truncate, cleanup, restart, and unsubscribe.
        The generated history model observes exact options identity, aborts,
        unloads, error identity, `lastError`, and the full status trace after
        every effective command. Fixed histories guarantee partial-generation
        supersession, duplicate owners, request while cleaned, overlapping
        replay, initial rejection followed by successful restart, and external
        abort. It found one new red: replaying an externally aborted logical
        demand can install a phantom acquisition that was never sent to the
        adapter, then later call `unloadSubset` for it. The independent reducer
        also found that superseded replay work from a source which ignores
        abort can keep current readiness gated, and that replaying an aborted
        demand emits a spurious `loadingSubset -> ready` pair. Random abort and
        pending-supersession histories stay excluded from the broad green
        campaign only while these three named red witnesses remain. All other
        commands run under fixed and random seeds. The older command runner
        was removed: the one surviving reducer owns expected sync sessions,
        replay generations, physical attempts, errors, result callbacks,
        collection/subscription status, and empty-publication barriers without
        learning those facts from production callbacks.
  - [x] Replace the hand-picked acquisition boundary list with an executable,
        typed phase × entry census. Keep obsolete sync-result retirement on a
        separate resource-installation axis, and add session-tagged unload
        assertions to every restart/callback witness. Do not call the phase
        table complete until this census itself fails when a legal cell is
        omitted. The loader-availability census now has six phases and five
        entries: 13 executable cells and 17 explicit exclusions with reasons.
        Omitting any cell fails the typed record; omitting an executed witness
        fails the runtime reach census. Restart/callback unloads name the
        adapter session that owns each physical acquisition.
  - [ ] Keep the ordered-query layer as a consumer of the same protocol. Cross
        page, prefix, boundary, and full-source routes with cancellation,
        failure, retry, and reentrant `setWindow`; do not duplicate ownership
        rules in a second reference model.
    - The ordered layer adds only these state axes to the core ownership model:
      source authority (`unknown`, `finite`, `invalid`, `full`), route (`idle`,
      `page`, `prefix`, `boundary`, `full-source`), publication barrier (`none`,
      `bootstrap`, `window`, `repair`, `replay`), requested versus settled
      window, and query sync session.
    - Its complete event alphabet is initial start, source insert/update/delete,
      `setWindow`, request return/throw/resolve/reject, release/abort, truncate,
      cleanup/restart, and a second source starting or settling replay/repair.
      Reentrant calls are the same events while adapter entry, graph execution,
      publication, or cleanup is on the stack.
    - The merge laws are: public rows are always the last complete snapshot or
      exact recomputation of the settled window; successful window settlement
      means that window is public in the same sync session; failed or obsolete
      work cannot publish or advance the window; invalid finite authority is
      restored only by authoritative full-source success; recovery gates are
      source-local; and a semantic request chain reaches a bounded fixed point.
    - [x] Cross async resolve, reject, and signal-abort outcomes over page,
          prefix, boundary, and full-source routes. Failed acquisitions stay
          quiescent until an explicit operation, then release the exact lease
          once and retry through one conservative full-source request. Core
          owns the physical abort and final teardown laws.
    - [x] Cross every route with query cleanup before settlement and prove a
          late result starts no boundary, refill, error, or publication work.
    - [ ] Generate combined ordered histories and report reach for every route,
          authority state, barrier owner, settlement kind, and sync-session
          transition.
  - [ ] Add a checked coverage census for every finite Cartesian axis and
        `fc.statistics` for generated histories. Fixed witnesses, exhaustive
        small-domain cells, fixed-seed fuzzing, and random/replayable fuzzing
        must all exercise the same laws. The core start, failure-delivery, and
        release matrices have checked finite censuses. Restart adds 20 checked
        cells and three-generation fencing adds eight fixed settlement orders.
        The independent sync-history model now runs both fixed and random,
        replayable command sequences across request, release, truncate,
        cleanup, restart, and unsubscribe, with optional coverage statistics.
        It now models repeated same-key owners instead of suppressing them. A
        second generated history crosses one or two demands, two to four sync
        generations, obsolete/current resolve or reject, and three settlement
        orders; its coverage labels describe effective transitions rather than
        mere command presence. A catalog loss audit then repaired three false
        greens: ordered owner tokens now drive the generated readiness check,
        failure-delivery cleanup cells perform real cleanup, and every async
        settlement checks transient rows, errors, and status instead of only
        the final state. A second audit made those repairs independently
        observable: cleanup cells prove cleanup status and aborts, the async
        restart model requires every generation-demand acquisition instead of
        deriving expected coverage from runtime attempts, stale writes are
        tested against a non-cooperative source, and statistics describe only
        commands the history actually executes. The follow-up audit tightened
        that boundary again: the acquisition census now runs after every
        restart, the hostile source commits without honoring the abort signal,
        statistics exclude skipped commands and degenerate interleavings,
        errors retain exact demand identity, and each settlement checks the
        full publication and status trace. Per-demand outcomes now include a
        mixed success/failure current generation. The duplicate simple history
        runner has now been deleted in favor of one shared pure reducer with
        explicit sync-session and replay-generation identity. The driver now
        allocates observed attempt identities without reading expected model
        events, and compares one ordered load/unload/result/error/status/
        publication trace. The same reducer also drives sync-success histories,
        preserving the old synchronous lifecycle law without a second runner.
        That mode found two more red variants: synchronous replay emits a false
        loading cycle, and restarting an aborted retained demand does the same.
        Ordered authority/barrier generation remains.
  - [x] Catalog all red cells before changing production code. Fix by invalid
        transition class, then rerun the entire matrix after each coherent
        commit. The core slice exposed 15 red cells in five classes: phantom
        unload after failed start, cleanup during startup, cleanup/restart
        barrier reuse, external-abort success, and replay cleanup reentrancy.
        A second audit added nine red boundary cells across restart entry,
        public window reentry/session fencing, Effect parity, and source-local
        recovery gates. The first four coarse restart-entry cells are green;
        the stricter audit added four red acquisition-availability cells. The
        last fully green checkpoint had 86 core lifecycle cells plus 129
        existing subscription/replay tests. The independent-trace checkpoint
        had 109 lifecycle tests: 93 green laws and 16 named reds. The frozen
        checkpoint had 147 tests: 111 green laws and 36 named reds. Executable
        acquisition reach and direct-release coverage now bring the catalog to
        156 tests: 112 green laws and 44 named reds. The driver chooses runtime
        owners and attempts independently from the reducer; the phantom-unload witness
        reaches its unload assertion; abort remains in the green generator
        except for the exact replay class; and red histories no longer count
        as passed SUT reach. A row-bearing history model found one additional
        class: a released non-cooperative acquisition can still publish its
        obsolete row. Independent source writes found a second publication
        class: a successful replay can drop an unrelated source row written
        while its replacement is private. Random-seed variation then found a
        third publication class: adding a second owner for an already-loaded
        demand can republish the unchanged row as another insert. A
        non-cooperative source also proved that an acquisition can publish
        after its signal aborts. The phase table distinguishes
        executable and impossible loader-availability cells. A 5-state ×
        5-cause physical-interaction census names all 18 executable transitions
        and seven true exclusions. The open classes remain
        acquisition availability, phantom ownership/resource retirement,
        replay/abort generation, cleanup/reentry, obsolete publication, and
        preservation of independent source writes across a successful
        replacement.
  - [ ] Close the lifecycle-census loss-audit gaps before changing production:
    - [x] Model an authoritative truncate with no retained demand as a public
          deletion, and pin the random counterexample that exposed the false
          green.
    - [x] Preserve the full `unavailable:markReady` suffix through the earlier
          unavailable-demand red, and move release onto the separate physical
          interaction axis with eager and pre-aborted direct-release witnesses.
    - [x] Make failure-delivery `abort-self` and `truncate` cells execute their
          named reentrant action.
    - [x] Remove delegated acquisition labels which conflated loader
          availability, subset release, and source-session cleanup.
    - [x] Observe physical-interaction cells only from tests which execute the
          exact state, cause, and outcome; add focused witnesses for missing cells.
    - [x] Record effective transitions, settlement scope/age/outcome, session,
          and replay reach instead of counting command labels and no-ops.
    - [x] Compare exact error object identity and exact load result kind
          (`true` versus Promise) in generated histories.
    - [x] Give failed replay/private recovery explicit reference-model state;
          rejection must not collapse into successful barrier completion.
    - [x] Add mixed aborted/live replay, exhaustive synchronous replay, and
          post-red suffix witnesses for later release, cleanup, restart, and
          unsubscribe behavior.
    - [x] Generate source mutations independently from settlement and compare
          exact public change batches, including type, key, value,
          `previousValue`, order, and intermediate batches.
    - [x] Make runtime attempt selection structurally independent from the
          reference selector so a shared classifier bug cannot false-green.
    - [x] Turn async restart statistics into checked reach requirements for
          demand count, sessions, outcomes, obsolete settlement, and real
          interleaving.
    - [x] Rerun the full fixed/random lifecycle catalog and freeze its counts:
          111 green laws and 36 named red witnesses across 147 tests.
    - [x] Run a fresh Field Lab loss audit on the frozen lifecycle-census
          commit. The audit confirmed the exact 147-test count, but rejected
          the claim that the whole lifecycle gate was complete.
  - [ ] Close the frozen-census audit ledger before changing production:
    - [x] A — Make acquisition and physical-interaction coverage prove runtime
          execution rather than test declaration, and update stale 20/10 counts.
          The census records reach only
          after the named callback or interaction runs; skipped and early-red
          tests cannot satisfy it.
    - [x] A — Split sync-loader availability, subset acquisition, subset
          unload, and source-session cleanup axes. Reclassify abort-only and
          debt-preserving interactions that do not retire a lease. Loader
          availability now has its own phase table; physical interaction names
          no-acquisition, abort-only, retirement, preserved debt, and retried
          debt; restart tests retain exact source-session cleanup evidence.
    - [x] A — Add direct-release witnesses for eager and pre-aborted demands;
          both currently call `unloadSubset` despite no physical acquisition.
    - [x] A — Assert exact adapter attempt, signal, session, result kind, and
          final release in failure-delivery truncate/abort and active-truncate
          cells. This removed one false red and exposed a narrower one:
          synchronous failure followed by truncate never starts the retained
          replacement demand.
    - [x] A — Apply the first checkpoint's loss audit: compare observed physical
          outcomes, classify cleanup as discarding release debt, move debt retry
          reach after the retry, execute detached and active abort cells, carry
          unavailable recovery past its first red with soft assertions, check
          both target and peer suffixes, and record exact source-session cleanup
          across restart.
    - [x] A — Apply the second checkpoint's loss audit: make eager truncate a
          legal no-acquisition cell with its own red witness; record loader
          availability only inside the callback or entry point that proves it;
          require the same terminal attempt, abort, unload, and cleanup suffix
          for all 14 failure-delivery cells; and tag restart unloads with the
          adapter session captured when their handler was installed. The full
          catalog now has 152 tests: 114 green laws and 38 named reds.
    - [x] A — Make the common failure-delivery suffix truly terminal. Each of
          the 14 cells now performs final collection cleanup, proves the source
          cleanup ran exactly once, checks cleaned-up status, preserves the
          primary error, and rejects any later attempt, unload, status, or error
          activity.
    - [x] Track A gate — A fresh Field Lab loss audit passed commit `b78b6eda`.
          The audit reran the 152-test catalog, checked every census guard, and
          found no remaining Track A proxy reach, invalid exclusion, stale
          count, or false-green path.
    - [x] B — Emit and require compound settlement scope × age × outcome and
          session × replay reach, not independent marginal labels.
    - [x] B — Resume full status checking after each exact tolerated red delta,
          then execute release, cleanup, restart, and unsubscribe suffixes.
          Known-red histories now use exact soft assertions instead of deleting
          status from the comparison, so later lifecycle actions still run and
          remain fully checked.
    - [x] B — Add mixed aborted/live cleanup-restart and complete synchronous
          replay shapes: same-key owners, last-owner abort, and detached abort.
    - [x] B — Derive real-interleaving reach from the observed settlement trace;
          let a generation publish before a later restart makes it obsolete.
          The async restart driver now settles and publishes a successful
          intermediate generation before replacing it. Demand count, session
          count, outcome, final scope, order, and real interleaving are derived
          from observed attempts and settlements, not scenario labels.
    - [x] B — Assert discarded-session signals abort on cleanup and compare
          every async restart error by exact object identity.
          Every cleanup checks all options owned by the discarded session;
          current options stay live until unsubscribe and then abort. Reported
          errors are compared to the unique error allocated for that exact
          session and demand.
    - [x] B — Apply the restart-interleaving loss audit: exclude already
          settled intermediate attempts from the later settlement plan, require
          every post-initial attempt exactly once in the observed settlement
          trace, and compare each error event by object identity rather than
          Vitest's value equality for `Error` instances.
    - [x] C — Cross replay barrier phase × source insert/update/delete ×
          settlement × suffix with checked observed reach. The product also
          crosses an absent/present independent public row, for 288 unique
          cells. Each cell proves the focal physical source effect, barrier
          phase, real settlement or still-pending attempt, adapter unload or
          source-session effect, terminal status, and post-unsubscribe silence
          before counting reach. Command-local deltas expose three separate red
          laws: 32 lost independent-write deltas, six non-canonical replacement
          batch-order deltas, and 34 retirement deltas across 46 retirement
          cells. The 204-cell control region is green.
    - [x] C — Model failed/private replacement retirement explicitly; final
          owner release must not vacuously publish private rows. A non-empty
          failed replacement exposed a new red: final-owner release deletes an
          unrelated row from the retained public snapshot.
    - [x] C — Add full lifecycle suffixes for released-obsolete, aborted,
          visible-row-repeat, and independent-write publication reds. Each red
          now continues through release, cleanup, restart, and unsubscribe with
          exact command-local soft publication checks. The seed-34 restarted
          release counterexample has its own named witness and the broad random
          campaign excludes that exact law. After applying the product loss
          audit, the catalog has 163 tests: 114 green laws and 49 named reds.
          Hard cardinality and uniqueness assertions prevent an axis from
          shrinking with its own expected set.
    - [x] D — Add executable witnesses for the three remaining replay-phase
          contracts: surviving successful peer, per-attempt failure ownership,
          and reentrant async demand readiness.
      - Direct publication now has a row-bearing named red for retirement
        after both replay results settle: releasing the failed demand removes
        the successful peer too (expected `two=2`, observed empty). The prior
        test retired the failure before peer settlement. Both physical loads,
        all four exact unloads, and final release execute in the new witness.
        Graph-controlled peer publication now has a green real-query witness:
        two includes share one child collection; both replay results settle,
        the failed include route retires, and the successful sibling publishes
        once with its replacement row. The failed acquisition aborts/unloads,
        the successful acquisition stays live, a later child update propagates,
        and all four physical leases unload exactly once. The direct witness records
        continuation; safe recovery remains an
        allowed implementation choice under the policy above.
      - The reentrant unload/reacquire witness now checks non-ready status,
        absence of ready events, and no new publication both before and after
        obsolete work settles while the reacquired load is pending. All three
        existing timing cases pass. A separate row-bearing witness now covers
        a distinct demand acquired inside old-lease unload: the original replay
        settles first, the public row stays `one=1`, no ready event occurs, and
        completion stays pending. Settling the new load publishes `one=2` and
        `two=2`, emits ready once, and all three exact leases unload once.
        This boundary is green.
      - Replay error ownership has a green executable witness at the graph
        publication-control boundary: the first replay rejects, releasing its
        pending peer throws a distinct error, and replay completion rejects
        with the original error object. Late peer success cannot change that
        settlement. Cleanup retries the failed release and each of four leases
        is successfully unloaded once. This does not claim every ordering of
        multiple failures is covered.
      - Validation: replay oracle file passes all 69 tests, including the new
        exact known-red observation; the peer witness was first run as an ordinary test
        and failed only on the missing successful peer row. No production
        changes in this checkpoint.
      - Fresh Field Lab audit of `5a1b211f`: PASS for the bounded checkpoint,
        with two recovered assertion gaps now addressed. The peer witness pins
        the precise missing-row result instead of wrapping setup/cleanup in
        `it.fails`; the tracked reacquisition case now checks publication silence
        on the first pending flush as well as after obsolete settlement. Exact
        release checks prove eventual cleanup, not release timing. Recovery
        remains policy rather than executable proof, and D remains incomplete.
      - Fresh Field Lab audit of `93967bd5`: PASS for the bounded readiness
        checkpoint. Its snapshot-only observation limit prompted callback
        tracing as well: after initial acquisition, there are zero callbacks
        during replay and one complete replacement callback at settlement.
        Initial acquisition callbacks are outside this replay-specific trace.
      - Fresh Field Lab audit of `ed48a3a7`: PASS for bounded error ownership
        and callback tracing. It does not establish all late side-effect
        silence or all failure permutations. The graph refinement file passes
        seven tests with the new real-query peer witness. Production remains
        unchanged.
      - Fresh Field Lab audit of `3b3244da`: PASS for the graph-peer
        checkpoint. Two lexical includes own separate subscriptions to the
        same collection, unlike the direct two-demand witness. The graph green
        does not erase that direct red. Callback reads and later reactivity are
        checked; downstream change-message payloads and other settlement
        schedules are outside this new witness.
    - [x] D — Generate the ordered consumer product over authority, route,
          barrier, settlement, window, and sync-session transitions with checked
          observed reach.
      - The real ordered consumer crosses page/prefix/boundary/full-source,
        provider application before settlement/after live success, keep/widen, successful/
        rejected/AbortError settlement, retain/restart, and initial/replay.
        All 192 cells prove physical requests and terminal lease cleanup before
        counting reach. Full versus finite describes observed request shape,
        not an authoritative adapter exhaustion outcome; it is correlated
        with route, not a fictitious freely crossed axis.
      - Exact mismatch arrays pin unfinished preload resolving on cleanup
        (48 cells) and failed initial boundary preload resolving without its
        error (8 cells). At the initial checkpoint the other 136 cells obeyed
        its assertions; the later message check below exposes 12 more reds. These were two
        fault families, not 56 independent bugs. Random campaigns also vary
        rank origin and spacing. AbortError settlement is distinct from the
        physical signal abort that cleanup checks.
      - Replay then window move may publish two complete windows in sequence,
        or coalesce into one final window. Both obey the documented contract;
        the oracle rejects partial windows and extra row publications without
        demanding extra coordination solely to suppress a valid intermediate
        state. Empty snapshot-completion callbacks are not row publications.
      - Validation before audit: 195 tests passed, including fixed/random
        campaigns and the declared-cell guard. An added observed-reach guard
        brings the file to 196 tests. ESLint passes. The initial 100× run
        passed all 196 tests (2,000 fixed and 2,000 random histories plus the
        finite matrix). No production code changed.
      - Fresh Field Lab audit of `a9909273` supported the bounded matrix and
        exact two red families, but recovered six scope gaps. Follow-up adds
        this suite to `test:oracles`, names deferred delivery `after-success`,
        and asserts application occurs only for live success (or the selected
        early-write policy). It checks `getWindow()` while pending, after
        success/failure, and after restart. Callback deltas now reconstruct an
        independent row map and check insert/delete/update payloads and update
        previous values, excluding virtual metadata. This map survives with
        the subscription across source restart; resetting it would invent
        missing previous rows. Obsolete settlement also preserves status and
        exact error identity. The scan's omission focus can overstate the
        significance of intentionally bounded tests; these were test gaps,
        not six new production bugs.
      - Explicit remaining limits: this ordered product does not run a
        separate downstream query, observe every transient status/error event,
        or stimulate a source after final unsubscribe. Other lifecycle suites
        cover terminal silence, but no cross-suite claim replaces a missing
        witness. Failed-operation retain/rebuild remains a policy to implement
        and test, not a green recovery proof.
      - The stronger message check found a third red family in 12 cells:
        full-source restart after replay inserts the replacement under a new
        key without deleting the old delivered key. Public reads are correct,
        but a consumer reconstructed from callback messages retains version 1
        beside version 2, even after the next live update. Exact two-checkpoint
        mismatch arrays preserve this evidence. The matrix now has 124 green
        cells and 68 exact-red cells, across three fault families.
      - Type checking found fixture key-generic errors in this file and the
        earlier graph witness, plus a missing replay-test type import; fixed.
        Package-wide tsc still reports errors in other existing test files.
        The corrected matrix passes all 196 tests, including its final 100×
        rerun (2,000 fixed plus 2,000 random histories). The combined
        seven-suite 100× campaign completed at 405
        passing / 54 failing tests before the message-check additions. Of
        those, 49 were the frozen lifecycle reds and four were ordered-work
        reds. One additional random-history mismatch minimized to requesting
        new demand after failed restart (seed 317005625, path
        `6347:9:11:12:15:13:13:13:13`). It concerns a missing empty callback,
        not lost rows. A named witness now retains the history and full
        release/cleanup/restart/unsubscribe suffix. Do not patch runtime or
        filter the generator until its notification contract is evaluated.
        The lifecycle gate remains open.
      - Fresh follow-up loss audit of `a0aaeb77` supports preservation of the
        six earlier audit items. It recovered the stale 136-green summary
        above (now historical). The callback map checks payload/row membership,
        not a canonical choice of message key or delta order. Obsolete error
        identity is checked against successful restart, not a separate current
        failing attempt. These remain explicit limits, not extra runtime bugs.
        The auditor verified the final JSON report's 196 passing / zero failing
        tests; 100× derives from the recorded invocation. The original audit
        source was an agent message, so its six-item preservation check relies
        on that supplied record plus direct source inspection.
    - [ ] Rerun fixed, random, and 100× lifecycle campaigns; freeze the final
          green/red catalog; then run a fresh Field Lab loss audit.

### Repair choices after the lifecycle gate

Rows marked resolved have the red/green checkpoints below. Other rows remain
candidate repair scopes, not completed fixes or proof of root cause.

| Family | Intended next step | Boundary to preserve |
| --- | --- | --- |
| Phantom unload, retired readiness participant, synchronous false loading cycle | Local ownership/status repair, red/green each law | No new general recovery state machine |
| Duplicate-owner snapshot | Local publication repair | Keep valid initial delivery; suppress only duplicate row deltas |
| Cleanup resolves pending preload; boundary failure resolves preload | Resolved: local caller-settlement repairs | Reject the right waiter with the original error or explicit cancellation |
| Direct failed replay peer loss, unrelated writes lost during replacement, retirement publication | Choose one shared retain-and-rebuild path | Preserve valid public snapshot, reject affected callers, retire old work, atomically publish rebuilt state |
| Synchronous reentry during startup/loader replacement | Prefer explicit detection and recovery if continuing needs more machinery | No half-owned lease, silent success, or hung caller |
| Untagged writes from non-cooperative obsolete/aborted sources | Keep as an explicit adapter/session boundary decision | Do not pretend a request signal identifies an untagged source write |
| Replacement delta ordering | Check whether ordering is externally required before repair | Do not impose a total callback order where complete valid snapshots suffice |
| Full-source restart leaves an old key in callback consumers | Resolved: eager replacement reconciliation | Correct `toArray` is not enough; delivered messages must reconstruct the same rows |
| Missing empty notification after failed restart | Resolved: reference-model error | Failed replay keeps later reads private until authoritative success; settlement alone must not reopen it |

### Local repair checkpoint: failed-replay reference contract

- The seed-317005625 mismatch was a model error, not an optional-notification
  policy. ARCHITECTURE's publication law keeps snapshots private after failed
  replay. The reducer incorrectly reopened the gate once all owners settled,
  including rejection. It now requires successful current attempts (or no
  remaining attempt) at each gate-closing transition.
- The original minimized history and complete suffix pass without changing
  production or suppressing callback/trace assertions. The history suite has
  7 passing tests and the same 20 named runtime reds. No new exception filter.
- A fresh Field Lab loss audit follows this checkpoint before runtime repair.
- Audit of `7d322d75` preserved all commands, assertions, and filters. Its
  recovered limits: publication and readiness are separate; this witness has
  empty rows; aborted/overlapping work has separate tests; a local result does
  not close the broader lifecycle gate. The auditor inspected frozen source
  without rerunning it. Exact seed/path replay subsequently passed as well.

### Local repair checkpoint: preload cancellation

- Red: remove the cleanup-preload expected mismatch from the ordered matrix.
  The focused page/restart/initial history fails only because cleanup resolves
  unfinished preload rather than rejecting it with `AbortError`.
- Fix: sync cleanup rejects its pending preload before adapter teardown.
  Settled attempts clear that rejection callback. Lifecycle cleanup discards
  pending first-ready callbacks instead of invoking them as fake readiness.
  This does not depend on status listeners surviving reentrant delivery.
- All 48 initial cleanup cells are now green. Four direct controls cross
  pending, synchronous-start cleanup, ready, and already-failed preload with
  a fresh successful restart. Two older tests had expected first-ready delivery
  during cleanup; they now assert no delivery. Callback cleanup is documented
  in the public method and architecture contracts.
- Validation: lifecycle plus ordered suites 242/242 pass; ordered 100× is
  196/196 (2,000 fixed + 2,000 random histories). Adjacent sync-reentrancy,
  query-once, includes-temporal, and live-query tests are 150 passing / 6 failing
  both with and without the two behavioral changes. The unchanged failures
  are ordered refill retry and five synchronous replay-error-normalization
  cases. Reports: `/tmp/tanstack-preload-adjacent.json` and
  `/tmp/tanstack-preload-adjacent-baseline.json`. They remain tracked work,
  not a claim that the whole adjacent suite is green.
- Runtime source delta is +3 lines (excluding one public API comment and the
  architecture text). ESLint reports the existing import cycle through
  `sync.ts`'s unchanged `cloneOptions` import; no other errors in these files.
  Package-wide existing test type errors remain separate. A fresh loss audit
  follows this checkpoint. No push.
- Audit of `489fb3a6` found no deleted ordered assertion or broadened filter.
  Its count caveat is explicit: 196 passing test functions include 20 exact
  known-red cells (boundary failure and stale message rows), not 196 entirely
  correct production histories. It also caught a redundant second cleanup in
  the synchronous-start control; removed so the first cleanup alone must settle
  that preload before restart. A throwing adapter cleanup remains outside the
  new four-phase controls: cancellation precedes teardown, while cleanup
  failures retain their existing separate host-microtask error path. This is
  a recorded test limit, not a newly confirmed defect. Audit was source-only.
### Local repair checkpoint: initial ordered boundary failure

- Red: remove the eight boundary-failure expected mismatches from the ordered
  lifecycle matrix. The focused boundary/after-success/keep/reject/retain/initial
  case fails because preload resolves instead of rejecting with the exact
  adapter error. The fixture reaches the real boundary request after a page
  succeeds; it does not substitute a first-request failure.
- Fix: use the live query's loading status rather than a flag cleared by the
  first successful source request. Initial refinement can need further pages
  or boundary reads. Lazy demand keeps its own fatal-error path; applying the
  eager path there caused the existing synchronous lazy-start cleanup control
  to fail, so that ownership exclusion remains.
- Oracle gap: first-request failure cannot distinguish transport success from
  completion of initial query refinement. The older four sync/async primary ×
  boundary controls also reject immediately (`Promise.reject`), so they miss
  a boundary held pending until the primary's success has cleared tracking.
  The gated oracle preserves that intervening state. The existing product
  covers both delivery timings, keep/widen, rejection/AbortError, and restart
  versus retained sessions. Only the resolved bug's classifier was removed;
  all row, message, waiter, ownership, and physical-request assertions remain.
- Focused plus adjacent run: 300 passing / 6 failing, with only the recorded
  ordered-refill retry and five synchronous replay-normalization failures.
  Report: `/tmp/tanstack-boundary-green.json`. The ordered suite's 196 passing
  test functions include 12 exact known-red stale-message cells, not a claim
  that every history is correct. Production source shrinks by 9 lines after
  formatting. ESLint passes for both changed code/test files.
- Ordered 100× passes 196/196 test functions: 2,000 fixed and 2,000 random
  histories plus the Cartesian cells and coverage guards. Report:
  `/tmp/tanstack-boundary-100x.json`. Package type checking still reports
  existing errors in other tests, none in either changed file. No push.
- Additional consumer checks: lifecycle and query-once pass 67/67. Effects
  pass 67 with two release-retry failures: reentrant disposal and obsolete
  demand release each observe one unload call instead of two. Removing only
  this step's production change reproduces both exact assertions; the fix was
  restored afterwards. Reports: `/tmp/tanstack-boundary-consumers.json`,
  `/tmp/tanstack-boundary-effects.json`, and
  `/tmp/tanstack-boundary-effects-baseline.json`. These remain baseline work,
  not a passing effect-suite claim.
- Fresh loss audit of `e1fd3951` found no assertion loss. It recovered the
  delayed-settlement distinction above and two compressed scope details:
  lazy startup throws through setup so earlier subscriptions are released;
  incremental lazy failure errors the live query without throwing through an
  established source commit. The eight repaired cells are retained-session,
  initial-boundary failures only (2 delivery × 2 window × 2 failure outcomes).
  Restart and replay variants are neighboring controls, not additional repaired
  cases. The auditor inspected source and JSON, without executing tests; the
  100× environment is command provenance, not independently encoded in JSON.
  One-context adjacent-source reading may hide other omissions. This closes
  this local repair, not the remaining lifecycle work.

### Local repair checkpoint: stale eager rows across restart

- Red: remove the final 12-cell ordered classifier. The full-source/replay/
  restart witness then fails twice: reconstructed callback state retains the
  old distinct key beside its replacement, including after a later update.
  Reads themselves show only the replacement. No oracle assertions were cut.
- Cause: cleanup retains delivered rows, but reconciliation only visits keys
  present in incoming changes. An old key absent from the replacement never
  receives a delete. For eager sources, reconcile remaining stale keys against
  the installed collection while publishing the next batch, including an empty
  ready batch. Reuse existing retained-row state; add no registry or flag.
- Boundary control: do not infer absence from partial on-demand state. An
  unscoped trial fixed the 12 cells but failed 11 previously passing lifecycle
  tests. Checking installed loader presence also failed: startup can call ready
  before returning the loader. The final guard uses declared sync mode and
  leaves active replay publication alone. The original seven-suite pass/fail
  baseline is restored, without changing those tests or their models.
- Test gap: atomic same-key replacement reconciled correctly while changed and
  missing keys did not. Split same-key replacement also failed: its first commit
  temporarily omits a retained key, which must be deleted before a later commit
  reinserts it. Eight direct controls cross same/missing/changed/empty keys with
  atomic/split eager commits and compare callback state with installed rows
  after every batch. Seven fail without this fix; all eight pass with it.
  Reports: `/tmp/tanstack-stale-controls-red.json` and
  `/tmp/tanstack-stale-controls.json`.
- Production delta: +12 lines, no new state. Architecture records the eager/
  on-demand distinction. Existing subscription lint errors remain at unchanged
  lines (import cycle and four unnecessary-condition diagnostics); the new
  code and tests add no lint diagnostics.
- Default-run census at the stale-row repair checkpoint, stable seven-suite scope:

  | Suite | Passing test functions | Failing test functions |
  | --- | ---: | ---: |
  | Async lifecycle history | 7 | 20 |
  | Demand lifecycle | 101 | 20 |
  | Row publication lifecycle | 7 | 9 |
  | Subscription replay | 69 | 0 |
  | Graph replay refinement | 7 | 0 |
  | Ordered lifecycle | 196 | 0 |
  | Ordered work | 20 | 4 |
  | **Total** | **407** | **53** |

  Previously the same runner counts hid 12 exactly classified ordered reds;
  those now genuinely satisfy the assertions. Test functions are not unique
  bug counts or uniform matrix cells. One separate replay witness still pins
  the known loss of successful peer rows after failed-peer retirement
  (`collection-subscription-replay-oracle.property.test.ts`, test beginning
  near line 3348). It passes by asserting the known bad empty result. Report
  **407 runner passes / 53 failures / 1 separately pinned defect witness**,
  not 407 proven-correct runtime scenarios. Some passes are model reach or
  coverage guards rather than runtime histories. Adding the lifecycle controls
  suite gives 461 passing / 53 failing (54/54 lifecycle controls, eight new).
  Reports: `/tmp/tanstack-lifecycle-progress.json`,
  `/tmp/tanstack-lifecycle-progress-replay.json`, and
  `/tmp/tanstack-lifecycle-stale-repair.json`.
- Ordered 100× passes 196/196: 2,000 fixed and 2,000 random histories plus
  192 Cartesian cells and coverage guards, now without a known-red classifier.
  Report: `/tmp/tanstack-stale-100x.json`. Adjacent subscription, live-query,
  and includes-temporal tests pass 167 with the same six recorded live-query
  failures (refill retry and synchronous replay normalization), in
  `/tmp/tanstack-stale-adjacent.json`. The post-commit loss audit follows.
  No push. Continue reporting this overall census alongside local matrix gains.
- The 53 failing test names match the pre-fix census after removing random-seed
  suffixes. Package type checks report only existing errors outside the changed
  files. Passing counts do not imply those remaining failures are resolved.
- Fresh Field Lab loss audit of `21554b4e` found no dropped assertions and
  recovered the same/atomic versus same/split distinction now recorded above.
  The repaired ordered observer subscribes to the eager public live-query
  collection; its underlying provider is still on-demand. The mode guard acts
  at the publishing collection, not transitively on all its sources.
- Cost limit: no new state does not mean no new work. An eligible batch scans
  remaining stale keys, with an early return once that map is empty. No benchmark
  was run for this scan. Empty atomic controls commit an empty batch; empty
  split controls call ready without a commit, exercising its empty event.
- Audit provenance: source and report inspection only. JSON proves test-function
  counts, while the 2,000 + 2,000 history count also relies on the recorded 100×
  command setting and property configuration. The parent independently found
  the separately pinned replay defect during census inspection. Checkpoint-led
  scanning may miss distinctions outside this repair; this is not a claim of
  complete lifecycle correctness. Next local group: ownership/status repairs.

### Local repair checkpoint: eager physical release symmetry

- Red: the three existing lifecycle-oracle witnesses for eager unsubscribe,
  explicit release, and truncate each call the adapter's unload despite zero
  adapter loads. Focused run: 0 passing / 3 failing, in
  `/tmp/tanstack-eager-release-red.json`.
- Fix: `CollectionSyncManager.unloadSubset` bypasses eager mode just as
  `loadSubset` already does. One executable guard, one comment, no new state.
  Logical subscription teardown remains unchanged. This resolves eager phantom
  release only; pre-aborted, detached, and reentrant acquisition reds remain
  separate work. Do not infer physical acquisition from a successful no-op.
- Test gap: load/unload symmetry must use actual adapter-call counts, not the
  success result of core's request wrapper. These three counters were already
  red in the lifecycle grammar, so no new classifier, generator exclusion, or
  assertion change was needed for this repair.
- Updated stable seven-suite census: **410 runner passes / 50 failures / one
  separately pinned replay-defect witness within the passes**. Demand lifecycle
  moves from 101/20 to 104/17; all other suite counts are unchanged, including
  ordered lifecycle 196/0 test functions and 192/0 Cartesian cells. Report:
  `/tmp/tanstack-eager-release-census.json`.
- Adjacent subscription, sync-reentrancy, and lifecycle tests pass 142/142 in
  `/tmp/tanstack-eager-release-adjacent.json`. ESLint reports only sync.ts's
  pre-existing import cycle at line 17; the guard adds no diagnostic.
- First full seven-suite 100× run: 397 passing / 63 failing. The five suites
  with adequate per-property budgets match their default-run red names; the
  other 13 failures are replay/ordered-work properties ending at the default
  5-second timeout, reported as `STACK_TRACE_ERROR`. They do not establish new
  production defects. Report: `/tmp/tanstack-eager-release-100x.json`. Rerun
  those two suites with `--testTimeout=120000` before claiming full stress
  validation; an increased run count also needs an adequate time budget.
  That budgeted rerun is in progress, with output destined for
  `/tmp/tanstack-eager-release-100x-budgeted.json`; do not treat its absence as
  a completed run or claim the amplified suite passed yet.
  The repair is committed as `31d95d8b`. Nothing pushed.
- Fresh loss audit of `31d95d8b` found no changed assertion, classifier, or
  generator exclusion. The truncate witness asserts release counts after
  truncate and again after final unsubscribe; one test covers two boundaries.
  These are explicit-eager, ready collections with empty callbacks, so the
  counters prove physical-call symmetry, not every logical status outcome.
  Logical teardown being unchanged is a source-diff claim. Reach labels are
  declared by the helper; actual load/unload counters supply behavioral proof.
- The symmetric eager bypass is not identical entry behavior: load checks an
  already-aborted signal first; both eager guards precede deferred-queue work.
  No new conclusion about aborted-demand ownership follows from this fix.
  Audit was source/report-only; JSON lacks tested-commit provenance, and the
  100× report was still unavailable at the auditor's final check. Checkpoint-led
  scanning can flatten other distinctions. Next: pre-aborted demand ownership.
- The next two pre-aborted-demand witnesses are reproduced (0 passing / 2
  failing), without another production change, in
  `/tmp/tanstack-preaborted-release-red.json`. They are already part of the
  remaining 50 default-run failures. Keep the run budget aligned with the
  multiplier in future broad campaigns; do not repeat all amplified suites
  after every one-line repair when focused and default-census checks suffice.

- Removed the expected-bad replay assertion: `retains successful peer rows
  after failed replay demand retires` now expects the successful peer's
  replacement row (`two`, value 2), not the observed empty result. Setup,
  retained-old-snapshot checks, final release, and exact unload counts remain.
  No runtime change: shared replay recovery still needs repair. The test is
  an ordinary failing assertion, not skipped or marked as an expected failure.
  Its suite is **68 passing / 1 failing** in
  `/tmp/tanstack-unpinned-peer-replay.json`.
- Latest stable seven-suite census: **409 passing / 51 failing**, with no
  separately pinned runtime-defect witness counted as passing. This moves one
  already-known defect from the passing column into the failing column; it is
  not a new runtime regression. Compared with the preceding 410/50 report,
  the only added failure is that peer-retention assertion; no failures vanished.
  Report: `/tmp/tanstack-unpinned-peer-census.json`. Counts are test functions,
  including model/reach guards, not distinct defects or uniform runtime cells.
- The earlier 100× budgeted rerun completed before this assertion change:
  **89 passing / 4 failing**, all four matching existing ordered-work failures.
  All 13 properties that timed out at the default five seconds completed with
  `--testTimeout=120000`. Report:
  `/tmp/tanstack-eager-release-100x-budgeted.json`. This clears the timeout
  uncertainty; it does not make the known-red suites green or validate a
  production repair for the newly unpinned assertion.
- Fresh Field Lab loss audit of `60fded61` recovered two compressed details:
  that 100× rerun covers only the two previously timed-out suites (93 tests),
  and its 89 passes still include the old expected-empty witness. The new
  peer-retention failure occurs at the final assertion after cleanup and exact
  unload checks, so those checks were reached; this does not locate the runtime
  cause. The audit found no removed surrounding assertion. It inspected source
  and reports only, without rerunning tests; scanning the sources in one agent
  could bias attention across them.

- Repaired pre-aborted snapshot ownership. The sync layer already rejected an
  aborted request without calling the adapter, but the subscription retained a
  tentative acquisition and later issued a phantom unload. `requestSnapshot`
  now returns false before ownership replacement or local publication when the
  incoming signal is already aborted. One guard condition and comment; no new
  state. This is an entry cancellation check, not a rule to suppress release of
  real acquisitions whose signals were aborted later.
- Red/green: both existing ownership witnesses failed before the guard
  (`/tmp/tanstack-preabort-step-red.json`, 0/2). Added a two-cell control for
  absent/existing demand: an aborted replacement must return false, publish no
  local snapshot, invoke no result callback, and leave any prior acquisition
  live until its owner releases it. Both controls failed before the guard at
  the return-value assertion (`/tmp/tanstack-preabort-controls-red.json`, 0/2);
  later assertions were not reached on that red run. All four now pass. The
  existing active-abort ownership test remains green, guarding the distinction
  between cancellation before acquisition and release after acquisition.
- Latest seven-suite census: **413 passing / 49 failing** in
  `/tmp/tanstack-preabort-census.json`: exactly two prior failures removed,
  no new failures, plus two added passing controls. Demand lifecycle is 108/15;
  the other suites retain their preceding counts, including the unpinned peer
  replay failure. Adjacent subscription, sync-reentrancy, and lifecycle tests:
  **142/0**, `/tmp/tanstack-preabort-adjacent.json`. Prettier and diff checks
  pass. ESLint reports 12 errors and one warning on unchanged lines in the two
  edited files; this is not a clean lint run. No amplified campaign repeated
  for this entry guard. The missing law was physical acquisition/release
  symmetry for cancellation before entry; cancellation during an active load
  does not test it. Shared replay recovery and the remaining lifecycle failures
  are still open.
- Fresh Field Lab loss audit of `1fb62bdf` recovered two compressed details:
  the new controls also check that unsubscribe after explicit release adds no
  second unload; and 12 passing randomized cases use different seeds across
  the compared census reports. The failure-name comparison is exact, but is
  not an identical-generated-history replay. Audit confirmed the recorded
  counts and preserved active-abort control from source/reports, without test
  reruns or lint verification. Sequential scans in one fresh agent can carry
  attention from the first source into the next.

- Repaired demand entry before loader installation. Ready/error callbacks can
  run inside sync before its return installs `loadSubset`; collection status
  alone cannot prove an acquisition happened. The existing detached-demand
  branch now covers non-idle on-demand collections with no installed loader,
  not only `loading`. Idle deferred starts keep their sync-manager queue;
  eager mode still bypasses adapter acquisition. No new state or test changes.
- Three existing red oracle witnesses became green: ready-callback demand on
  restart, error-callback demand on failed restart, and ready-callback demand
  when an invalid sync return omits its loader. They assert exact acquisitions,
  no false result callback, recovery where applicable, and teardown. Red report:
  `/tmp/tanstack-loader-install-red.json` (0/3). Latest seven-suite census:
  **416 passing / 46 failing**, `/tmp/tanstack-loader-install-census.json`.
  Exactly those three prior failures disappeared; none were added. Adjacent
  subscription/reentrancy/lifecycle tests remain **142/0** in
  `/tmp/tanstack-loader-install-adjacent.json`. Prettier/diff checks pass.
- The existing initial-error/same-session-recovery test remains red but now
  reaches its final result-observer assertion: no false early `true` is emitted,
  but the observer never receives the actual later result. Keep that missing
  notification tracked; a stable failure-name set does not mean every failing
  trace stayed identical. Installed-loader error gating, same-session recovery,
  cleanup callback reentry, and deferred abandonment remain distinct open laws.
  The oracle gap was treating ready/loading/error as a proxy for physical loader
  installation; the existing phase/entry matrix supplies the three regressions.
- Fresh Field Lab loss audit of `cf3a29d7`: deferred controls distinguish one
  exact load/unload after resume from zero of either after release-before-resume;
  eager controls also assert zero unloads. Successful restart checks no result
  callback after replay and exact final unloads. Failed restart checks that
  callback only before recovery, then load/unload counts; invalid return has
  teardown but no unload assertion. Preserve these limits instead of attributing
  every assertion to all three tests. Twelve passing randomized cases use new
  seeds, so the census comparison is of failure-name sets, not identical
  histories. Audit confirmed counts by source/report inspection only, with no
  reruns. A single fresh scanner checked sources sequentially after independent
  scanners hit the thread limit; omissions may reflect deliberate compression,
  not defects.

- Repaired queued acquisition cancellation. Cleanup and explicit unload removed
  queued work but resolved its promise as if the adapter had completed it.
  Both paths now reject with the existing `LoadSubsetOperationAbortedError`;
  normal resume still resolves. Two expression replacements, no new state.
  The existing cleanup-before-resume witness was red (0/1) in
  `/tmp/tanstack-deferred-abandon-red.json`.
- Expanded that witness into four action cells: cleanup, explicit release,
  unsubscribe, and resume. This preserves its no-load, promise-shape, settlement,
  and cleanup-reach assertions and adds a successful-acquisition control.
  Before the fix: **1 passing / 3 failing** in
  `/tmp/tanstack-deferred-settlement-red.json`; each cancellation wrongly
  resolved, while resume passed. The existing deferred ownership test still
  checks exact load/unload identity and cancellation-before-resume counts.
- Latest seven-suite census: **420 passing / 45 failing** in
  `/tmp/tanstack-deferred-settlement-census.json`. The old single cleanup test
  is replaced by four passing cells (three added tests); no other failing test
  names changed. Adjacent subscription/reentrancy/lifecycle: **142/0** in
  `/tmp/tanstack-deferred-settlement-adjacent.json`. Prettier/diff checks pass.
  This does not fix the separate already-red cleanup-during-resume case, where
  work has moved out of the pending queue. Missing oracle law: zero adapter
  calls is not enough; an abandoned request must not report successful work.
- Loss audit of `75e2bb51` used an existing auditor because a fresh agent hit
  the task thread limit; this is not a fresh-context audit. It confirmed the
  preserved parent assertions and reported counts. Cancellation reds reached
  the rejection assertion after proving zero loads, one observed result, and
  promise shape; their final teardown was not reached. Tests require the
  `AbortError` name, while the exact class is established by the source diff.
  Twelve passing random cases changed seeds between census runs. The auditor
  inspected source/reports only; prior audit context could steer its attention.

- Repaired adapter retirement across synchronous reentry. Cleanup now clears
  the installed cleanup/load/unload handles before invoking adapter cleanup.
  Startup rechecks the existing epoch after loading callbacks and after sync
  returns; obsolete returned resources are cleaned rather than installed.
  An obsolete throw still reaches its caller but cannot mark a replacement
  session as errored. Deferred resume checks the existing session and abort
  signal before each queued acquisition, including work already removed from
  the manager's queue. Net production change: +13 lines; no new stored state.
- Existing oracle red run: 0/3 in
  `/tmp/tanstack-session-retirement-red.json` (retiring cleanup callback,
  obsolete resource return, cleanup during deferred resume). Added eight
  startup controls: loading/ready/adapter-throw/first-ready-effect-throw crossed
  with no restart/nested restart. Expanded the single deferred-resume witness
  into loading/ready crossed with cleanup/release/unsubscribe, now checking
  promise rejection as well as zero physical calls. These six cells preserve
  the prior ready/cleanup path and add five cases.
- Runtime ablation restored the preceding behavior (apart from one blank line)
  with the new tests retained. All 14 new/expanded cases failed; the full demand
  suite was **115/24** in `/tmp/tanstack-session-retirement-ablation.json`.
  The restored fix yields **131/8** for that suite. Both runs used
  `TANSTACK_DB_ORACLE_SEED=1657009`, preserving its generated traces across the
  comparison. Final seven-suite census: **436 passing / 42 failing** in
  `/tmp/tanstack-session-retirement-final-census.json`: three preceding failing
  names removed, none added, with 13 additional test cases. Adjacent
  subscription/reentrancy/lifecycle tests: **142/0** in
  `/tmp/tanstack-session-retirement-adjacent.json`. Prettier/diff checks pass.
- Test-design corrections: status event listeners throw through a microtask,
  whereas first-ready callbacks can propagate synchronously. The throw control
  now uses `onFirstReady`, not a status listener. Focused runs pass all 14 case
  assertions but fail the suite's afterAll reach guard because required cases
  were filtered out; do not present their process exit as green. The full
  suite is the validation boundary. Missing oracle law: a generation fence
  must cover returned resources and queued work, not only late writes; old
  error delivery must preserve the new session as well as the caller's error.
  Same-session initial-error recovery notification and shared replay failures
  remain open. These counts are test functions, not unique defects.
- Fresh Field Lab loss audit of `c2054562` confirmed the report counts and
  recovered assertion-order limits. Ablated startup cases stop at session,
  cleanup, or status checks before replacement load/unload assertions; all six
  queue cases stop at load count before unload and rejection checks. Those
  later assertions pass with the fix, but were not independently ablated.
  The first-ready throw control already propagated the error before the fix;
  its old failure was missing cleanup, not error delivery. The cleanup-callback
  witness also proves logical demand survives for exact replacement-adapter
  acquisition/release with no false immediate result callback. Ablation-to-fix
  changes 16 case outcomes; parent-to-commit adds 13 cases and fixes three old
  failures. These are distinct denominators. Audit was source/report-only,
  with no reruns; its summary-led single scan could bias attention. Exact
  command/ablation provenance remains in this execution log, not the JSON alone.

- Repaired initial-error acquisition gating independently of result notification.
  New on-demand requests remain detached during source error even if the loader
  is installed. Both startup and same-session ready recovery schedule the
  existing detached-demand path. Each queued callback captures the current
  replay identity so a second notification cannot retry a failed first attempt.
  Unavailable sources retire the restart loading status without claiming work
  succeeded. No new stored field. Architecture text now states this boundary.
- Strengthened the two initial-error traces with a microtask checkpoint before
  recovery: no physical work may start while error persists. Full demand-suite
  runtime ablation (source restored exactly to HEAD) was **131/8** in
  `/tmp/tanstack-initial-error-gate-ablation.json`; restored fix is **133/6** in
  `/tmp/tanstack-initial-error-gate-verified.json`. Both used seed 1657010.
  Adjacent lifecycle/subscription/reentrancy tests are **142/0** in the latter
  report. Latest seven-suite census: **438 passing / 40 failing**,
  `/tmp/tanstack-initial-error-gate-final-census.json`, exactly the unavailable
  release and installed-loader error-gating failures removed, none added.
  Prettier/diff checks pass. The earlier `initial-error-gate-red.json` was not
  a frozen-source run; use the later ablation as red evidence instead.
- An intermediate implementation exposed three existing controls: failed sync
  must retire loading status, and loading-plus-ready notifications must not
  duplicate a failed acquisition. Both were corrected without weakening tests.
  The missing testing dimension was persistence of initial error across a
  queued turn, not just synchronous status at `markError()`.
- Result notification remains a design decision. The test expects a later
  `onLoadSubsetResult(true)` after recovery, but production consumers use the
  callback synchronously: `requestSegment` copies `load.ready` immediately after
  `requestSnapshot`, and ordered `requestAndObserve` consumes its local
  `observed` value after the call returns. A late callback would turn the test
  green without updating those consumers. Proposed contract: synchronously
  supply a pending promise and settle it after actual acquisition/recovery,
  reusing the deferred-start pattern. This changes the no-callback-yet oracle
  expectation and requires cancellation/lifetime controls. Asked the user;
  not implemented or counted as fixed. Do not add callback retention merely
  to satisfy the array-based witness.

- Fresh Field Lab loss audit of `d6bf7fb3` recovered progress hidden by the
  whole-test counts: the still-red initial-error recovery witness no longer
  starts physical work early; only its missing result notification remains.
  This does not add another fixed test. The audit confirmed the two removed
  failures and all reported counts. It read source/reports without rerunning
  tests or judging the pending-promise contract; its summary-led scan and JSON
  provenance limits remain explicit.
- Additional query controls are unchanged by this gate: source-readiness
  refinement **7/0**, subset-error matrix **28/16**, both with the fix and with
  its runtime changes ablated. Exact failed-test names match. Reports:
  `/tmp/tanstack-initial-error-query-controls.json` and
  `/tmp/tanstack-initial-error-query-controls-baseline.json`. Restored committed
  source after comparison. These 16 baseline failures are outside the seven-suite
  census and must not be counted as new regressions or silently marked fixed.

- Implemented the user-approved synchronous pending-result contract for demand
  waiting on an unavailable loader. Both snapshot entry points notify once
  before returning. One optional deferred result lives on that logical demand,
  uses the existing recovery publication barrier, and clears after settlement.
  There is no new recovery queue. Release, abort, unsubscribe, or cleanup rejects
  the unfinished wait with `AbortError`; retained demand may still reacquire in
  a later sync session. Production change is **+18 net lines** before comments.
- The outcome matrix exposed direct replay failure leaving its completion
  promise pending (query-owned replay already rejected it). Rejection now
  applies to both forms without exposing partial rows. Original witnesses that
  equated "not settled" with "no callback" now expect a pending promise. The
  pure history model records an `unacquired` promise result rather than dropping
  that event. No state, ownership, or publication checks were removed.
- Added **44** Cartesian cases: unavailable source (initial error / cleaned-up),
  snapshot entry (ordinary / limited), success/resolve/reject/throw, and release,
  unsubscribe, cleanup, or abort before/during acquisition. Limited snapshots
  have no external-signal parameter, so their abort cells are explicitly excluded.
  Tests copy the result synchronously, check pending state, private rows before
  success, exact failure/AbortError, release counts, one callback, and immunity
  to late transport settlement. Ordered fixtures install their index before
  error/cleanup: creating an index afterwards either throws or restarts sync.
- Frozen final-test runtime ablation: **128/55**, with all **44** new cases red,
  `/tmp/tanstack-recovery-notification-final-ablation.json`; runtime source was
  exactly the preceding HEAD. Restored run: demand suite **178/5**, adjacent
  lifecycle/subscription/reentrancy **142/0**, source-readiness **7/0**, and the
  separate subset-error matrix unchanged at **28/16**, in
  `/tmp/tanstack-recovery-notification-verified.json`. Seven-suite census is
  **483 passing / 39 failing** (522 test functions), seed 1657011, in
  `/tmp/tanstack-recovery-notification-final-census.json`: one old recovery
  notification failure removed, 44 passing cases added, no new failing tests.
  Prettier/diff checks pass. Typecheck remains red outside the changed lines,
  including the pre-existing grammar Set inference at demand-oracle line 329;
  no diagnostic points to this step's implementation or added tests. This is
  not a clean repository-wide typecheck claim.

- Fresh Field Lab loss audit of `3b39a8a9` confirmed the saved counts and recovered
  assertion-strength limits. All 44 ablated cases stop at the first callback
  count, so they prove the missing synchronous notification, not independent
  red evidence for every later outcome assertion. The remaining 11 ablation
  failures are six changed old notification witnesses and five surviving
  baseline failures. The history reducer models the pending-result event only;
  the finite matrix, not that reducer, checks its settlement lifecycle.
- Tightened the matrix after that audit: success records visible rows inside
  the promise observer; rejection checks Error reference identity; cleanup
  restarts the collection and proves retained demand reacquires while the old
  caller still sees AbortError. No runtime change. Demand-suite result remains
  **178/5**, `/tmp/tanstack-recovery-notification-audit-controls.json`. These
  added assertions have not each been independently mutation-tested.
- Census provenance: previous **438/40** used seed 1657010; the **483/39** run
  used 1657011, so those are not identical generated histories. A further run
  without a seed override also gave **483/39** with identical failed names,
  `/tmp/tanstack-recovery-notification-random-census.json`; all 11 random/replayed
  properties passed with fresh seeds recorded in their names. JSON reports do
  not encode runtime source hashes. The loss audit scanned source and reports
  separately but sequentially in one fresh context, not sibling-blind, and did
  not rerun tests. Its summary-led scan may hide material outside that summary.

- Fresh follow-up loss audit of `c5fd5462` found the three assertion changes
  preserved in the summary. Its recovered omissions were already recorded
  proof-scope and seed/provenance limits, plus the names behind the five demand
  failures: four truncate ownership/status cases and one truncate primary-error
  ownership case. This second audit was source/report-only, sequential in one
  fresh context, and summary-led. Final post-audit seven-suite rerun remains
  **483/39**, with exactly the same failed names, in
  `/tmp/tanstack-recovery-notification-audited-census.json` (seed 1657011).

- Reconciled five stale truncate expectations; **no production change**. A
  canceled old acquisition does not remove the queued replacement's loading
  interval. The start matrix now captures status immediately inside truncate
  reentry, before the returning Promise can create its own loading status, and
  checks the queued and replacement load counts. A synchronous startup throw
  rolls back its tentative owner even when its error callback queues truncate;
  the surviving peer replays, but the failed owner is not resurrected. This is
  the existing architecture's synchronous-throw rule, not a new recovery policy.
  Rejection after a returned acquisition still retains demand for replay.
- Preserved signal, primary-error, peer, exact acquisition identity and final
  release checks. Replacement assertions now distinguish rejected acquired
  work from a thrown start that never acquired; final unload totals reflect
  those distinct owners. These five changes are oracle corrections, not five
  claimed runtime bug fixes. The earlier catalog's "false status" and "missing
  replay" labels were misleading because it grouped physical cancellation with
  logical retirement, and synchronous throw with asynchronous rejection.
- Mutation controls prove both intended rules remain enforced. Removing only
  truncate's queued-loading transition gives **177/6**, including all four
  start/truncate cases, in `/tmp/tanstack-truncate-queued-status-final-mutant.json`.
  Keeping a failed startup owner detached instead of rolling it back gives
  **181/2**, both throw/truncate paths, in
  `/tmp/tanstack-truncate-failed-owner-final-mutant.json`. Mutations were run
  separately on frozen tests, then fully restored; production source matches
  the preceding commit. They are deliberate invalid implementations, not
  evidence of bugs in that preceding commit.
- Restored seven-suite census: **488/34**, all 522 functions retained, in
  `/tmp/tanstack-truncate-contract-final-census.json`. Exactly those five failed
  names disappear from the same-seed prior **483/39** census; none are added.
  Demand suite is **183/0**. Seed 1657011; Prettier/diff checks pass.

- Fresh Field Lab loss audit of `050911ab` confirmed only tests/ledger changed
  and all 522 census functions remain. It recovered a useful distinction:
  queued setup owns a loading interval even when a later throw leaves no owner
  to acquire. The failed-start case explicitly asserts absence; it does not
  merely skip replacement checks. Exact releases and terminal cleanup checks
  (no later attempts/unloads/status; same primary error) remain intact. Both
  mutants fail the intended inside-reentry or exact-attempt assertions, but
  cover only those two wrong implementations. Verified demand plus adjacent
  suites are **325/0** in `/tmp/tanstack-truncate-contract-verified.json`; this
  overlaps the census by its 183 demand tests, not 325 additional cases.
  Audit was source/report-only, sequential in one fresh context rather than
  independently blinded. Reports do not encode transient source mutations or
  complete command provenance; the audit's omission focus may overemphasize
  details omitted from the short summary.
- Reconciled the history reducer's queued setup phase, without changing runtime.
  Logical owners queue replay even when all source calls return synchronously
  or all owners have aborted. The reducer now emits loading before replay loads
  and readiness after setup/acquisition completion. The harness also asserts
  loading immediately after truncate commit or sync restart, before flushing
  microtasks. Exact load/unload identities, errors, signals, result callbacks,
  publication counts, ordered traces, and soft-asserted teardown suffixes stay.
  Renamed 11 test titles that described queued loading as a defect; no test
  functions were added or removed. This corrects the oracle, not 11 runtime bugs.
- Same-seed seven-suite census: **499/23**, 522 functions, in
  `/tmp/tanstack-history-queued-census.json` (1657011). History is **18/9**, up
  from **7/20**; the other six suite counts are unchanged. The remaining nine
  histories cover four pending-readiness witnesses and five unacquired-unload
  witnesses. Correcting status exposes those release failures later in the
  same histories; they remain red rather than accepting phantom unloads.
- Two separate temporary runtime mutations with frozen corrected tests:
  removing truncate's queued-loading transition gives history **10/17**, in
  `/tmp/tanstack-history-truncate-status-mutant.json`; removing the restart
  listener's queued-loading transition gives **9/18**, in
  `/tmp/tanstack-history-restart-status-mutant.json`. All four synchronous
  truncate or restart product cases, respectively, fail the immediate boundary
  assertion. These probe two specific invalid implementations, not every later
  ownership assertion. Both mutations were restored before the census; runtime
  diff against the preceding commit is empty. Adjacent lifecycle, subscription,
  and sync-reentry controls remain **142/0**, in
  `/tmp/tanstack-history-queued-controls.json`. Prettier and diff checks pass;
  no new full typecheck claim.
- Previous next slice: retain the exact owner/acquisition checks and fix the named
  unacquired-unload witness. Then reconcile obsolete-transport readiness with
  the cancellation contract; do not assume all nine history reds are distinct
  runtime bugs or that all non-cooperative source behavior is supported.
- Fresh Field Lab source loss audit of `35e300f5` recovered three limits:
  readiness after setup still requires no pending acquisition; the reducer
  models the immediate boundary and fully flushed step, not commands during
  queued setup; and the synchronous random generator still excludes all owned
  replay. Corrected that filter's stale "false loading" comment, without
  claiming the filter was removed. The next ownership fix must remove this
  broad exclusion and rerun fixed/random campaigns. The fixed synchronous
  replay matrix is green, not yet the randomly generated owned-replay domain.
  Exact state and trace assertions were preserved; title renames are 2+8+1.
- Report comparison by the parent (a second fresh scanner hit the agent limit)
  verified 522 before/after functions after normalizing the 11 renamed titles:
  no added/removed functions, exactly 11 failing-to-passing outcomes, none in
  the reverse direction. They are eight synchronous product cases and three
  synchronous ownership/suffix cases. Truncate/restart mutants introduce eight
  and nine additional failures respectively, on top of the nine baseline reds;
  four synchronous product cases in each fail the immediate status assertion.
  The source audit did not see these reports; the report check used the parent's
  existing context. JSON alone does not prove source restoration or seed command
  provenance. Summary-led omission scanning may overemphasize deliberate scope
  limits; neither audit establishes complete lifecycle coverage.

- Fixed pre-aborted replay ownership. The load wrapper skips an already-aborted
  request, but replay used to promote that non-acquisition to an active lease.
  A later release or truncate then called unload with options never passed to
  the adapter. Replay now leaves the owner detached before releasing its old
  real lease, using existing error/debt handling. Restart excludes canceled
  detached owners and retires idle queued status; this also prevents duplicate
  restart callbacks from repeating a canceled-only loading cycle. No new state,
  registry, or helper; production delta is **+16 net lines**.
- Oracle first: removed the synchronous history generator's entire owned-replay
  exclusion before fixing runtime. Fixed seed 1657004 failed after 16 cases and
  shrank to request/abort/truncate/truncate/abort, exposing an unacquired unload
  on the second truncate. Added a committed repeated-truncate history with
  release/unsubscribe suffix. Existing five unacquired-unload histories remain
  unchanged. The async generator still excludes aborted replay and pending
  supersession; that is a remaining breadth gap, not a new green claim.
- Added four exact-lease release controls: unload return/throw × ordinary or
  reentrant owner release. They check no replacement acquisition, old options
  identity, ready status, original release-error identity, no phantom unload on
  logical release, and exactly one retry of a failed real release at unsubscribe.
  On frozen expanded tests with both runtime changes removed, history+demand
  give **200/15**, `/tmp/tanstack-aborted-replay-owner-ablation.json`; all four
  new release controls fail, as do the repeated-truncate witness and widened
  fixed-seed property. Restored demand suite is **187/0**. This ablation tests
  the combined fix, not independent necessity of every line or every assertion.
- Same-seed seven-suite census (1657011): **509/18**, 527 functions, in
  `/tmp/tanstack-aborted-replay-owner-census.json`. Five prior red histories turn
  green; five new functions pass (one history plus four release cases). History
  **24/4**, demand **187/0**, other suites unchanged. Four pending-readiness
  histories remain red, plus nine publication, one settled-peer replay and four
  ordered-work failures. These are test counts, not distinct bug counts.
  Adjacent lifecycle/subscription/sync-reentry controls remain **142/0**, in
  `/tmp/tanstack-aborted-replay-owner-verified.json` (before the four new release
  controls, same runtime). Prettier/diff checks pass. Targeted ESLint reports 14
  errors and five warnings outside edited lines; no clean lint/typecheck claim.
- Next slice: reconcile obsolete-transport readiness with the cancellation
  contract, then widen the async aborted-replay generator as its named red
  boundaries clear. Do not weaken exact ownership or public snapshot checks.
- Targeted 10× history campaign: **24/4**, same four named readiness failures,
  `/tmp/tanstack-aborted-replay-owner-random-10x.json`. All four properties pass
  800 runs each: fixed seeds 1657003/1657004 and fresh random seeds
  -414294607/-1840047352. The synchronous domain has no replay exclusion; async
  exclusions remain as noted. This is not the final full-suite 100× campaign.
- Fresh Field Lab loss audit of `ef7e197d` found no removed functions or weakened
  assertions. It verified five old failures green plus five new passing cases,
  with no passing-to-failing changes. Ablation splits into history **17/11** and
  demand **183/4**. Three new release cases fail the first unload count; ordinary
  return reaches the later logical-release count. Error identity, readiness,
  and debt retry remain positive controls, not independently ablated proofs.
  "No synchronous replay exclusion" means the existing domain: two demand names,
  1–20 commands, synchronous-success acquisitions, flush after each command;
  it does not add mid-setup interleavings or other loader outcomes. Corrected
  the stale async-filter rationale and historical dashboard labels. The async
  exclusion remains an explicit gap for the next slice.
  Audit scanned sources/reports separately but sequentially in one fresh agent;
  no tests rerun and no sibling-blind control. Summary-led scanning may miss
  omissions outside its categories. JSON verifies outcomes/seeds, not source
  hashes, transient ablation state, or the 10× invocation; those rely on the
  execution record. Adjacent **142/0** controls are separate, not the verified
  report's full **349/4**, which overlaps history/demand census cases.

- Reconciled the four pending-readiness histories against the existing source
  contract (ARCHITECTURE source cancellation and overlapping replay sections).
  Replacing a physical acquisition is not releasing its logical owner. Prompt
  cancellation settles the old wait; delayed cancellation still owes settlement.
  Owner release removes its current and older waits; cleanup invalidates the
  whole source session. The previous model discarded every old wait at truncate
  even though the fixture deliberately left the old Promise pending. These four
  greens are model corrections, not runtime fixes. Runtime diff is empty.
- The pure model and harness now support `manual` settlement and prompt
  `reject`-on-abort. Added eight fixed cases: cancellation mode × one/two replays
  × current resolve/reject, with late obsolete settlements and teardown. Both
  async properties generate cancellation mode as well as command history. Removed
  aborted-replay and pending-supersession filters; neither async nor synchronous
  history generation now excludes those transitions. The separate row-bearing
  publication generator still excludes successful released-obsolete writes.
  Architecture wording now distinguishes satisfying current demand from
  releasing an older publication wait; no source success is credited to a
  replacement merely because obsolete work settled.
- Mutation controls on the frozen 36-test history suite: dropping old status
  participants at truncate gives **31/5**, including both one-replay/manual
  cases, `/tmp/tanstack-history-cancellation-early-ready-final-mutant.json`.
  Ignoring status settlement when its signal is aborted gives **24/12**,
  including all eight new cases,
  `/tmp/tanstack-history-cancellation-stuck-ready-mutant.json`. These are two
  invalid implementations, not defects in the unchanged baseline. Both restored
  before verification; tests retain exact ownership, events, errors and signals.
- Initial same-seed census was **521/14**, 535 functions, in
  `/tmp/tanstack-history-cancellation-contract-census.json`. The 10× history run
  then found a new mismatch: seed **1413322355**, path **757:13:15:15:9:9:9**,
  after 758 examples (six shrink steps). Minimal sequence: request b, truncate,
  settle current b, request a, settle a, with manual cancellation. Request a
  emits an extra empty notification while initial b remains pending. This is
  not a row-loss proof; determine whether initial pre-replay work should keep
  publication private or only hold status before changing runtime. The new
  `replacementSucceeded` model includes all gating work, so that scope itself
  needs a row-bearing/contract check. No exclusion or expected-failure mask added.
- Preserved the shrunk case with late obsolete settlement and release/unsubscribe
  suffix as a red fixed test. Final seed-1657011 census **521/15**, 536 functions,
  `/tmp/tanstack-history-cancellation-pinned-census.json`: history **36/1**,
  other suites unchanged. Eight new positive cases plus one new red witness;
  no old tests removed. Adjacent controls **142/0** in
  `/tmp/tanstack-history-cancellation-adjacent.json`. Prettier/diff checks pass;
  no new clean full lint/typecheck claim.
- The 10× report, before the fixed witness was added, is **35/1**,
  `/tmp/tanstack-history-cancellation-contract-10x.json`: fixed async 1657003,
  fixed sync 1657004 and fresh sync -252758267 pass 800 runs each; fresh async
  1413322355 finds the above case. It is not a green campaign or the final 100×
  run. Next slice: the new initial-cancellation publication boundary, followed
  by the nine row-bearing publication failures and settled-peer loss.
- Fresh Field Lab loss audit of `06fcad87` found no runtime changes or weakened
  assertions and verified all six report totals above. It recovered these limits:
  - The remaining publication-generator filter excludes successful superseded
    acquisitions even when their logical owner remains, not merely writes after
    owner release. Its name/earlier summary understates that coverage gap.
  - Prompt-cancellation cases make later obsolete-settle commands no-ops; manual
    cases exercise those settlements. The fixed matrix settles current first
    and then tears down after old settlement; other orders rely on generation.
  - Cancellation mode is uniform per history, not mixed per acquisition. Required
    transition/statistics sampling still uses manual mode.
  - History result checks prove callback identity and Promise/true shape, not
    settlement of the caller's returned Promise or exact AbortError. Those wait
    contracts remain in the finite demand matrix, not this history harness.
  - Both mutants first fail status-history checks; they do not independently
    prove every later publication/error/teardown assertion. Forced finally
    settlement/cleanup is unasserted.
  - The new fixed witness has 12 soft failures: six cumulative empty-publication
    comparisons plus six trace comparisons. Its other checked fields stay clean;
    this is one candidate mismatch, not 12 defects. The model uses all gating
    attempts for publication while architecture distinguishes replay-started
    work and permits progressive initial visibility. The next probe must
    distinguish status waits from publication waits before choosing a fix.
  Audit was read-only source/report work, sequential in one fresh agent rather
  than sibling-blind. No tests rerun or runtime inspection; summary-led scanning
  can hide other categories. JSON does not independently bind outcomes to source
  hashes, transient mutations/restoration, or successful 10× invocation. The
  matching seed-1657011 counts do not imply identical generated histories after
  adding the cancellation-mode dimension and removing filters.

- Reconciled the initial-cancellation publication witness without a runtime
  change. Initial/progressive work can owe readiness settlement after a replay
  publishes; work started inside replay holds its publication gate. The pure
  model records this membership at acquisition start, independently of runtime
  callbacks. Kept the shrunk sequence, late settlement, teardown, and all exact
  event assertions; renamed it to state the corrected contract.
- Added eight independent row-bearing cases: initial/replay origin × obsolete
  resolve/reject × old-first/current-first settlement. They assert retained and
  replacement rows, readiness, empty snapshot notifications, one replacement
  change, no obsolete error delivery, and exactly one unload per acquisition.
  The source suppresses canceled writes but allows delayed transport settlement.
  These cases do not claim safety for a source that ignores cancellation and
  continues writing. The fixture initially copied collection metadata into its
  expected public row; explicit id/version projection corrected that fixture
  error. The filtered probe passed all eight assertions but failed the suite's
  afterAll coverage guard; full-suite green below replaces that partial result.
- Frozen-test mutation controls: ignoring older replay attempts gives **230/2**,
  `/tmp/tanstack-publication-early-replay-mutant.json`; both replay/current-first
  cases fail on premature version-2 rows. Enrolling all readiness participants
  into each new replay gives **229/3**,
  `/tmp/tanstack-publication-overblocked-initial-mutant.json`; both initial/
  current-first cases fail on retained version-0 rows, and the shrunk history
  fails its notification comparison. The latter mutation converts prior
  rejection to settlement so it isolates over-blocking, not failure poisoning.
  Both mutations restored; subscription.ts has zero diff from HEAD. Other
  settlement orders and later assertions are positive controls, not independently
  isolated mutation proofs.
- Pre-mutation focused suite **232/0**, report success true,
  `/tmp/tanstack-publication-readiness-model-green.json`. Restored seed-1657011 census
  **530/14**, 544 functions, `/tmp/tanstack-publication-readiness-census.json`:
  history **37/0**, demand **195/0**, publication **7/9**, replay **68/1**,
  refinement **7/0**, ordered lifecycle **196/0**, ordered work **20/4**.
  Eight added positive cases and one model correction account for the entire
  change from 521/15; no old test removed or runtime bug claimed fixed.
- Targeted 10× plus adjacent controls **179/0**, report success true,
  `/tmp/tanstack-publication-readiness-10x-adjacent.json`: history **37/0** and
  adjacent **142/0**. All four history properties passed 800 examples each:
  fixed async 1657003, fresh async 1689398723, fixed sync 1657004, fresh sync
  -1972925180. This is not the queued final 100× campaign. Prettier and diff
  checks pass. Targeted eslint remains **9 errors / 5 warnings**, all outside
  this step's changed lines; no clean lint/typecheck claim. Next: nine
  row-bearing publication failures, then the settled-peer loss.

- Fresh Field Lab loss audit of `7f98dd2a` verified the five report totals and
  unchanged assertion/command coverage. Recovered limits and corrections:
  - Publication success still requires every current owner's acquisition to
    resolve, as well as no pending replay-member attempts. Readiness considers
    all pending attempts; membership alone does not establish success.
  - The eight cases also request a second demand after the current first demand
    settles, checking its empty notification and whether its rows join the
    still-private replay. They observe direct subscription events projected to
    id/version plus counters, not downstream queries, every synchronous-read
    surface, or exact complete row-event batches.
  - Corrected the stale model comment that said delayed cancellation always
    blocked publication. Corrected report chronology above: the focused 232/0
    report predates both mutants; post-mutation green history/demand evidence
    is in the later full census. Report timestamps verify that order, not the
    exact transient source changes.
  - Adjacent reentrancy properties also passed with seeds 1774 and 1720347121.
    All five reports contain zero pending tests. The overblocking history's
    exact publication and trace comparisons retain the mismatch through late
    settlement, both releases, and unsubscribe.
  Audit scanned committed source first and froze that reading before scanning
  reports. A second fresh scanner hit the thread limit, so both scans ran
  sequentially in one fresh agent; no sibling-blind corroboration or test rerun.
  This can steer report attention toward source-derived categories. JSON does
  not prove launch commands, multipliers, 800-example counts, source hashes,
  transient mutation patches/restoration, lint, formatting, or typecheck; those
  claims retain their execution-record provenance. Audit comments were then
  recorded in a docs-only follow-up (including the corrected source comment).

- Reconciled two publication-oracle boundaries without changing runtime code.
  The change API promises callback batches, not canonical key order inside a
  batch. Compare batches modulo order of distinct keys only: keep callback
  order/boundaries, duplicate messages, values, previous values, and stable
  order for repeated changes to the same key. The six existing replacement
  ordering cells now test complete batches instead of a fabricated key order.
  Added eight comparator controls × all six permutations of three independent
  keys (48 checks): unchanged, missing, duplicate, changed value, changed previous
  value, split batch, merged batch, reversed same-key changes. Only unchanged
  permutations compare equal. These are comparator controls, not 48 runtime
  lifecycle histories.
- Order controls on frozen tests, before cancellation-fixture changes:
  `/tmp/tanstack-publication-order-normalized.json` is **16/8**; reversing
  runtime replacement changes is also **16/8**, same failure names, in
  `/tmp/tanstack-publication-order-reversal-control.json`. Dropping replacement
  updates yields **14/10** in
  `/tmp/tanstack-publication-order-dropped-update-mutant.json`, newly failing
  the ordering and lifecycle-control tests. The ordering test compares missing
  update payloads; other product tests may stop earlier on publication counts.
  All runtime mutations restored before later verification.
- Canceled source writes are the adapter's responsibility (ARCHITECTURE source
  cancellation contract), not a promise that core can identify untagged writes.
  The fixture now captures the actual acquisition signal and suppresses its
  writes after abort, while still settling transport late. The pure source
  model likewise makes no write for canceled/obsolete settlement. Kept the two
  old command histories and their teardown, renamed them to the supported
  contract. Both now pass. Removed the aborted-resolution filter and the shared
  noncurrent-resolution filter/alias; generation now includes those histories.
  Visible-row request omission, private source-write exclusion, and independent-
  row retirement exclusion remain explicitly open; no complete coverage claim.
- Boundary controls on the widened generator:
  `/tmp/tanstack-publication-cancellation-contract.json` is **18/6**. Removing
  the fixture's cancellation guard gives **16/8** in
  `/tmp/tanstack-publication-source-ignores-cancellation-mutant.json`; both old
  histories fail on the canceled row. Keeping that guard but omitting core's
  abort on physical release gives **17/7** in
  `/tmp/tanstack-publication-core-omits-abort-mutant.json`; the released-owner
  history fails. This distinguishes a conforming source from one that ignores
  its signal and still catches broken core cancellation. It does not add
  support for malicious/nonconforming source writes or change production code.
- Initial full census was **541/11**, 552 functions,
  `/tmp/tanstack-publication-boundary-census.json`. The first targeted 10× run
  was **159/7**, NOT green,
  `/tmp/tanstack-publication-boundary-10x-adjacent.json`: adjacent **142/0**,
  publication **17/7**. Fixed publication seed 1657005 passed 600 examples;
  fresh seed **2018803696** failed after 66, path **65:10:2:10:13:12:12:0:0:0**,
  nine shrinks. Minimal history: source a; cleanup; request b; restart; abort b;
  truncate; request a. The expected empty notification was absent. Preserved
  the witness with current a/obsolete b settlements and release/unsubscribe
  suffix; interim census **541/12**, 553 functions,
  `/tmp/tanstack-publication-boundary-pinned-census.json`. Its three mismatches
  show a missing empty notification and a row update delayed until old b settles,
  not lost final rows or three separate defects.
- The shrunk case exposed a second model error: a canceled-only truncate
  replaced the publication gate with `false`, discarding earlier pending replay
  membership. Such a truncate starts no new acquisition but cannot discharge an
  older replay's settlement wait. Preserve the gate when a pending replay member
  remains. The entire pinned history now passes; command/assertion coverage stays.
  Focused history/publication **56/6** in
  `/tmp/tanstack-publication-canceled-only-model-probe.json`. Ignoring older
  runtime replay attempts makes the new fixed case red again, **18/7**, in
  `/tmp/tanstack-publication-canceled-only-early-publish-mutant.json` (publication
  only). Restored afterward; this is a model correction, not a runtime repair.

- After the canceled-only model correction, interim census **542/11**, 553
  functions, `/tmp/tanstack-publication-boundary-final-census.json`. The fresh
  10× run is **198/6**, `/tmp/tanstack-publication-boundary-final-10x.json`:
  history **37/0**, publication **19/6**, adjacent **142/0**. All generated
  properties pass: 800 examples each for history seeds 1657003, -460583158,
  1657004, 1154695554; 600 each for publication seeds 1657005 and -1354752130.
  Adjacent reentrancy seeds are 1774 and -860798335. This is NOT a green suite
  or the queued final 100× campaign; six named publication tests still fail.
- Rerunning the original fresh seed without a shrink path also matters:
  `/tmp/tanstack-publication-boundary-replay-10x.json` is **18/7**, not green.
  Publication seed 2018803696 again fails after 66 examples, now shrinking to
  path **65:29:0:0:0** (four shrinks). This time the first mismatch is a deletion
  of retained row a at a canceled-only truncate after an empty restart. Kept
  the full shrunk history including its no-op commands and added current/old
  settlements plus release/unsubscribe suffix. This is a new fixed red to
  classify with the existing retained-row retirement failures, not evidence
  that the previous delayed-publication correction failed. No new filter or
  production patch. Latest census **542/12**, 554 functions,
  `/tmp/tanstack-publication-boundary-second-pinned-census.json`: history **37/0**,
  demand **195/0**, publication **19/7**, replay **68/1**, refinement **7/0**,
  ordered lifecycle **196/0**, ordered work **20/4**.
- Net from the previous 530/14 checkpoint: three existing false-red expectations
  corrected, eight added comparator test functions, one discovered-and-corrected
  model witness, one newly pinned red. No test deleted, no runtime code change.
  Temporary controls are fully restored. Prettier and diff checks pass; targeted
  eslint reports the existing grammar error and three existing shadow warnings,
  not a clean lint/typecheck run. Next: the seven publication failures together
  (retained-row truth/retirement and duplicate delivery), then settled-peer replay.

- Fresh Field Lab loss audit of `b9a326ac` verified all 15 named report totals
  and suite splits, and found no deleted old history or teardown. It recovered:
  - Normalization affects every publication comparison, not only the six
    ordering cells. The controls cover fixed a/b/c keys, not arbitrary key
    identity. Frozen diagnostics also normalized order; the follow-up now
    preserves raw expected/observed batches in messages while comparing the
    same normalized batches. Its focused report remains **19/7**,
    `/tmp/tanstack-publication-boundary-raw-diagnostics.json`.
  - The early-publication mutant first fails the new pinned witness at truncate
    (index 5), with an unexpected deletion of retained a, not at the later empty
    snapshot notification. The dropped-update ordering test reports all six
    cells; the first expected update a plus delete d but observed only delete d.
  - Census random-or-replayed properties all use seed 1657011; this is not a new
    fresh campaign. The fresh publication seed and the failing original-seed
    rerun are separate evidence. Passing JSON entries do not contain run counts,
    multiplier/environment, exact mutation patches or restoration, or lint and
    typecheck results. Those claims (including 600/800 examples and omission of
    a replay path) depend on the execution commands, not JSON alone.
  - Corrected the stale dashboard's five ordered-integration reds to four;
    settled-peer replay is counted separately.
  Source scan was frozen before report scanning in the same fresh agent. No
  tests rerun by the auditor; this sequential correlated fallback is not
  sibling-blind, and source-first categories may steer the report scan. These
  are recovered scope/provenance limits, not a claim of complete lifecycle
  correctness. The parent's diagnostics-only verification is separate from
  the frozen commit audit. The auditor separately inspected that follow-up,
  confirming unchanged comparison rules and the same seven failure names.

### Retained-row replay scope and failure recovery

- Repaired the six existing retained-row/settled-peer failures as one bounded
  replay step. A request owns acquisition, not the whole direct subscriber's
  row filter. Successful replay keeps independent source deltas. Release prunes
  only rows matching that owner and no surviving owner, in both public and
  private snapshots. Final-owner retirement marks the retained publication for
  reconciliation with the next real source delta.
- Failed replay keeps private rows **and their sent-key tracking** together.
  Restoring only one to the public baseline drops successful peer rows or later
  retry inserts. Snapshot/pagination position still restores for callers; the
  ordered offset/cursor return/throw/resolve/reject tests remain unchanged.
  Runtime diff: **19 added / 26 removed (-7 lines)**, no new fields or state.
- Corrected two oracle expectations: failed-owner retirement removes that
  owner's failure from the publication gate; ordinary release outside replay
  does not evict cached rows unless the adapter writes deletes. The peer witness
  now asserts retained rows after release and a real source deletion afterward;
  exact lease counts and cleanup assertions remain.
- Removed the publication generator's private-source-write and independent-row
  release exclusions. The existing visible-row snapshot request omission stays
  pending the named duplicate-delivery red. No test removed or classifier added.
- Baseline focused report **87/8**:
  `/tmp/tanstack-retained-row-scope-red.json`. First census after scoped repair
  **548/6**, `/tmp/tanstack-retained-row-first-census.json` (554 functions).
  Expanded fresh 10× then found three additional replay-property failures:
  `/tmp/tanstack-retained-row-expanded-10x.json`, **232/5**. Replays: fixed 1756
  path `75:19`, fresh -911611698 path `235:18:0:0`, sequential 550351107 path
  `16:2:1:2:4:4`. These exposed the partial private-state rollback in the proposed
  patch, not three claimed independent pre-existing defects. All three shrunk
  histories are now fixed regressions, with suffixes retained.
- Removing all failure restoration fixed those generated cases but broke four
  existing ordered cursor/offset cells (**65/4** replay functions,
  `/tmp/tanstack-replay-private-tracking-10x.json`). Kept the required public
  snapshot/pagination restoration; removed only the inconsistent row resets.
- Final targeted 10×, multiplier 10 and replay seed 550351107:
  `/tmp/tanstack-retained-row-final-10x.json`, **238/2**, 240 functions:
  publication **24/2**, replay **72/0**, adjacent lifecycle/subscription/reentrancy
  **142/0**. Generated properties all pass. This is not a wholly green suite,
  not a fresh-seed claim, and not the queued final 100× campaign.
- Final seven-suite census, seed 1657011:
  `/tmp/tanstack-retained-row-final-census.json`, **551/6**, 557 functions:
  history **37/0**, demand **195/0**, publication **24/2**, replay **72/0**,
  refinement **7/0**, ordered lifecycle **196/0**, ordered work **20/4**.
- Red/green controls use the final tests. Temporarily restored subscription.ts
  exactly to HEAD (verified empty diff): focused **90/8**,
  `/tmp/tanstack-retained-row-old-runtime-control.json`. It recovers the six
  repaired named failures plus the two unchanged publication reds. Reintroducing
  only the sent-key rollback in the proposed fix makes all three new retry
  witnesses fail (**0/3**, other tests skipped),
  `/tmp/tanstack-retained-row-tracking-reset-control.json`. Both controls restored.
- Restored runtime replay suite **72/0** with default fixed-plus-fresh seeds,
  `/tmp/tanstack-retained-row-restored-replay.json`. Prettier and diff checks
  pass. Targeted eslint still reports five errors and nine warnings, all outside
  edited lines; no clean lint or standalone typecheck claim. Reports prove
  counts/failure traces, not command environment or temporary-patch restoration;
  those provenance claims depend on the recorded execution commands.
- Next: loss audit this committed step, then the duplicate snapshot and
  retained-row truncate cells, then four ordered-work reds. Do not expand the
  production design to cover unrelated paths while those known cells remain.

- Fresh Field Lab loss audit of `85e5d4d1` recovered one stale reduction: the
  older red-class table still described independent source writes as broken.
  Updated that row to historical/repaired. All nine named report totals and
  three seed/path witnesses match; no further supported missing test or cleanup
  suffix found. Fixed properties retain their own seeds; environment seed
  overrides apply to random/replayed properties, not every test in the census.
  The audit scanned code/tests before reports in one fresh agent, a sequential
  correlated fallback rather than sibling-blind scans. Source-first framing and
  the parent's saved-key observation could steer its attention. No auditor test
  execution; no correctness endorsement or independent verification of command
  environments/multipliers/temporary patch restoration.
- Separately removed the now-unread `publicationState.sentKeys` set: its type,
  two copies, and one delete. Live private sent-key tracking remains. Follow-up
  census `/tmp/tanstack-retained-row-no-saved-keys-census.json` is **551/6**, with
  exactly the same six failing names. Auditor inspected this four-line removal
  and report separately; it is correlated follow-up evidence, not part of the
  frozen commit. Combined runtime change is **19 added / 30 removed (-11)**,
  with one fewer saved set and no new state. Formatting and diff checks pass.
  Next concrete work remains the two publication cells, then four ordered reds.

### Snapshot identity and authoritative retained-row reset

- Baseline publication suite **24/2**,
  `/tmp/tanstack-publication-final-two-red.json`. The duplicate snapshot is a
  runtime bug: unrestricted subscriptions skip per-event sent-key tracking, but
  snapshot filtering consulted only that set. Reuse the existing private/public
  row map as well. Fixed named witness plus replay/subscription suite: **160/1**,
  `/tmp/tanstack-snapshot-known-rows-probe.json`; only retained-row reset remains.
- Removed `omitKnownRedVisibleRowRequests` entirely. No publication command is
  rewritten or filtered by a known-red exclusion now. The underlying bounded
  lifecycle generator still defines legal histories; this does not claim every
  possible history or query form is generated.
- The canceled-only reset witness was false-red: the model deleted only resident
  source rows after cleanup, ignoring retained public rows. Authoritative reset
  without pending acquisition replaces the whole published snapshot. Corrected
  that rule, keeping the original witness and all its suffix commands.
- Crossed empty reset with restart/no restart and absent/canceled ownership
  (four fixed cells). This exposed a real runtime gap: with no remaining demand,
  a reset skipped reconciliation and retained old rows indefinitely. Existing
  replay state now handles that empty replacement after commit. No new field,
  token, or tracker. No-loader sources start no phantom acquisition.
- The unrestricted 10× probe was **27/3**,
  `/tmp/tanstack-publication-unrestricted-probe.json`: the new no-owner cell and
  both generated properties found retained-row reset. Fixed seed 1657005 failed
  after 165 examples, path `164:18`; fresh seed 333468655 after 60, path
  `59:13:0:0:0`. Kept both full shrunk histories, including no-op commands, and
  added reacquisition/settlement/release/unsubscribe suffixes. After runtime fix,
  targeted 10× using replay override 333468655 was **244/0**,
  `/tmp/tanstack-publication-retained-reset-10x.json` (publication 30, replay 72,
  adjacent 142).
- Added six fixed same-commit replacement cells: absent/canceled owner ×
  identical row/changed row/different key. The fixture and pure model both accept
  an explicit truncate replacement row; exact batch comparisons prohibit a
  temporary empty publication. This replacement payload is fixed-matrix coverage,
  not a new random-generator dimension. Fresh 10× publication **38/0**, fixed
  seed 1657005 plus fresh 2086674390 (600 examples each),
  `/tmp/tanstack-publication-atomic-reset-10x.json`. Interim census **565/4**,
  `/tmp/tanstack-publication-complete-census.json`, 569 functions.
- Loaderless controls initially used an invalid on-demand fixture: four
  configuration errors, not runtime regressions (**565/8** interim census,
  `/tmp/tanstack-publication-loaderless-census.json`). Correct eager configuration
  then exposed the model's source-authority boundary (**38/4** publication,
  `/tmp/tanstack-publication-eager-controls.json`): this fixture marks its complete
  empty source ready at restart, so it must remove retained rows then, not wait
  for a later truncate. Corrected that fixture-specific expectation and kept all
  four controls, now named for eager restart. They are not random eager-history
  coverage or evidence of a new eager bug. **42/0**,
  `/tmp/tanstack-publication-eager-contract-controls.json`.
- Red/green: temporarily restored subscription.ts exactly to HEAD, verified by
  empty runtime diff. Final tests **35/7**,
  `/tmp/tanstack-publication-final-old-runtime-control.json`: duplicate snapshot,
  empty no-owner reset, different-key atomic replacement, both pinned reset
  histories, and both generated properties fail. Earlier 38-test control **31/7**
  is `/tmp/tanstack-publication-old-runtime-control.json`. Restored the proposed
  runtime afterward; no control code remains. Restored adjacent run before eager
  additions **252/0**, `/tmp/tanstack-publication-restored-adjacent.json`.
- Final seven-suite census with random-property seed override 1657011:
  `/tmp/tanstack-publication-final-census.json`, **569/4**, 573 functions: history
  37/0, demand 195/0, publication 42/0, replay 72/0, refinement 7/0, ordered
  lifecycle 196/0, ordered work 20/4. Fixed properties retain their fixed seeds.
  Production diff **7 added / 8 removed (-1 line)**; reuses existing state.
  Four ordered-work reds remain; no claim of full suite correctness or final
  100× completion. Next: commit/loss audit, then ordered consumer recovery.

- Later fresh 10× **41/1**, `/tmp/tanstack-publication-final-fresh-10x.json`,
  found a model source/publication conflation after 592 examples: fresh seed
  1337491191, path `591:20:1:8:8:8:7:7`. Final-owner retirement copied retained
  visible rows into model source state, inventing rows deleted by truncate.
  Removed both such copies; retained the full witness and a real source-update
  suffix. Replay **43/0**, `/tmp/tanstack-publication-source-truth-replay-10x.json`.
  This is an oracle correction, not another runtime fix.
- Added direct model-versus-collection source-row equality while subscribed.
  Initial unrestricted assertion was out of range after unsubscribe: the source
  keeps processing commands but the publication model intentionally stops.
  `/tmp/tanstack-publication-source-truth-fresh-10x.json` was **36/7**, including
  fixed seed 1657005 path `0:1:0:0:2:2:2:3:3:3:2` and fresh -2130962936 path
  `11:1:0:1:0:0`; both shrink to post-unsubscribe source work. Bounded the new
  source equality to live subscriptions without removing any command or the
  existing post-unsubscribe callback-silence assertions. These were assertion
  domain errors, not seven new runtime defects.
- Latest targeted 10× **43/0** with override 1337491191 and fixed 1657005,
  `/tmp/tanstack-publication-source-truth-bounded-10x.json` (600 examples each).
  Latest seven-suite census **570/4**, 574 functions,
  `/tmp/tanstack-publication-bounded-source-final-census.json`; same suite splits
  as above except publication now 43/0. Intermediate expanded source-assertion
  census is `/tmp/tanstack-publication-source-truth-census.json`, not the latest
  checkpoint. No final 100× claim.
- Repeated the old-runtime control after the source-truth assertion and newest
  witness: **36/7**, `/tmp/tanstack-publication-source-truth-old-runtime-control.json`.
  Runtime matched HEAD exactly during the control and was restored afterward.
  The same seven failures remain; the new model witness does not claim a new
  old-runtime defect.
- Restored publication suite **43/0**, default fixed-plus-fresh run,
  `/tmp/tanstack-publication-final-restored.json`. No temporary mutation remains.
- Fresh Field Lab loss audit of `8d66f43f` checked the frozen source/tests before
  all 21 named JSON reports. It recovered one stale dashboard status: the
  no-acquisition truncate row still described a phantom unload. Corrected it to
  historical/repaired; the existing lifecycle witness asserts zero loads and
  unloads through truncate and unsubscribe and passes in the final census.
  It also recovered the compressed intermediate source-assertion census detail:
  **563/11**, seven post-unsubscribe assertion-domain failures plus four ordered
  reds; seed 1657011 path `0:1:1:1:3:1:1:1` shrinks to unsubscribe → source upsert
  a → abort a. This is the already-recorded assertion-range error, not a new
  defect or the latest result. All stated report totals and explicit seed/path
  pairs matched; no dropped original witness, suffix, or callback-silence check
  was found. The scan was sequential/correlated in one fresh agent, not
  sibling-blind; source-first categories and task framing may steer omissions.
  No auditor tests run, no correctness endorsement, and no independent proof of
  successful example counts, environments, or temporary patch restoration.
- Formatting/diff checks pass. Targeted eslint reports five pre-existing errors
  outside changed lines and two shadow warnings; no standalone typecheck or
  clean lint claim. JSON supports counts/failures/seeds, not successful run counts,
  environment overrides, temporary patch identity/restoration, or lint results;
  those rely on the recorded execution commands.

### Ordered consumer coverage and independent-source recovery

- Shared the existing emitted-row ordering invalidation rule between Collection
  and Effect via `trackBiggestSentValue`. An order-changing update invalidates
  finite source coverage even when the local top-K remains full. Effect used to
  clear only its cursor, leaving the newly eligible remote row unrequested.
  Reuses each consumer's existing D2 row map; no new stored state.
- Loader suppression now checks the affected subscription's replay, not every
  source in the graph. Unrelated sources may acquire their replacements while
  the graph's existing publication barrier still retains the public snapshot.
  The callback scheduler no longer drops a source's data-loader callback merely
  because another source is replaying. The loader performs its source-local
  check at execution time. Ordered promise tracking uses the same local scope.
- Expanded the finite-prefix parity witness to move/delete × Collection/Effect.
  Each mutation runs both consumers concurrently, checks the independently
  expected row, additional acquisition, and final publication parity. Delete
  already passed before this patch: it is a control, not another defect.
  Strengthened independent-source recovery to require new primary work while
  secondary replay is still pending, while public rows remain unchanged.
  No old witness was removed or made expected-failure.
- Before runtime changes, focused expanded cases were **1/2**,
  `/tmp/tanstack-ordered-isolation-expanded-red.json`: move and source isolation
  fail; delete passes. Initial full ordered-work run after runtime changes was
  **23/2**, `/tmp/tanstack-ordered-isolation-first-green.json`.
- Temporarily restored all three edited runtime files exactly to `d702e7fe`
  (empty git diff verified), retaining final expanded tests. Five-suite control
  **277/25**, `/tmp/tanstack-ordered-isolation-old-runtime-control.json`:
  ordered-work **21/4**, Effect **67/2**, loader **31/0**, pagination **130/3**,
  subset-error matrix **28/16**. Restored the runtime patch afterward. A first
  reverse-patch attempt had an invalid filename and applied nothing; corrected
  its path before the verified control. No temporary control remains.
- Final restored eleven-suite run, seed override 1657011:
  `/tmp/tanstack-ordered-isolation-final-census.json`, **835/17**. Bounded seven
  lifecycle suites **573/2** (575 functions): history 37/0, demand 195/0,
  publication 43/0, replay 72/0, refinement 7/0, ordered lifecycle 196/0,
  ordered work 23/2. Adjacent **262/15**: Effect 67/2, loader 31/0,
  pagination 130/3, subset-error matrix 34/10. Six Effect ordered incremental
  failure cells (throw/reject × Error/NaN/undefined) also turn green: ordering
  invalidation now reaches the failing acquisition and reports its error.
  No new adjacent failure relative to the old-runtime control.
- Production diff **27 added / 30 removed (-3 lines)**, including shorter
  helper documentation. Prettier passes. Targeted eslint still reports five
  errors outside edited lines: Effect import ordering and `attempt` const;
  ordered-work import ordering, an existing type assertion, and an optional
  chain. No clean-lint or standalone typecheck claim. No final 100× claim.
- Targeted 10× initially hit the default five-second timeout in both consumer
  properties: **217/4**, `/tmp/tanstack-ordered-isolation-fresh-10x.json`.
  The extra failures report `STACK_TRACE_ERROR` at about 5001 ms, with fixed
  seed 17801 and fresh seed -1475725790; they are not shrunk counterexamples.
  Replayed with seed -1475725790, multiplier 10 and `--testTimeout=60000`:
  **219/2**, `/tmp/tanstack-ordered-isolation-replay-10x.json`. Both properties
  pass in roughly six seconds; only the same two named ordered-work failures
  remain. Ordered lifecycle's fixed seed is 93471. Consumer inputs retain their
  seeds, but lifecycle's random seed changed from -1515386861 to -1475725790
  through the suite-wide override; this is not an identical-input lifecycle
  replay. Both lifecycle random runs pass. No runtime or expectation change.
  Successful example
  counts rely on the recorded command/config, not JSON test totals.
- Fresh Field Lab loss audit of `8b018f9a` recovered the lifecycle-random seed
  distinction above. All nine source reports' totals matched; no additional
  supported code/test omission was found. All fifteen adjacent failures persist
  from control to final; six Effect ordered error cells become green. The old
  source-isolation witness failed on final rows; the strengthened control fails
  earlier on no new acquisition (`2 > 2`). This was one fresh sequential scanner,
  source diff before reports, not sibling-blind. Framing/order can preserve the
  chosen categories at the expense of other omissions. No auditor test execution,
  correctness endorsement, or independent proof of commands, successful example
  counts, temporary patch restoration, or lint results.
- [x] Distinguish valid finite walks from duplicate tie-boundary acquisition;
      correct the work bound and repair boundary retention (next section).
- [x] Resolve synchronous full-source recovery publication, including retry,
      partial ordinary updates, and queued cleanup controls (next section).
- [ ] Reconcile/fix the fifteen pre-existing adjacent failures before claiming
      broad green: two Effect release-retry assertions; three pagination
      reentry/session-return assertions; six live ordered incremental failure
      cells; three Effect obsolete-demand cleanup cells; one live cleanup retry
      cell. These are test failures, not fifteen confirmed distinct bugs.
      Keep the existing assertions until each has a contract-backed disposition.
      Six live ordered cells are reconciled below; nine failures remain.
      The release-error reentry step below resolves another five assertions;
      four remain: live cleanup retry and three window-behavior cases.
      Live cleanup retry is now repaired; only the three window cases remain.

### Ordered work bounds and tie-boundary retention

- The original underfilled witness did not repeat a request. Its five-row trace
  contained nine distinct exact keys: five pages (including the terminal empty
  page) and four tie-boundary loads. It failed the constant cap of eight before
  reaching the no-duplicate assertion. This is an oracle bound error, not proof
  of a runtime loop. Preserve that original scenario in the expanded matrix.
- Replaced the constant with two source-size bounds: at most one page and one
  boundary load per source row; total at most twice source size. Kept exact-key
  uniqueness, expected output, error/liveness parity, empty errors, and live
  consumer assertions. Added an explicit boundary-count bound and trace
  diagnostics. Fixture remains the same finite immutable source protocol.
- Expanded 1 case to 20: middle row count 0–4 × ascending/descending × tied/
  distinct ranks, through both consumers. The matrix before production changes
  was **16/4**, `/tmp/tanstack-ordered-progress-bound-matrix.json`. Four new
  descending/tied cases (middle count 1–4) reach the uniqueness assertion and
  report three unique keys in four requests. Those are actual duplicate loads,
  not the old incorrect work cap. Seven-suite pre-fix census **589/5**, 594
  functions, `/tmp/tanstack-ordered-progress-matrix-final-census.json` (seed
  override 1657011); ordered-work 39/5, others unchanged.
- A row emitted by a tie-boundary acquisition cleared the loader's existing
  last-boundary record through ordinary cursor invalidation. Its next finite
  continuation then acquired the same boundary again. Move the two existing
  boundary resets from `invalidateCursor` to `resetCursor`: new row arrivals
  retain that record, while replay/reset and disposal still clear it. A different
  boundary value continues to compare unequal in `loadBoundary`. No new state,
  helper, or production lines (**2 added / 2 removed**).
- Eight-suite restored run **624/1**,
  `/tmp/tanstack-ordered-boundary-retention-green.json`, override 1657011:
  seven-suite lifecycle census **593/1**, plus source-loader **31/0**. Ordered
  work is **43/1**; its only red is synchronous full-source recovery publication.
  New matrix 20/0. The pre-fix matrix/census are red controls for these same
  tests against the preceding committed runtime; no expected-failure filter or
  runtime ablation remains.
- Targeted 10× with override -1475725790 and `--testTimeout=60000`, including
  Effect, pagination and error-matrix neighbors:
  `/tmp/tanstack-ordered-boundary-retention-10x-adjacent.json`, **470/16**:
  ordered lifecycle 196/0, ordered work 43/1, Effect 67/2, pagination 130/3,
  subset-error 34/10. The fifteen adjacent failure names are unchanged; no new
  failure names versus the preceding final census. This is not the final 100×
  or the entire repository suite. Prettier and diff checks pass; no new lint or
  standalone typecheck result claimed for this step.
- Fresh Field Lab loss audit of `681ed762` found no supported omission in this
  step or the dashboard. It checked frozen source/tests before the five reports:
  original scenario and assertions survive; matrix-only run has 24 unrelated
  skipped tests; the four new red traces repeat the rank-zero boundary; all
  totals and executed seed labels match. Failure paths also still clear the
  boundary record; reset/replay/disposal above are not an exhaustive list.
  One sequential source-first scanner, not sibling-blind: requested categories
  and source order may hide other omissions. No auditor tests or correctness
  endorsement. JSON does not independently establish command environments,
  successful example counts, timeout settings, runtime restoration, lint, or
  typecheck. The matrix-only report's random property was skipped, so its seed
  label is not an executed campaign.

### Queued ordered recovery publication

- A synchronous full-source startup throw rolls back its tentative logical
  demand and returns no acquisition promise. The earlier finite replay may
  still complete, so merely recording the subscription error allowed its
  partial rows to reach the public query. Keep the queued startup inside the
  existing ordered-publication guard using a tracked Promise instead of a
  fire-and-forget microtask with a swallowed throw. A failed startup keeps the
  public snapshot; a later attempt resets the guard and successful replay
  publishes the replacement. Async acquisition remains owned by replay.
- Capture the scheduling loader in that task; cleanup disposes it rather than
  letting queued work consult a later replacement loader. No new stored state,
  helper, or production lines: **7 added / 7 removed**. Architecture now records
  startup's publication participation and loader ownership explicitly.
- Recovery matrix is now pending success plus sync/async × one/two failures.
  All failure variants retry to success. Kept the original retained-rank and
  no-publication assertions, exact error identity, no escaped callback errors,
  complete final source/query rows, request counts, and exact one-release per
  established acquisition. Added same-order payload updates while failed:
  both row values and publication count remain old, no automatic retry starts,
  and final recovery exposes the updated payload in one publication. After a
  repeated failure, recheck retained rows, publication count, and exact error.
- Added two queued cleanup controls, with/without later restart. No queued
  source request runs after cleanup; restart can preload normally with no
  full-source request or stale error. These controls already pass on the old
  runtime; they are not additional repaired bugs. They do not execute a
  replacement loader before the old task drains, so capture ownership is also
  a source-level guarantee, not a separately red/green-tested ABA witness.
- Expanded recovery matrix before production changes **3/2**,
  `/tmp/tanstack-ordered-sync-publication-expanded-red.json`: both sync cases
  publish `[0, 0.5, 2, 3]` instead of retaining `[1, 2, 3, 4]`. First proposed
  runtime **5/0**, `/tmp/tanstack-ordered-sync-publication-first-green.json`.
  Initial eleven-suite run **857/15**,
  `/tmp/tanstack-ordered-sync-publication-census.json`, before the two queued
  cleanup controls and later payload assertions. Focused final behavior with
  suffixes/controls **7/0**, `/tmp/tanstack-ordered-sync-publication-suffixes.json`.
- Red control: temporarily restored the sole edited runtime file exactly to
  `af727940` (empty git diff verified), keeping the expanded tests. **5/2**,
  `/tmp/tanstack-ordered-sync-publication-old-runtime-control.json`: same two
  wrong-publication failures; both cleanup controls and async variants pass.
  Restored the runtime afterward; no temporary control remains.
- Final eleven-suite run, override 1657011:
  `/tmp/tanstack-ordered-sync-publication-final-census.json`, **859/15**.
  Bounded seven suites **597/0**: history 37, demand 195, publication 43,
  replay 72, refinement 7, ordered lifecycle 196, ordered work 47. Adjacent
  **262/15**: loader 31/0, Effect 67/2, pagination 130/3, error matrix 34/10.
  All fifteen adjacent failure names persist; no new failure names relative to
  `/tmp/tanstack-ordered-isolation-final-census.json`.
- Fresh targeted 10× with `--testTimeout=60000`, no replay override:
  `/tmp/tanstack-ordered-sync-publication-fresh-10x.json`, **243/0**. Ordered
  lifecycle fixed/random seeds 93471/925069818; ordered consumer fixed/random
  seeds 17801/-2109404373. Successful example counts come from command/config,
  not JSON function totals. This is not the final 100× or the whole repo suite.
- Renamed the cleanup fixture row to remove the only new lint warning, then
  repeated focused tests **7/0**,
  `/tmp/tanstack-ordered-sync-publication-final-focused.json`. Prettier/diff
  checks pass. Targeted lint still has three pre-existing test errors (imports,
  assertion, optional chain), no new warnings; no standalone typecheck or
  clean-lint claim. A lint process overlapped the old-runtime control, so its
  source-file snapshot is not independently established by that first output;
  the final lint rerun used the restored runtime.
- Fresh Field Lab loss audit of `397f9625` found no supported omission in this
  step or dashboard. Frozen source/test scan preceded all eight report scans;
  counts, executed seeds, and the fifteen unchanged adjacent failure names
  match. Focused reports have 40 unrelated skipped functions, including both
  seeded properties: their printed seeds are not executed campaigns. Old-runtime
  sync failures stop at the first retained-rank check; those reds do not execute
  payload/retry suffixes or post-finally release assertions. Final green reports
  cover those later checks. One fresh sequential source-first scanner, not
  sibling-blind; framing and reading order may hide other omissions. No auditor
  tests, correctness endorsement, or adjacent-failure diagnosis. JSON does not
  independently prove environment commands, multipliers/example counts, timeout
  settings, temporary restoration, or lint/typecheck runs.

### Adjacent incremental-error phase boundary

- The ordered failure fixture threw on load number two, but initial preload
  now includes tie-boundary refinement. All six live ordered cells therefore
  rejected during preload, before the intended incremental delete. The six
  Effect ordered cells also lacked an explicit settled-startup checkpoint.
- Arm failure only after startup settles. Prove no prior error and a live
  consumer before deleting the visible row; then require a new ordered request,
  exact error identity (or normalized Error for non-Error throws), the existing
  consumer-specific status/disposal behavior, unique incremental demand keys,
  and final subscriber cleanup. Initial refinement must have made more than
  one request. The twelve lazy variants remain in the same matrix. No tests or
  prior post-failure assertions removed, no production changes.
- Original focused run **18/6**:
  `/tmp/tanstack-adjacent-incremental-original-red.json`. Corrected fixture
  **24/0**: `/tmp/tanstack-adjacent-incremental-armed.json`.
- No-failure control: replace only the armed ordered adapter's failure with
  success, keeping all assertions. **12/12**:
  `/tmp/tanstack-adjacent-incremental-no-failure-control.json`. Every ordered
  case fails its error assertion; all lazy cases pass. This tests sensitivity
  to the missing injected error, not a production error-reporting mutation.
  Restore the fixture and rerun **24/0**:
  `/tmp/tanstack-adjacent-incremental-restored.json`. No control remains.
- Eleven-suite checkpoint with seed override 1657011 **865/9**:
  `/tmp/tanstack-adjacent-incremental-census.json`. Seven bounded suites remain
  **597/0**; adjacent suites **268/9**: loader 31/0, Effect 67/2, pagination
  130/3, error matrix 40/4. This is not whole-repository green or final 100×.
  Prettier and diff checks pass; no new lint or standalone typecheck claim.

- Fresh Field Lab loss audit of `2d7f28cb` recovered two compressed limits:
  each focused report skips 20 other functions (12 startup, six obsolete-demand
  cleanup, live cleanup retry, reentrant ordered error). The no-failure control
  stops at the error assertions, before ordered request/key and subscriber-count
  checks; finally cleanup runs, and restored green reaches the later checks.
  Counts, retained assertions, and nine remaining failure names match. One fresh
  sequential source-first scanner, not sibling-blind; phase framing and source
  order may hide other omissions. No auditor tests or correctness endorsement;
  JSON does not prove commands, property examples, temporary restoration, or
  formatting/lint/typecheck results.

### Release-error reentry and retained cleanup

- A release failure was reported while its acquisition still held the
  in-progress release guard. Effect's error callback disposes synchronously;
  that nested unsubscribe skipped the busy acquisition, returned success,
  and let Effect forget its retry callback. The debt itself survived inside
  the subscription, but its owner no longer had a cleanup handle.
- Complete the adapter attempt and remove the guard before reporting its
  failure. Error-triggered teardown can then retry the exact debt, either
  releasing it or observing another failure and retaining its callback. Keep
  the guard during actual adapter reentry. Fold the one-use release helper
  into its caller: **20 production lines added / 27 removed**, no new state.
  The architecture records the adapter/error-delivery phase distinction.
- Add four oracle cases: adapter vs error-listener reentry × one/two release
  failures. Check the phase-specific attempt count, nested failure identity,
  logical subscriber removal, exact acquisition options, retry to success,
  and no further physical unload after success. Error-listener delivery must
  expose the original Error. Existing unit/Cartesian cases remain intact.
- First red report `/tmp/tanstack-release-error-reentry-red.json` is **2/2**,
  but cleanup masked the two-failure case's first assertion. Change only final
  teardown order to retire the fixture's source session before unsubscribing:
  `/tmp/tanstack-release-error-reentry-clean-red.json` is **2/2**, both error
  listener cases now fail the attempt count (one instead of two). Adapter
  reentry controls already pass. These reds precede the final Error identity
  assertion; final green reaches retry and exact-lease suffixes.
- First proposed runtime across demand/Effect/error-matrix suites **310/2**:
  `/tmp/tanstack-release-error-reentry-first-green.json`. All four added oracle
  cases and four existing obsolete-demand cleanup failures pass. The remaining
  Effect reentrant-disposal assertion expected a duplicate unload while the
  first was still executing. Correct that checkpoint to one, preserve retry
  on the next explicit disposal, add logical subscriber removal and a third
  disposal proving no duplicate release after success. No production change
  was needed for that assertion.
- Eleven-suite final checkpoint, seed override 1657011 **874/4**:
  `/tmp/tanstack-release-error-reentry-census.json`. Bounded **601/0**; adjacent
  **273/4** (Effect 69/0, loader 31/0, pagination 130/3, error matrix 43/1).
  Still open: live cleanup retry and three window-return/reentry cases. No
  whole-repository or final 100× claim. Prettier/diff pass. Targeted ESLint
  reports 13 errors and one warning, all on unchanged statements outside this
  patch; no clean-lint or standalone typecheck claim.

- Fresh Field Lab loss audit of `4adb7b90` recovered three compressed details:
  focused reds each skip 195 functions (including both seeded properties);
  `toEqual([failure])` and `toThrow(failure)` do not prove Error reference
  identity; and the four remaining stopping assertions needed exact names.
  Source delta, counts, and preserved suffixes otherwise match. One fresh
  sequential source-first scanner, not sibling-blind; framing and reading order
  may hide other omissions. No auditor tests or broad correctness endorsement.
  JSON does not prove environment, historical restoration, lint/typecheck,
  multipliers, or successful example counts.
- Audit follow-up strengthens both outer and nested release errors with
  `toBe(failure)`. Focused `/tmp/tanstack-release-error-reentry-identity-followup.json`
  has **4 passing functions / 195 skipped**, but is **not a successful suite**:
  the unconditional afterAll coverage census rejects the skipped coverage.
  A verbose rerun confirmed that hook failure. The earlier two focused red
  reports likewise are not full-suite results; their individual failures remain
  valid witnesses. Full demand rerun after this assertion change is **199/0**,
  success true, `/tmp/tanstack-release-error-reentry-identity-full.json`;
  executed fixed/random seeds 1657002/1147159702. Original frozen audit does not
  cover this follow-up. Ordinary subscription suite also **63/0**, success true,
  `/tmp/tanstack-release-error-reentry-subscription-adjacent.json`.
- Remaining exact witnesses (from the eleven-suite checkpoint):
  - `rejects a window move reentered from the initial ordered request`:
    nested result is true, expected undefined.
  - `rejects a window move reentered from a public change callback`:
    nested result is true, expected undefined.
  - `does not settle a window move after its sync session is cleaned up`:
    result is true, expected a Promise.
  - `retries live cleanup after an undefined failure survives demand retirement`:
    two unloads, expected three. These remain assertion failures awaiting
    diagnosis, not four confirmed distinct runtime defects.

- Continuation audit of `41290dd4` found no supported omission in the identity
  assertion follow-up or its three reports. This reused the prior auditor after
  a fresh scanner hit the thread limit, so prior framing and source-first order
  may hide omissions. It verified function/suite success distinctions, retained
  suffixes, and seed labels, but did not inspect the verbose hook-failure output
  or run tests. No independent runtime/command/lint/typecheck endorsement.

### Failed live cleanup retry

- Clearing adapter hooks before cleanup was required for session reentry, but
  also discarded a throwing cleanup callback permanently. Retain that failed
  callback only if the existing sync epoch still identifies this retirement.
  A reentrant replacement keeps its own callback. Load/unload hooks stay
  detached. **4 production lines added / 1 removed**, no stored state added.
- Expanded the old undefined-throw witness to undefined/NaN/Error, preserving
  error surfacing and two failed unloads, then proving successful explicit
  cleanup retry, zero source subscribers, and no duplicate release on a later
  cleanup. Error instances also keep their cause identity. Before runtime fix:
  **0/3**, `/tmp/tanstack-live-cleanup-retry-expanded-red.json`.
- Added cleanup-handle controls with/without a nested replacement session.
  Before fix **1/1**, `/tmp/tanstack-cleanup-handle-session-red.json`:
  same-retirement retry is missing, while replacement ownership already passes.
  They assert original error cause, callback session IDs, retry/no-repeat, and
  one surfaced error. These check cleanup-handle ownership, not full nested
  restart data/readiness coherence.
- First runtime with full error/error-matrix suites **60/3**,
  `/tmp/tanstack-live-cleanup-retry-green.json`: all five cleanup controls pass;
  three old session-isolation tests stop at abandoned preload rejection. They
  expected cleanup to resolve unfinished preload, contrary to the established
  AbortError contract. Exact old-runtime ablation (empty sync.ts diff verified)
  gives **56/7**, `/tmp/tanstack-live-cleanup-retry-old-runtime.json`: the same
  three preload assertions plus four cleanup retry witnesses fail. Restored
  the runtime; no control remains.
- Correct those three setup assumptions by observing the pending preload's
  AbortError before cleanup, then awaiting that assertion before exercising
  stale callbacks. All original stale-error/transaction assertions remain.
  Final adjacent run **126/0**, success true:
  `/tmp/tanstack-live-cleanup-retry-final-adjacent.json` (errors 17, subscription
  63, error matrix 46). No runtime change was needed for those setup errors.
- Eleven-suite checkpoint with seed override 1657011 **877/3**:
  `/tmp/tanstack-live-cleanup-retry-census.json`. Bounded **601/0** and adjacent
  **276/3**; the same three pagination window failure names remain. The three
  collection-error setup corrections came afterward and are covered by the
  final adjacent run. Prettier/diff pass; no new lint/typecheck or final 100×
  claim. The architecture now states the failed-cleanup callback's epoch bound.

- Field Lab loss audit of `75537a20`, using the existing auditor because of
  the thread limit, recovered focused skip counts (expanded red 43; handle red
  15), and assertion reach: the reds stop at missing-retry counts before later
  zero-subscriber/no-repeat checks. Final green reaches those suffixes. It also
  caught the parameterized message assertion losing the `error: ` prefix.
  Restored that prefix for all three values, then reran the entire error matrix:
  **46/0**, success true, `/tmp/tanstack-live-cleanup-retry-message-followup.json`.
  Frozen audit preceded this one-line assertion repair. Counts, production
  delta, and three remaining window names otherwise matched. No auditor tests
  or runtime endorsement; same-context framing and source order may hide
  omissions, and reports do not prove command/ablation/formatting provenance.
- Next window investigation must distinguish initial request, later refinement,
  public graph publication, and cleanup during an actual new acquisition.
  The builder currently guards only an explicit active window operation; the
  loader separately holds its synchronous `requesting` flag. A startup-only
  guard would not prove asynchronous refinement reentry safe. Add request-reach
  checks before treating the cleanup test's synchronous `true` as a runtime
  failure. No window implementation or expectation changed in this step.

### Window reentry and cleanup-before-wait

- Reentry checked only an active explicit window move, missing startup source
  requests, later refinement after asynchronous settlement, and public graph
  callbacks. Read the loader's existing synchronous request guard through a
  callback on its compiled order information, and use the builder's existing
  graph-running guard. Reject before changing top-K. This adds one read-through
  callback, not an independent mutable lifecycle flag.
- Cleanup rejected an existing waiter but did not retain the cancellation for
  a waiter attached later. Store AbortError in the operation's existing error
  fields. Already-completed operations remain successful. Total runtime delta
  across four files: **15 added / 3 removed = +12 lines**. Architecture records
  both boundaries. No new queue, registry, or lifecycle counter.
- Expanded startup reentry into request 1/2 × sync/async delivery. The async
  refinement witness asserts that the first page settled. All four retain the
  window and rows, then prove a later ordinary expansion succeeds. Public
  callback reentry remains covered. Cleanup during acquisition now checks that
  the cleanup trigger fired and completed before checking cancellation.
- Added waiter-before/after-cleanup × pending/no-pending operation cells.
  Wait-before with no pending work is the already-completed positive control.
  Superseded waiters already rejected correctly; changed the old successful
  settlement expectation to AbortError and observe both rejections before
  cleanup. No runtime repair is claimed for that stale expectation.
- Expanded pagination before the fix: **0/6, 130 skipped**, success false,
  `/tmp/tanstack-window-phases-red.json`. Final focused old-runtime control:
  **3/8, 180 skipped**, `/tmp/tanstack-window-boundaries-old-runtime.json`.
  All four runtime files matched HEAD before that control. Six pagination
  witnesses stop at missing reentry rejection or missing cancellation; two
  late-waiter cells stop at undefined instead of AbortError. The cleanup-reach
  assertions pass on the old runtime. Green tests reach the later recovery
  suffixes; the two late-waiter reds stop before resolving the transport and
  checking its later outcome. The focused control is not a whole-suite success
  claim. Seed-labeled properties skipped in focused runs are not campaigns.
- Restored runtime, final eleven-suite run with seed override 1657011:
  **883/0**, no skips, success true,
  `/tmp/tanstack-window-boundaries-census.json`. Bounded **601/0**, adjacent
  **282/0**, including pagination **136/0**. The earlier focused waiter run is
  **5/0, 50 skipped**, success true
  (`/tmp/tanstack-window-waiter-matrix-green.json`), not the full file.
- Full controller file: **48/7**, no skips, success false,
  `/tmp/tanstack-window-controller-adjacent.json`. Repeating with all four
  runtime files exactly at HEAD gives **46/9**, no skips, success false,
  `/tmp/tanstack-window-controller-old-runtime.json`: the same seven failures
  plus the two late-waiter cells. Restored all four files; no ablation remains.
  The seven are a separate follow-up, not seven newly introduced or confirmed
  distinct defects:
  - [x] `restores the initial operator window when a graph run throws`
  - [x] `does not shrink the physical window when preload overlaps a page fetch`
  - [x] `reset does not inherit a superseded expansion failure`
  - [x] `coordinates the physical window across multiple controllers`
  - [x] `restores the query's initial window after the last lease is released`
  - [x] `retains the original baseline when its first restoration throws`
  - [x] `retains the original baseline when its first restoration rejects`
- Diff check and targeted formatting pass. No new full lint/typecheck or final
  100× claim. No push.
- Field Lab loss audit of `c4e8207c` recovered the two focused skip counts,
  late-waiter red suffix limits, and stale current-status framing of historical
  rollback/reset results. Corrected those record gaps here. Other frozen source
  assertions, runtime delta, report counts, and seven failure-name comparisons
  matched. Reused auditor because the thread limit prevented a fresh scanner;
  prior framing and source-first order may conceal omissions. No auditor tests
  or runtime endorsement; JSON does not prove commands, ablation/restoration,
  formatting, or multipliers. This record correction follows the frozen audit.
- Separate diagnostic after freezing that step: adding the existing `flush()`
  wait after release to the two lease-restoration tests and the two baseline
  failure variants yields **4/0, 51 skipped**, success true,
  `/tmp/tanstack-controller-release-timing-probe.json`. No runtime changed.
  Reverted the three temporary await insertions and verified a clean worktree
  before this record edit. This suggests stale synchronous timing assumptions,
  not a repair or proof of every intermediate snapshot. Keep the four entries
  open at that checkpoint; their settled-state assertions are now updated below.

### Controller settled-window contract

- Closed the seven named controller assertions without restoring private-graph
  rollback machinery. Four release/restoration tests now prove the intended
  `setWindow` call, await that exact returned settlement, and check both the
  reported window and its selected row fields. They do not call preload or
  issue another request to make restoration happen. A polling draft reached
  automatic `gcTime: 1` cleanup after the last listener left; exact settlement
  avoids confusing later cleanup with restoration failure.
- The graph-throw test no longer demands a second private operator mutation
  and a second rollback throw. That behavior was deliberately removed by the
  retained-public-snapshot design. It preserves exact original-error identity,
  proves the settled window and full prior rows survive, and exercises an
  ordinary successful retry to the larger window. Retry/restoration row checks
  compare selected `id`/`n` fields; they are not metadata-surface assertions.
- The real-source reset test now crosses success/rejection while source work
  still gates publication. It arms the deferred request only after preload,
  checks acquisition reach, proves reset remains pending and old rows remain
  visible, then checks both outcomes. Failure preserves exact error identity
  for reset and expansion; explicit reset retry succeeds and later expansion
  still works. The fixture evaluates predicates/cursor branches independently,
  honors limits/offset, and awaits commit receipts instead of treating every
  predicate as an empty result. The existing mocked reset-generation test
  remains, now labeled as controller-only rather than a source-barrier proof.
- One runtime defect: an overlapping preload treated `getWindow()`'s settled
  limit as current desired state, overwrote its larger pending lease with the
  smaller committed page count, and started a second window request. The
  coordinator now returns its existing pending promise for a matching lease.
  No new stored state. Runtime diff **7 added / 7 removed**, including one
  removed blank line; substantive code/comment delta is +1 line.
- Expanded that preload witness across resolve/reject at the controller's
  `setWindow` boundary. Both calls are observed before assertions; assert one
  window request and an unfinished preload, then same failure or success,
  committed page count, retry after failure, final IDs, and settled window.
  This controlled promise wrapper tests coordinator behavior, not adapter
  transaction/publication atomicity; real-source reset cases cover that
  separate boundary. Architecture states pending-lease joins and async release.
- Report sequence (all full controller files, no skips):
  - `/tmp/tanstack-controller-contract-red.json`: **48/8**, success false.
    Five additional stops came from draft full-object row comparisons or
    polling past GC, not five new runtime defects.
  - `/tmp/tanstack-controller-aligned-red.json`: **53/3**, success false.
    Only two preload witnesses and the old reset-success expectation remain.
  - `/tmp/tanstack-controller-pending-green.json`: **55/1**, success false.
    Preload fix passes both cases; old reset expectation remains.
  - `/tmp/tanstack-controller-contract-final.json`: **57/0**, success true.
  - `/tmp/tanstack-controller-final-old-runtime.json`: **55/2**, success false.
    Final tests with the controller runtime exactly at `74ba989c` (empty diff
    verified) fail only at the two preload request-count assertions. These
    reds do not reach the subsequent pending-state assertion or the
    settlement/retry suffixes. All other updated contracts
    pass without a runtime change. Restored the fix; no ablation remains.
- Final twelve-suite run, seed override 1657011: **940/0**, no skips, success
  true, `/tmp/tanstack-controller-final-census.json`. Bounded **601/0**, adjacent
  **339/0**, with controller **57/0** and pagination **136/0**. Prettier and diff
  check pass; no full lint/typecheck, final 100×, or universal-correctness claim.
  No push.
- Field Lab loss audit of `f2c7af87` recovered one compressed reach limit: the
  two old-runtime preload reds stop at the request-count assertion before
  `preloadSettled === false`, not only before settlement/retry. Corrected that
  record above. All six reports, contract-change labels, runtime delta, and
  preserved assertions otherwise match the frozen step. Reused auditor due
  thread limit; prior framing and source-first order may hide omissions. No
  auditor tests or runtime endorsement. Reports do not prove commands,
  ablation/restoration, formatting, or multipliers. This record correction
  follows the frozen audit.
- Next-step baseline only: the two existing `outer fn.select` regressions pass
  **2/0, 26 skipped**, success true,
  `/tmp/tanstack-functional-projection-existing-baseline.json`. This is not the
  complete includes suite or a completed projection matrix. Preserve both
  regressions when generalizing. The bare-union case filters null/undefined
  callback values before checking facade shape, and checks facade contents
  after preload rather than readiness at callback entry. The next matrix must
  distinguish a valid branch without an include from a premature placeholder,
  and observe callback-time values directly rather than discard those samples.

### Functional-projection boundary baseline

- [x] Added `includes-functional-projection-oracle.test.ts` to `test:oracles`,
  leaving all existing includes tests intact. The deterministic product crosses
  QueryRef / recursive QueryRef / union × Collection / array / materialized ×
  expression / functional-record / functional-opaque-root × empty / populated.
  Each of its 54 named cells runs initial, child-update, and parent-route-move
  checkpoints. A declaration census checks cardinality and unique cell names;
  a separate no-include control checks opaque-root selected fields.
- The independent model owns authoritative parent group and child rows. Public
  rows must equal that group's contents at each checkpoint. Collection handles
  remain identical on child-only changes and change on a route move. Inline
  derived scalars must update with their contents. For Collection-valued
  includes, scalar reads are checked when the parent projection runs (initial
  and route move), not treated as dependency-tracked child-only computations.
  This does not add implicit dependency tracking to live Collection handles.
- Callback observations retain their phase and branch identity. Capture value
  shape, readiness, and selected child fields inside the callback, rather than
  dereference a retained facade after preload. Never filter away nullish
  callbacks for a branch that declares an include. A union branch without an
  include is a separate valid-absence control. Soft assertions retain later
  checkpoints; these runs had assertion mismatches rather than thrown query
  errors. Callback rows are captured, but are not independently asserted equal
  to full source truth on every internal invocation. Final public rows and
  derived values have that independent comparison.
- All **18 expression-projection controls pass** through all three phases.
  All **36 functional cells fail**, with overlapping families, not 36 bugs:
  1. [ ] Premature callbacks see placeholders instead of the declared include
     form. Even the union/record cases whose public rows pass expose this.
  2. [ ] Concrete Collection facades can still be unready when the callback
     reads them. The union/Collection/record trace distinguishes an actual
     facade with `ready: false` from a non-facade placeholder.
  3. [ ] Functional projection over QueryRef and recursive QueryRef sources
     loses materialized children and derived scalars; equivalent expression
     projections retain them. Do not repair only the already-covered union.
  4. [ ] Opaque functional root results lose rematerialization. Check selected
     fields and children, not a new guarantee about root prototypes. Existing
     nested opaque-wrapper regressions remain intact.
  5. [ ] Inline child updates must rerun functional projections. The frozen
     report has 20 zero-call reach failures: QueryRef / recursive QueryRef ×
     array / materialized × record / opaque-root × empty / populated (16),
     plus union × array / materialized × opaque-root × empty / populated (4).
     These overlap the value failures above; they are not 20 additional bugs.
- Controls corrected two assumptions before freezing the baseline. Explicitly
  selecting `children: undefined` produced null; an actually absent union field
  is the intended control. The intermediate report
  `/tmp/tanstack-functional-projection-with-controls.json` was **13/42**; removing
  that explicit field yields **19/36** in
  `/tmp/tanstack-functional-projection-baseline.json`. A separate no-include
  prototype probe was **0/1, 55 skipped**, success false,
  `/tmp/tanstack-functional-projection-opaque-control.json`: public root records
  already flatten class prototypes without includes. Removed the prototype
  preservation hypothesis from the product. The final field-only control does
  not require either preserving or flattening prototypes as a new contract.
- Frozen three-suite baseline:
  `/tmp/tanstack-functional-projection-frozen-baseline.json` **144/36**, no skips,
  success false: new matrix **20/36**, existing Collection oracle **28/0**, route
  context oracle **96/0**. The preceding
  `/tmp/tanstack-functional-projection-final-baseline.json` has the same counts,
  before removing a prototype-flattening assertion from the no-include control.
  Original matrix without expression controls was **1/36**,
  `/tmp/tanstack-functional-projection-matrix-red.json`. No expected-failure
  classifier, skipped red cell, runtime patch, or production-line growth.
- New-file ESLint passes; formatting/diff check pass. Full DB `tsc --noEmit`
  exits 2 with diagnostics in other existing test files, none in this new file
  (`/tmp/tanstack-projection-types.txt`). This is not a full typecheck pass.
- [x] Post-commit Field Lab loss audit of `8e3592ff` recovered family 5 above:
  compressing callback non-execution into wrong values had dropped an explicit
  reach law. It verified the report counts, exclusions, unchanged adjacent
  suites and absence of runtime edits. The auditor was reused, with prior
  framing and source-order contamination; it ran no tests and did not inspect
  the optional typecheck transcript. This is not fresh runtime endorsement.
- Scope limit: opaque roots here are callback outputs. Opaque callback input
  roots and chained functional selectors are not a declared product dimension.
  Do not claim those covered or infer a defect without a bounded witness.
- Withdrawn candidate `159d7c73` retained QueryRef include input paths when the
  projection is functional, and attaches the existing projection state for all
  compiled includes, including opaque root results. No new state or registry;
  compiler diff is 12 added / 12 removed lines including two import-order lint
  corrections. Earlier commentary's minus-two estimate omitted the wider root
  condition; the measured net production change is zero.
  `/tmp/tanstack-projection-source-state.json` remains **144/36**, success false,
  but every public-form, content, scalar, identity and callback-reach assertion
  passed on that candidate. The remaining failures were early placeholder and unready
  facade observations (families 1–2). Families 3–5 passed only in that bounded
  product, not in all functional consumers; their checkmarks are now reopened.
  No test assertions were removed or weakened.
- Wider adjacent validation: `/tmp/tanstack-projection-source-adjacent.json`
  **342/0**, no skips, success true, across nine includes/facade suites. This
  includes existing callback-result rejection and facade rollback tests, but
  does not prove all possible functional consumers. Compiler ESLint and
  Prettier check pass after correcting the existing import order.
- Lifecycle checkpoint rerun: `/tmp/tanstack-projection-source-lifecycle.json`
  **940/0**, no skips, success true, the same twelve-suite census with
  `TANSTACK_DB_ORACLE_SEED=1657011`. This is not the final 100× campaign or a
  full DB typecheck pass.
- [x] Post-commit Field Lab loss audit of `159d7c73` recovered a distribution
  change hidden by the unchanged 144/36 count: real unready facades became
  visible in all twelve Collection-valued functional cells, versus two before.
  This was newly reached behavior, not ten additional defects. The reused
  source-first auditor verified unchanged tests, counts and net compiler lines;
  prior framing/order can hide omissions. It ran no tests and gave no broader
  consumer-compatibility endorsement.
- [x] Compatibility control caught a regression in that candidate: a QueryRef
  functional projection which drops its include and returns `row.id`, consumed
  by a further QueryRef, returned `{ row: { children: [...] } }` instead of 1.
  `/tmp/tanstack-projection-scalar-control.json`: **0/1, 56 skipped**, success
  false on the candidate. Restoring the prior three compiler hunks gives
  `/tmp/tanstack-projection-scalar-old-runtime.json`: **1/0, 56 skipped**, success
  true. Keep the control and withdraw the semantic patch rather than add a
  scalar-only workaround. Import-order lint corrections remain. This raises the
  oracle to 57 functions, not the original 56; its 54-cell product is unchanged.
- Restored-runtime validation: `/tmp/tanstack-projection-withdrawn-baseline.json`
  **363/36**, no skips, success false: new projection suite **21/36**, the nine
  unchanged adjacent suites **342/0**. Relative to `cbea7f15`, the only compiler
  changes left are two import moves, **2 added / 2 removed** lines. No semantic
  runtime change or production growth remains. Compiler/new-suite ESLint and
  Prettier checks pass; full DB typecheck and final multiplier remain open.
- [x] Post-commit Field Lab loss audit of `ca26b6a2` found no supported omission
  in the withdrawal record. It verified candidate/restored report counts,
  focused skips versus full-suite results, reopened assertion families and the
  import-only net compiler diff. The scalar control proves initial numeric
  output only; updates, atomic outputs and further compositions remain queued.
  This was a reused source-first auditor, with framing/order contamination;
  it ran no tests and did not independently verify commands or broader runtime
  compatibility. No runtime endorsement is inferred from the audit.
- Next implementation plan, replacing the withdrawn shortcut:
  1. Define the projection boundary as materialized input → callback → arbitrary
     output. Keep source include paths on the input side; never infer output
     paths for an opaque function. Existing QueryRef/union adapters consume the
     projected relation, not a placeholder to repair after projection.
  2. Before editing runtime, extend the compatibility controls to renamed and
     dropped include fields, scalar/atomic results, and a chained selector.
     Cross relevant forms, retain update phases and callback-time observations.
     Add custom-key and downstream order/distinct controls where the builder
     accepts those compositions. Reject unsupported plans explicitly only when
     that is their established contract, not to hide a new regression.
  3. Place inline projection after input materialization in the existing graph.
     Resolve Collection inputs at the existing coherent facade boundary; prove
     key/order/downstream consumers see the actual output before moving calls.
     Preserve multi-field completeness, rollback and callback error identity.
     Do not add a second result registry or a parallel dependency tracker.
  4. Require both the original product and compatibility controls to improve,
     then rerun includes/facade and lifecycle contracts. Commit the bounded step
     and run its loss audit; do not keep a candidate that regresses a control.
- [ ] Callback timing repair must account for custom public keys, downstream
  selectors/order/distinct, multiple include fields and nested facade readiness.
  A placeholder record cannot stand in for the callback's output at those
  boundaries. Do not move invocation later solely to green the current matrix.

### Projection compatibility specification

- [x] Expanded the oracle before another runtime patch. All original 57 tests
  remain; the new products add 91 functions, for **148** total:
  - Output preservation: Collection / array / materialized × expression /
    functional consumer × number / null / Date / dropped-record × include /
    matched no-include control = **48/0**. Includes are deliberately not read
    in this product. Check initial output, a child insert, parent value change
    and parent removal. The second functional callback checks incoming shape
    during insertion/retraction; final values are checked against the chosen
    parent value. The matched no-include form variants repeat the same query
    semantics, not three distinct no-include mechanisms.
  - Renamed nested fields: three forms × expression / functional projection ×
    expression / functional consumer × one / two correlated inputs = **6/18**.
    Expression-only controls pass. Observe each callback stage separately for
    reach, input form and facade readiness, with initial, primary-child update,
    sibling-child update when present, and parent-route move checkpoints. The
    independent child-row map checks both public inputs and derived totals.
    As before, live Collection reads do not imply child-only scalar dependency
    tracking; inline forms do. Per-invocation rows are captured, not compared
    with complete authoritative state during every intermediate invocation.
  - Consumer operators: three forms × stable custom key / selected-value
    top-1 order / distinct × reads / ignores include = **9/9**. The nine cases
    ignoring includes pass. A two-parent fixture changes the winning ordered
    row for inline child updates, merges distinct values on a parent move, and
    removes one parent. Exact public keys are checked for the custom-key form.
    This covers operators after a QueryRef functional projection, not all
    operators at every nested or union boundary.
  - One declaration census checks product cardinality and unique case names.
- Final report `/tmp/tanstack-projection-compatibility-final.json` is **232/63**,
  no skips, success false: projection **85/63**, existing Collection oracle
  **28/0**, context transport **96/0**, facade adapter **5/0**, and functional
  variants **18/0**. The old projection product remains **21/36** including its
  three controls; newly added cases account for **64/27**. These are overlapping
  test combinations, not additional distinct-defect counts. No runtime changes.
- Controls corrected before freezing this specification:
  - Draft sibling query used a constant filter, which is not a correlated
    include. Six cases stopped at compiler validation. The sibling now uses
    `parent.siblingGroup`; those cases reach callback/publication assertions.
    Draft `/tmp/tanstack-projection-compatibility-draft.json`: **70/48**, with
    six validation errors. Corrected
    `/tmp/tanstack-projection-compatibility-correlated.json`: **70/48**, with
    assertion failures instead. Added expression controls/stage-specific reach
    and sibling updates yield
    `/tmp/tanstack-projection-compatibility-controls.json`: **76/54**.
  - The first custom-key probe changed the key when the score changed. Its
    three include-ignoring cells also failed, so it did not isolate projection
    ordering. `/tmp/tanstack-projection-consumer-boundary.json`: **82/66**.
    The frozen product uses `result:${row.id}`, a stable key read from actual
    callback output. Whether mutable public keys are supported is unclassified;
    this is not a refutation or fix of that separate behavior. Keep the draft
    report for a later contract check rather than declaring it resolved.
- New-suite ESLint/Prettier checks pass. Full DB typecheck still exits 2 with
  errors outside this file (`/tmp/tanstack-projection-consumer-types.txt`);
  no new-suite diagnostics were printed. Not a full typecheck pass. The final
  100× campaign and broader output shapes remain open.
- [x] Post-commit Field Lab loss audit of `5d3f1c0e` found no supported omission
  or overclaim in this specification. It checked all five report distributions,
  the changed controls, retained original functions and absence of runtime
  edits. The auditor was reused and source-first; prior framing and reading
  order can hide omissions. It ran no tests and did not read the optional
  typecheck transcript. This is not fresh runtime endorsement.
- [ ] Before declaring projection complete, include opaque wrapper inputs and
  nested facade readiness/error rollback in the final integration check. Date
  input preservation and the existing opaque output cases do not prove those
  whole products. First implement against the now-declared controls; expand
  only where the changed boundary actually introduces a new interaction.
- [ ] Check mutable public-key behavior separately before classifying the
  discarded diagnostic. Do not grow this projection repair around it.
- [ ] Finish the shared projection boundary (inline step completed below):
  preserve source-row state through all declared source forms, run callbacks
  only once their include inputs have the promised form, and reuse the existing
  projection-state/publication machinery. Check all cells after each coherent
  change rather than adding a separate workaround per source/form. Preserve
  callback failure handling and nested opaque values in the adjacent suites.
  Keep production growth bounded; do not introduce another result registry or
  a new reactive dependency tracker for scalar reads of a live facade.
- [ ] Rerun the projection matrix plus the completed lifecycle checkpoint and
  then the wider includes oracles before calling this boundary complete.
- [ ] Clear the full DB test typecheck diagnostics before PR handoff.
- [ ] Ask multiple fresh reviewers for final coherence, hostile-assay, and
      loss-audit passes.
- [ ] Update RFC/PR text and changeset to match the final design.

### Inline projection input repair

- [x] Materialize purely inline input subtrees before the functional callback
  using the existing D2 materializer. Consume their include paths at that input
  boundary, not on the callback's arbitrary output. Actual output then reaches
  custom public keys, distinct, selected ordering, and downstream QueryRefs.
  The recursive guard excludes any subtree containing a Collection-valued
  include. No custom result registry or facade scalar-dependency tracker added.
- [x] Keep callback validation in one compiler-owned wrapper, reused by initial
  and deferred invocation. This removes the materializer's runtime import of
  the compiler, avoiding a cycle when the compiler invokes the materializer.
  The existing deferred-return validation regression remains green.
- [x] Preserve every projection assertion from `178dc461`. Final report
  `/tmp/tanstack-projection-inline-typed.json`: **497/21**, no skips, success
  false. Projection is **127/21**, versus the specification's **85/63**:
  all 42 inline red cells are repaired; all remaining 21 reds are
  Collection-valued. The other eleven includes/facade/functional suites are
  **370/0**. Seed override: `1657011`. This is a bounded matrix result, not
  proof for all callback shapes or 42 distinct bugs.
- [x] Add on-demand expression/functional × array/materialized controls. They
  observe the actual correlated child request, hold its completion, check that
  preload remains pending, and compare published rows after applied commit.
  Disabling only the new inline guard gives **2/2**, with both functional forms
  red and expression controls green; restoring it gives **4/0**. Reports:
  `/tmp/tanstack-projection-inline-demand-red.json` and
  `/tmp/tanstack-projection-inline-demand-green.json` (17 nonselected tests in
  each focused run). The red sees wrong callback input and missing published
  contents; the hard contents assertion stops before the final count assertion.
  These focused reports precede the final type-only observation annotation;
  the final twelve-suite run includes all four controls. The fixture decodes
  request keys using the existing helper, but expected rows are independent
  literals, not the decoded request or engine output.
- [x] Rerun the twelve lifecycle suites after the final source/type edits:
  `/tmp/tanstack-projection-inline-lifecycle-final.json` is **940/0**, no skips,
  success true, seed `1657011`. Lint and formatting pass for changed TypeScript;
  DB build passes (`/tmp/tanstack-projection-inline-build.txt`). Full DB
  typecheck exits 2 with other test diagnostics, none in the three changed
  TypeScript files (`/tmp/tanstack-projection-inline-final-types-v2.txt`).
  This is not a full typecheck pass. Earlier candidate typing errors were
  corrected before freezing this step.
- Production delta versus `178dc461`: compiler **78 added / 19 removed**;
  materializer **1 added / 2 removed** = **+58 net lines**. The intermediate
  +53 count preceded explicit symbol-routing typing. No bundle-size delta is
  claimed. Inline input materialization still does D2 work if the callback
  later drops the value; no-includes queries keep their existing pipeline.
- [x] Post-commit Field Lab loss audit of `bac6a6af` versus `178dc461` found
  no supported omission or overclaim. It checked source before reports and
  reduction: all 148 projection names remain, with 21 array and 21 materialized
  cells repaired and no newly failing cells; validation ownership, recursive
  exclusions, hard-assertion stopping point, and the +58 line delta are retained.
  The auditor was reused, not fresh or sibling-blind; prior framing and the
  source-first order may hide omissions. It ran no tests and did not inspect
  optional build/type transcripts. JSON alone does not prove seed environment,
  exact ablation/restoration, formatting, commands, or multipliers. Those come
  from the execution record above, not this audit. This is source-to-summary
  preservation evidence, not fresh runtime endorsement.
- [ ] Repair the remaining Collection-valued boundary separately. Do not
  infer scalar dependency tracking from a live facade or claim the inline
  guard fixes mixed subtrees. Functional WHERE consuming includes, opaque
  wrapper inputs, and nested facade readiness/error rollback are not newly
  proven by this step. Keep the earlier mutable-key diagnostic unclassified.
- [ ] Full 100× campaign, broad integration, and final coherence review remain
  queued after the boundary work; this checkpoint does not close them.

### Collection-valued projection boundary investigation

- [x] Add two controls with a separately created, preloaded source query that
  exposes a real child Collection. A second query either reads its row count
  or uses a constant, then applies distinct. Both check initial projection,
  child insertion without scalar recomputation, parent removal, and parent
  restoration. Between removal and restoration they remove a child, without a
  separate child-removal assertion. Only the facade-reading variant checks the
  restored count; the constant variant cannot detect wrong child contents.
  Both pass without any production change. These
  controls prove that public result trace, not internal retraction identity or
  all independently materialized query compositions.
- The initial concern that rereading a changed facade necessarily breaks
  retraction was not reproduced. Temporary callback logging observed counts
  1, 0, 1 in the facade-reading trace, but public removal and restoration still
  passed. The logging was removed. Do not add a result cache or claim a new
  retraction bug from this concern alone. Draft report named
  `/tmp/tanstack-public-facade-retraction-red.json` actually has **2/0**, with
  148 skipped tests; its filename is not a red result. That draft stopped at
  removal. The restoration suffix also passes in
  `/tmp/tanstack-public-facade-retraction-restore.json` (**2/0**, 148 skipped).
- Final `/tmp/tanstack-projection-public-boundary-controls.json`: **276/21**,
  no skips, success false. Projection **129/21**; Collection oracle **28/0**,
  context transport **96/0**, facade adapter **5/0**, functional variants
  **18/0**. Seed override `1657011`; all previous projection assertions remain.
  Changed-test lint and formatting pass. No production repair is claimed.
  Full DB typecheck still exits 2 with diagnostics outside the changed test;
  `/tmp/tanstack-projection-public-boundary-types.txt` prints none for it.
- [ ] Design decision before widening implementation: the same-query Collection
  callback needs usable public facades, while its output must reach downstream
  D2 operators before publication. Current resolution occurs after those
  operators, and merely moving prepare before resolve does not fix that order.
  A staged facade-to-D2 boundary must preserve private ordered/replay work,
  rollback, nested callbacks, and child-only facade updates without inventing
  scalar dependency tracking. Its cost and correctness have not been measured
  in an implementation. Alternatively, reject Collection-valued same-query
  inputs to fn.select and require inline inputs or an already-published source
  query. That narrows the API, including callbacks that ignore the include;
  it needs explicit user approval. No staged runtime or new rejection added.
- [x] Post-commit Field Lab loss audit of `15c55168` recovered one compressed
  assertion distinction: child removal is an action between checkpoints, not
  a separate assertion, and the constant control cannot check restored child
  count. Corrected above. Other source/report/count/scope traces match the
  reduction. The auditor used prior context and scanned sources sequentially
  before the reduction, not sibling-blind; that order may hide omissions. It
  ran no tests and did not inspect the optional type transcript. Reports alone
  do not prove draft source suffixes, removed logging, command environment,
  lint, or formatting. This audit is not runtime endorsement.

### Cheap facade snapshot spike: isolation gate failed

- [x] Try the user-approved shallow row-copy approach. Full record and
  replayable candidate: `notes/facade-snapshot-spike.md` and `.patch`.
  Staging Collection inputs in the same D2 graph plus retaining callback
  outputs with D2 reduce makes all **150 original projection tests pass**.
  The eleven adjacent suites also pass **370/0**.
- [x] Add the missing publication observation product before accepting the
  green projection result. Three probes check held row reads, held index
  reads, and reading a held public handle inside a failing callback. On the
  candidate they are **1 green / 2 red**: rows stay frozen, but the held index
  and callback-time public read expose private state. This is one route-change
  history, not proof of every failure/async publication path.
- [x] Withdraw the unsafe production wiring without deleting its evidence or
  the new tests. Production is byte-identical to `fd06c647`; the patch is
  archived. The expanded executable projection oracle is **129/24**, no skips.
  Its three added baseline reds fail at initial preload (null input), before
  reaching the candidate's isolation checkpoints. Do not report the 150/0
  candidate result as a landed repair or these cells as three new bugs.
- [x] Measure the complete candidate: **+179 net production lines**, including
  two new modules. No old deferred path removed, no bundle/memory benchmark.
  The pre-spike branch remains **+3,095 net executable source lines** against
  origin/main `68366eca`, not below main. Final test lint/format passes; the
  candidate package type check and source lint are not claimed green.
- [x] Before implementing another candidate, define a separate draft input
  view that leaves public facade state and indexes untouched. Pin retained
  handle identity and opaque callback-output behavior first. No new API ban
  or global coordination layer is approved by this experiment. Follow-up
  trial is recorded below; hidden-handle identity remains an open decision.
- [ ] Only after this isolation gate passes, run async/cleanup/nested boundary
  probes, the lifecycle census, and the queued 100x campaign; then measure
  whether old machinery can be deleted rather than layered over.
- [x] Post-commit Field Lab loss audit of `9a215be4` recovered a stale current
  dashboard: it still said 129/21 while the appended checkpoint correctly said
  129/24. Updated the dashboard and its control count. Dropping rule:
  append-only recording left an earlier current summary stale. Source and
  report traces otherwise match: all 150 prior names/assertions remain,
  the two candidate isolation failures reach their surface assertions, and
  the three new baseline failures stop earlier at preload. Production diff
  from `fd06c647` is empty; the candidate patch is +179 lines.
  This was a reused, sequential source-first auditor with prior framing, not
  sibling-blind. It reran no tests and did not inspect optional type/lint or
  historical size evidence. Omission-focused reading can overemphasize details;
  its count reconciliation is not runtime endorsement.
- Root-agent post-freeze checks: archived patch applies cleanly; worktree was
  clean at the checkpoint; source count against `68366eca` is still
  5,119 added / 2,024 removed across 48 executable source files. Final restored
  TypeScript exits 2, with no diagnostic for the expanded projection oracle
  (`/tmp/tanstack-facade-snapshot-restored-types.txt`). No full type pass claimed.

### Separate draft input view: hidden-handle contract gate

- [x] Try the approved separate-view candidate. Record and replayable source:
  `notes/facade-draft-view-spike.md` and `.patch`. It fixes the first spike's
  row/index/callback isolation probes without changing public Collection state
  during projection. All **153 prior tests pass** on the final candidate.
- [x] Pin a missing generator dimension: a non-correlating parent update while
  another parent shares the same route. Cross expression selection and plain,
  class, and exact-handle closure outputs. Include later child insertion to
  separate live contents from object identity. Final candidate **155/2**;
  the class and closure holders alone lose updated-parent `===` identity.
  Both still show correct live rows. No old assertions removed or classifiers
  broadened. Adjacent eleven suites **370/0**.
- [x] Preserve the production candidate as a patch and restore the prior
  production baseline. Expanded executable oracle is **130/27**, no skips.
  The added expression control passes; the three new functional controls stop
  on null child input before reaching identity assertions. They are not three
  newly confirmed baseline runtime defects. Production size increase retained:
  **zero**. Candidate cost: **+227 net source lines**, old machinery still
  present. No bundle, memory, or performance improvement proved.
- [x] User chose live views: identity between separate functional projection
  calls is unnecessary. Full draft API/lifecycle checks remain required; this
  choice does not make the prototype production-ready. Implementation below.
- [x] Post-commit Field Lab loss audit of `05a2827f` found no supported
  omission or overclaim. It checked all six reports, the source patch and
  added tests, then the frozen reduction/dashboard. All 153 prior assertions
  remain; the identity failures reach their intended assertions and still run
  the later live-row checks. The three new baseline functional failures stop
  earlier. Production diff is empty and candidate cost is +227 lines.
  This reused, source-first auditor was not sibling-blind and carried prior
  framing, which may hide omissions. It ran no tests and did not check the
  optional type transcript; reports do not establish intermediate source
  versions, command environment, lint or formatting. This is not runtime
  endorsement or approval to weaken handle identity.
- Root-agent post-freeze checks: clean checkpoint worktree, empty production
  diff, archived patch applies cleanly, final test ESLint passes. Restored
  package tsc exits 2 with no changed-oracle diagnostic in
  `/tmp/tanstack-facade-draft-view-restored-types.txt`; no full type pass.

### Slim replacement after the live-view decision

- [x] Implement the user's accepted cross-call identity contract. Remove the
  view-to-public conversion and all `FN_SELECT_STATE` deferred callbacks;
  materialize inputs before the callback in the same D2 graph. Details and
  limits: `notes/facade-slim-replacement.md`.
- [x] Preserve every prior test and all data/isolation assertions. Only the
  updated-parent identity assertion for functional calls is relaxed. Add the
  captured-method dimension to the failure-isolation product: candidate
  **157/1** red becomes **158/0** after dropping the draft reader on promotion
  and forwarding captured methods to the live public Collection.
- [x] Run the same revised oracle against baseline production: **130/28**.
  Reinstall the saved slim candidate. Rerun eleven adjacent suites **370/0**
  and twelve lifecycle suites **940/0**, no skips. Baseline null-input reds
  do not prove later isolation failures; the candidate red reaches that phase.
- [x] Measure all six source files, including the new module: **+119 net**,
  108 less than the prior +227 candidate. Whole branch **+3,214 net** against
  `68366eca`, still above main. No bundle/memory/performance claim.
- [x] Commit the bounded replacement as `8a89139c`, then run the standing
  Field Lab loss audit. It recovered a stale architecture introduction that
  still called the suite red; local boundary/table updates had missed that
  opening warning. Corrected it without closing the unproved gates. All six
  source diffs, assertion-preservation, red/green reach, six reports, and size
  traces match the reduction. This reused, sequential source-first auditor
  was not fresh or sibling-blind; prior framing may hide omissions. It ran
  no tests and did not inspect optional types or the post-freeze rerun. The
  audit does not establish merge readiness. Root-agent committed rerun is
  **158/0**, no skips (`/tmp/tanstack-facade-slim-committed.json`).
- [ ] Complete draft API parity and async/failure/cleanup gates listed in the
  note before claiming the Collection view complete. The green broad census
  is not targeted coverage of every new continuation transition.
- [ ] Then run the queued 100x campaign and size/refactoring pass.

### Draft read-API product: helper receiver repaired, index gate open

- [x] Add 13 read surfaces × unordered/descending order, each checking initial
  callback output, a route move, and a retained view after child insertion.
  The retained-view suffix always reads toArray; it does not repeat the
  selected API after publication. Descending expectations apply to traversal
  surfaces; get, has, and index lookup follow explicit requested-key order,
  and size expects a count of two.
  Surfaces: toArray, get, has, size, keys, values, entries, iterator, forEach,
  map, state, $key, and newly created index lookup. Expected keys/order come
  from the fixture, not another Collection method. This verifies $key only,
  not all virtual properties or arbitrary key types.
- [x] Red run against `531ee32f`: **174/10**. Iterator, forEach, map, state,
  and index creation each fail in both order modes. Existing tests mostly
  read toArray and direct methods; they omitted helpers that call other
  Collection methods through their receiver.
- [x] Change getter and method receivers from the public Collection to the
  temporary view. Existing helpers now consume its staged entries rather
  than an old public snapshot. No new helper implementations or private
  index state: **2 source lines added / 2 removed**, net zero. Result
  **182/2**. All 158 earlier tests remain unchanged and passing. Both index
  cells stay directly red; nothing is skipped or expected-failure classified.
- [x] Rerun eleven adjacent suites: **370/0**. Reports:
  `/tmp/tanstack-facade-api-{red,v1,adjacent}.json`; no skips. Targeted source
  and test ESLint/Prettier pass after renaming a shadowed test local. Package
  tsc exits 2 with no changed-file diagnostics in
  `/tmp/tanstack-facade-api-types.txt`; no full type pass claimed. Twelve-suite
  lifecycle **940/0** remains the preceding step's result, not a fresh rerun.
- [x] Commit as `cf11720e` and run the standing Field Lab loss audit. It
  recovered the retained-read and order-expectation distinctions above;
  compressing the 26 cases into one product had hidden their different
  assertion scopes. Other preservation, reach, reports, source size, and
  open-contract traces match. Reused, sequential source-first context was
  not fresh or sibling-blind; prior framing may hide omissions. Auditor ran
  no tests and did not inspect optional types or post-freeze rerun. This is
  not merge-readiness evidence. Root committed rerun is **182/2**, no skips,
  in `/tmp/tanstack-facade-api-committed.json`.
- [x] Decide draft-time index creation before implementing more machinery.
  Its manager belongs to the public Collection, so immediate lookup during
  the callback sees the old snapshot (empty in these activation cases).
  Private index creation with failure cleanup versus a clear rejection of
  createIndex inside a projection was a design choice. User approved the clear
  rejection; implementation and red/green below. Public indexes retain their
  existing adjacent/isolation coverage; these failures do not refute it.
- [ ] Subscription creation, other virtual properties, async publication,
  cleanup/retry, and remaining gates in `notes/facade-slim-replacement.md`
  remain queued. These API cells add no async/cleanup reach. Whole-branch
  source remains **+3,214** against `68366eca` (+119 for the slim replacement),
  with no current bundle/performance claim and no 100x campaign yet.
- [x] Extend post-publication checks to repeat the selected read API, not
  only toArray. All 26 cells pass the retained-read checkpoints below.

### Approved narrow index guard

- [x] User chose “Yes clear error”: reject createIndex on a temporary
  Collection input, but permit it on the published child Collection. Do not
  create or maintain private index state.
- [x] Revise the two order-mode index cells to require the exact error and
  zero created indexes during initial and moved callbacks. Keep their input
  row and later live-view assertions using ordinary reads. The method captured
  during the moved callback then creates a working index after publication,
  checking destination keys 20/21 and later inserted child 22. The initial
  callback's capture is replaced and is not independently invoked afterward.
- [x] Add initial/update uncaught-error cases. Preload rejects with the exact
  error and publishes no root row; a later parent update throws that error
  while preserving the original public row and its existing child index.
  Red **182/4** becomes green **186/0**. The baseline four failures specifically
  show missing rejection, not a failure of the allowed post-publication path.
  Reports: `/tmp/tanstack-facade-index-guard-{red,green}.json`, no skips.
- [x] Implement invocation-time guard: **8 source lines added / 2 removed**,
  net **+6**. Merely capturing createIndex remains legal, and promotion turns
  off the guard. Total slim replacement is now +125; full branch +3,220
  against `68366eca`. No new index cache, ownership, or rollback state.
- [x] Eleven adjacent suites pass **370/0**, no skips, with fixed seed
  `1657011` (`/tmp/tanstack-facade-index-guard-adjacent.json`). Targeted ESLint
  and Prettier pass. Package tsc still exits 2, with no changed-file diagnostic
  in `/tmp/tanstack-facade-index-guard-types.txt`; no full type pass claimed.
  The 940/0 lifecycle checkpoint is historical, not rerun for this guard.
- [x] Commit as `e70145f3` and run standing Field Lab loss audit. It recovered
  the stale dashboard's combined index/subscription queue label and the
  initial-versus-moved captured-method distinction; both are corrected above.
  Dropping rules: stale shared-category text and phase compression. Source,
  preserved assertions, all three reports, and size traces otherwise match.
  Red cases stop on missing rejection before later suffixes; only green runs
  reach the zero-index, preserved-row, and published-index assertions. This
  reused, sequential source-first audit was not fresh or sibling-blind; prior
  framing may hide omissions. No test rerun, optional types or committed
  report inspection by the auditor. It does not establish merge readiness.
  Root-agent committed rerun is **186/0**, no skips, in
  `/tmp/tanstack-facade-index-guard-committed.json`.
- [ ] Async/cleanup, non-key virtual properties, subscription creation,
  and 100x campaign remain queued. Repeated API reads are checked below.

### Retained read API: publication, retirement, insert, delete

- [x] Reuse each selected reader in the 26 API cells after initial publication,
  old-route retirement, destination publication, child insertion, and child
  deletion. The retired view is also checked after the destination insert.
  Expected rows remain fixture-derived; traversal APIs check descending order,
  explicit-key APIs preserve probe order, and size checks cardinality.
- [x] Preserve both route readers rather than replacing the initial capture.
  The index method is bound once inside each callback, then used after its
  publication and retirement. Other methods are fetched through their retained
  view at read time; this is not a captured-method product for every API.
  Index cells create/look up an index at each read; they do not prove one
  specific index instance survives every checkpoint. Existing held-index tests
  remain separate controls. Old callback/input/isolation assertions stay.
- [x] All **186 tests pass**, no skips, without production changes. Reports:
  `/tmp/tanstack-facade-retained-api.json` (before moving the index-method
  binding outside the reader), and `...-final.json` (both captures checked).
  This strengthens green coverage; it found no new defect and is not a
  new red/green runtime repair. ESLint passes; package tsc exits 2 without
  changed-test diagnostics in `/tmp/tanstack-facade-retained-api-types.txt`.
  Source size stays +3,220 against `68366eca`; no adjacent/lifecycle rerun
  claimed for this test-only step, no new performance evidence.
- [x] Commit `a6ef1a19`, then run standing Field Lab loss audit. No supported
  omission or overclaim found: all prior assertions, both capture scopes,
  per-read index limitation, two186/0 reports, and empty production diff match
  the reduction. Reused, sequential source-first context was not fresh/blind;
  prior framing may steer attention. No tests or live implementation review;
  optional types not inspected. Reports do not prove commands/environment or
  intermediate source provenance. Subscription/failure/cleanup and async
  gates remain open; this audit is not merge-readiness evidence.

### Subscriptions: synchronous failure and graph restart

- [x] Add six cells: subscribe inside the functional callback versus after
  publication, crossed with success, callback throw, and facade prepare throw.
  Each includes initial snapshot/live insertion, a parent route move, explicit
  query cleanup, preload on the same query, and a fresh-graph child insertion.
  Compare subscriber-fed key sets to fixture truth, not the facade's own rows.
- [x] Inject flush failure after the real adapter flush and prepare. Assert
  the seam was reached, the exact error propagates, the prior root keeps its
  identity, and old subscribers receive no partial events. A subscription
  created during failed work receives no private rows. This is not a listener
  failure test: those errors use a different asynchronous delivery path.
- [x] Keep external subscriptions alive through cleanup/restart and release
  them explicitly in finally. Old views expose no new graph rows/events;
  restarted subscribers see the current source and later insert. Do not require
  automatic undo of user subscriptions or cleanup delete events.
- [x] Full suite **192/0**, no skips, without runtime changes. Initial report
  `...-red.json` was **190/2** because the two success cells omitted the move
  action. The targeted `...-probe.json` confirmed that setup mistake (four
  passed, two failed, other tests filtered). Corrected report:
  `/tmp/tanstack-facade-subscription-boundary-green.json`. These are stronger
  green checks, not a red/green production repair. ESLint passes. Initial tsc
  found an untyped spy receiver; after annotation, tsc still exits 2 but has
  no changed-test diagnostic in `...-types-final.txt`. No full type pass.
- [x] Commit `7f810911`, then run the standing Field Lab loss audit. It found
  two compressed assertion scopes: final empty subscription state did not
  exclude transient events, and toThrow(error) checked its message rather than
  identity. The next test step now checks the failed subscriber's entire
  flattened change history is empty and the caught object is the sentinel.
  All 200 tests still pass. Dropping rules were final-state/event-history and
  error-message/identity compression. Reused sequential source-first context
  was not fresh/blind; no runtime rerun or merge-readiness endorsement.
- [ ] Async demand settlement, nested continuations, remaining virtual props,
  copying/retention bounds, and 100x campaign remain open. No new production
  size, bundle/performance, adjacent, or broad lifecycle result is claimed.

### Pending child loads: settle, reject, cleanup, obsolete settlement

- [x] Add eight cells: expression control versus functional Collection-valued
  input, crossed with success, rejection, cleanup/late success, cleanup/late
  rejection. The source is truly on-demand and commits rows only after the
  controlled promise resolves. Initial preload is observed immediately on both
  outcomes and remains unsettled while the child request is pending.
- [x] Check the progressively published empty child view becomes live with
  child 10 on success, including the view captured inside the functional
  callback. Rejection preserves an empty view and rejects preload with the
  same error. Do not require a child update to rerun scalar projections.
- [x] Cleanup rejects the old preload with AbortError and aborts its request.
  Restart query and child source, settle the obsolete request while the new
  one is pending, then settle the new one. Old completion cannot ready the
  new query; retained old views stay empty while the current view fills.
  The fake adapter honors cancellation before writing. This is not a test
  of a misbehaving adapter writing stale rows after abort.
- [x] Full suite **200/0**, no skips, in
  `/tmp/tanstack-facade-async-boundary-{v1,final}.json`; final includes the two
  audit-recovered stronger failure assertions. No runtime changes or new bug.
  Package tsc exits 2 with no changed-test diagnostics in `...-types.txt`.
  ESLint passes after correcting import order; no full type pass claimed.
- [x] Commit `e00472e3`, then run standing Field Lab loss audit. No supported
  omission or overclaim found. Eight-cell reach, the two recovered assertion
  fixes, preserved tests, both reports, unchanged runtime and the cooperative
  adapter limitation match. Reused sequential source-first context was not
  fresh/blind; no test rerun, environment/lint/provenance verification, or
  merge-readiness endorsement. Nested, virtual, copying/retention and 100x
  remained open at this checkpoint.

### Two continuation stages and remote virtual properties

- [x] Add three two-stage cells. The first callback consumes children; a
  following projection retains that view and adds peers; the second callback
  reads both. Check callback order and fixture-derived input rows on initial
  publication and parent movement. Success retires both old views. A second
  callback failure or prepare failure after two stages preserves both old
  public views and root identity. Cleanup/preload rebuilds both current views.
- [x] The flush seam counts real prepare calls and throws after the second,
  not the first. Error identity and the two-call reach are asserted. This is
  a synchronous two-stage boundary, not nested async or an arbitrary-depth law.
- [x] Add unordered/descending remote-metadata cells to the existing retained
  reader product: `$collectionId` remains the upstream source ID, `$synced`
  is true and `$origin` is remote at callback/publication/insert/delete reads.
  Empty retired routes have no metadata values to check. No optimistic-metadata
  parity claim is made by these cells.
- [x] Projection suite **205/0**, no skips, in
  `/tmp/tanstack-facade-two-stage-v1.json`. No production change or new bug.
- [x] Fresh eleven adjacent suites **370/0** and twelve lifecycle suites
  **940/0**, no skips, fixed seed `1657011` in
  `/tmp/tanstack-facade-boundary-{adjacent,lifecycle}.json`. Test ESLint passes;
  package tsc exits 2 without changed-test diagnostics in
  `/tmp/tanstack-facade-two-stage-types.txt`; no full type pass claimed.
- [x] Commit `f0c55b5a`, then standing Field Lab loss audit. No supported
  omission or overclaim found: three two-stage and two remote-metadata cells,
  preserved assertions, exact failure and second-prepare reach, all three
  reports, unchanged runtime, type limits and remaining gates match. Reused
  sequential source-first context was not fresh/blind; no test rerun,
  seed/environment/provenance/lint verification or merge-readiness endorsement.
  Root committed rerun **205/0**, no skips, in
  `/tmp/tanstack-facade-boundary-committed.json`; Prettier check passes.
- [ ] Measure copying/retention bounds before the queued 100x campaign and
  size/refactoring pass. Whole branch remains above main; tests passing does
  not waive the size target or establish full API/performance parity.

### Draft snapshot work and retained state

- [x] Add four real-adapter counter cells: 10/100 rows × unordered/ordered.
  Repeated get/has/size and key traversal must copy at most one bucket, then a
  promoted view must expose a later inserted row. Baseline visits **520/50,200
  rows** (52/502 scans), not 10/100. All four work assertions red in
  `/tmp/tanstack-facade-read-work-red-final.json` (five earlier tests green).
  Initial `...-red.json` had bad unordered fixture order values, so those two
  cells stopped early; only the corrected report establishes all four reds.
- [x] Pass the already-resolved input snapshot into createDraftView instead
  of retaining a function that copies and sorts it on every property read.
  Promotion clears that snapshot; captured methods still follow live state.
  **7 source lines added / 7 removed**, net zero; whole branch remains +3,220
  against `68366eca`. No new cache registry, revision, or adapter closure.
  Four cells now scan once and visit 10/100 rows. Facade plus projection suites
  **214/0**, no skips, in `/tmp/tanstack-facade-read-work-green.json`.
- [x] Add manual `tests/facade-draft-retention.probe.ts` (not an automatic
  Vitest suite). Run with `node --expose-gc --import tsx` from packages/db.
  Eight cells: released/unreleased × held view/method × publish/rollback,
  ten samples each, after adapter cleanup. Released row wrappers: 0/40 retained;
  unreleased positive controls: 40/40 retained; adapters: 0/80 retained.
  WeakRefs target the row wrapper containing a1MiB buffer, not the buffer
  itself; this is not a retained-byte measurement.
  `/tmp/tanstack-facade-retention-final.json`, Node24.5.0. This measures forced-GC
  reachability of the direct adapter fixture, not live-query heap/GC latency,
  temporary peak allocation, wall time, or every closure in the application.
- [x] Earlier read tests checked data but not repeated-read work; each lookup
  silently recopied the bucket, giving quadratic traversal. These counter
  bounds cover that class rather than only one reported fixture.
- [x] Targeted ESLint/Prettier pass. Package tsc exits2 with no changed-source,
  test or probe diagnostic in `/tmp/tanstack-facade-work-types.txt`; no full
  type pass claimed. Manual probe reran after its final reachable-handle check.
- [x] Commit `6be078b8`, then standing Field Lab loss audit. It recovered the
  wrapper-versus-payload measurement distinction above; the compressed label
  did not establish buffer reachability or retained bytes. Counter reaches,
  report totals, preserved tests, runtime net-zero diff and declared remaining
  gates match. Reused sequential source-first context was not fresh/blind;
  no reruns, environment/restoration/provenance/lint verification or full
  implementation endorsement. This is not merge-readiness evidence.
- [ ] Full oracle command at multiplier1, fixed seed1657011: **1,349/6**, no
  skips, `/tmp/tanstack-facade-work-oracles.json`. Six retention failures also
  reproduce with the sole changed runtime file restored exactly to `cbeda0b6`
  (verified empty git diff): `/tmp/tanstack-retention-baseline.txt`.
  Candidate then restored. Five reports concern restart delete-event
  expectations; the optimistic failure display also contains an extra metadata
  update. That display is not independent timing evidence; classification and
  the superseding green expectation-alignment step are below.
- [ ] Then run the queued100x campaign and size/refactoring pass. No full-suite
  green, 100x completion, universal correctness or below-main size claim.

### Broad oracle gate: restart event expectations

- [x] The six failures reproduce with pre-snapshot production. Five witnesses
  stop where they expected an empty ready batch after restart; retained eager
  subscriptions now retract the old rows they delivered. This is the existing
  ARCHITECTURE eager-restart reconciliation contract, not a new policy.
- [x] Update the history model's restart batch to delete the trigger row.
  These subscriptions requested no initial state, so only that row was known
  to them. Keep fixture-derived rows, values, key and prior-value assertions.
  Update the optimistic witness to expect the same old-session deletion.
- [x] All12 retention tests pass, including the full optimistic confirmation
  trace, the parked receipt, its timeline and no-early-confirmation checks.
  The apparent extra metadata update in the failure display did not require a
  fix: the test's mutable publication array also changes in finally when a
  failed assertion releases the mutation. That timing explanation is an
  inference from the source, not a controlled reproduction of when the failure
  object acquired the batch. `/tmp/tanstack-retention-aligned.txt`.
- [x] Full oracle command now **1,355/0**, no skips, fixed seed1657011 at1x:
  `/tmp/tanstack-facade-work-oracles-green.json`. All prior assertions remain
  except the two explicit obsolete empty-batch expectations. No runtime edit.
  ESLint/Prettier pass; tsc exits2, no changed-test/source/probe diagnostics in
  `/tmp/tanstack-retention-aligned-types.txt`; no whole-package type pass.
- [x] Commit `93c3c2d0`, then standing Field Lab loss audit. It confirms only
  two empty-batch expectations changed, with generators, runtime, model and
  all other assertions preserved. Recovered limits: subscriber-known rows
  differ from all visible rows; baseline failures stopped before later state,
  receipt and rollback checks, now reached by green; metadata timing remains
  inferred; stale historical wording needed qualification. These are assertion
  scope/timing/history compression, not new bugs. Reused sequential source-first
  context was not fresh/blind; no reruns, environment/SHA/lint/type or100x
  verification and no merge-readiness endorsement.

### 100x campaign and next size target

- [x] Completed against runtime/test commit `93c3c2d0` with multiplier100,
  seed/path/property overrides unset: fixed structural corpora plus fresh
  random seeds. Full `pnpm test:oracles`, coverage off, per-test/hook timeout
  600000ms. Logs `/tmp/tanstack-minimal-oracles-100x.log`; final JSON
  `/tmp/tanstack-minimal-oracles-100x.json`. Exit1: **1,352 passed / 3 failed**,
  no skips, plus two worker `onTaskUpdate` reporting timeouts. Runtime and tests
  stayed frozen during the campaign. All three assertion failures reproduce
  independently without those worker errors. This is not a green campaign.
- [x] Remeasure the fixed main checkpoint `68366eca`:49 source files,
  5,301 added/2,081 removed = **+3,220 net**. Same baseline/scope as earlier;
  excludes Markdown and includes root-level source files, not only nested TS.
  The snapshot work fix adds zero net source lines. No bundle measurement yet.
- [ ] Main remaining size concentrations: subscription lifecycle/replay
  **+897**, ordered loader/utils **+486** (together1,383/3,220≈43% of net growth).
  Inspect those lifecycle responsibilities and duplication first during the
  queued coherence/refactoring pass. This inventory identifies where growth
  lives, not proof that the lines are removable or any contract can be dropped.

### 100x findings: publication model and pagination prefix

- [x] Pin both publication histories in the existing driver. Seed1657005,
  path1554:2:3:6:12:12:0:0: source row, request, truncate, abort, truncate,
  obsolete resolve, cleanup. Seed712591281, path881:35:4:4: independent source
  row arrives during replay; redundant restarts must not erase it. Both red
  in `/tmp/tanstack-100x-pinned-red.txt` with production unchanged.
- [x] Correct two model transitions only. A no-op restart cannot clear private
  replacement rows. A canceled-only authoritative reset can finish after older
  transports settle without starting a new successful acquisition; releasing
  all owners still retires the work. Existing cancellation, failed replacement,
  release, callback-batch, value and source-state assertions remain.
  Normal-scale publication suite **45/0**, including the 288-cell control
  function. No runtime change for these two failures.
- [x] Publication-only100x rerun: **44/1**, random seed712591281 passes;
  fixed1657005 reaches a later failure at run5997, path5996:33:6:14:5:8.
  `/tmp/tanstack-100x-publication-repaired.json`. The original two pinned
  histories pass. New trace: cleanup, request b, restart, private source d0,
  abort/release b, then source d4. Runtime emits update(d0→d4), model insert(d4):
  the subscriber never received d0. Full shrink includes no-op commands and is
  preserved in the JSON. Classification/repair queued; do not call100x green.
- [x] Pagination seed1658 shrank to rows1(rank0),2(rank1); insert3(rank1), move
  to offset1/limit1, no-op update1. Checkpoint2 shows row3 instead of row2.
  The generalized asc/desc × implicit/explicit key order × tied/distinct insert
  matrix is **4 red / 4 green** on baseline: implicit order fails even without
  ties. Preserve all eight cases, not just the original shrink.
- [x] Widen that product to limit1/2: **6 red / 10 green** on unchanged runtime,
  `/tmp/tanstack-pagination-prefix-16-red.json` (136 filtered tests). Distinct
  inserted ranks also leave an under-filled wider window, not only wrong ties.
- [x] Repair the ordered loader's false prefix proof. A filled graph window
  after a live insert does not establish a complete source prefix. An explicit
  window move must reacquire that prefix; do not add more retained cursor state.
  Reuse indexed page acquisition from zero on explicit moves, with count at
  least offset+limit. Ordinary refill can still continue by cursor. This adds
  **5 net source lines**, no state. Tradeoff: explicit moves may request a
  prefix again rather than only its tail; no blanket full-source recovery.
- [x] Pagination **152/0**; full1x oracle command **1,373/0**, fixed random seed
  1657011; fixed transition corpus at100x and replay1658 **2/0** (150 filtered).
  `/tmp/tanstack-pagination-prefix-152-green.json`,
  `/tmp/tanstack-prefix-repair-oracles-green.json`,
  `/tmp/tanstack-pagination-prefix-100x.json`. Not a fresh full100x campaign.
  The two failed-acquisition replay tests retain release identity, rejection,
  row and no-extra-request assertions, but now assert the actual prefix request
  (offset0/limit4) instead of identifying it by a cursor. They no longer claim
  that an explicit move enters the cursor path. Existing ordered lifecycle and
  pending-cursor suites remain. Two preexisting prefer-const findings in these
  fixtures were corrected; scoped ESLint and Prettier pass.
- [x] Loss audit for `ec2ec796` recovered the later failure's exact stopping
  point (source d4; suffix not reached), no-op settlements of absent b are not
  rejected acquisitions, and the normal-scale random seed1970373042 differs
  from replay712591281. Matrix claims require separate reports; JSON alone
  cannot prove frozen SHA/env or worker-reporting errors. Reused source-first
  context, no reruns, not fresh/blind or a merge endorsement. Evidence compression
  can obscure these distinctions; records above keep each run separate.
- [x] Pagination loss audit for `f2da9848`: counts supported. The two100x
  properties repeat the same800-history corpus (seed1658, same generator),
  not independent samples. Cursor-named helpers need request-shape checks;
  their existence does not prove unchanged cursor reach after this repair.
  The sixteen cells prove rows/publications, not transport volume or latency.
  Red JSON strips the nested row-diff cause; verbose pinned evidence has the
  wrong-row case, while under-fill detail needs a separate verbose rerun.
  Reused source-first audit, no reruns or merge/readiness endorsement.
- [x] Full repaired100x campaign and explicit-prefix transfer-cost assessment
  finished; the remaining publication failure and transfer repair are below.
  No size-pass completion; whole branch now +3,225 net source lines at68366eca.

### Raw subscription changes after private replay retirement

- [x] Pin the later seed1657005 history without deleting its no-op suffix.
  Add direct public-API controls: a source row exists before subscription;
  later update arrives as insert with default options and as raw update with
  `includeInitialState:false`. Before model repair **2 green / 1 red**,
  45 filtered in `/tmp/tanstack-publication-raw-boundary-red.txt`.
- [x] Model correction only: raw updates may reference a row installed in
  source state but never published during the abandoned replay. Use that prior
  source value when no retained public value exists; retained public values
  still govern stale-snapshot reconciliation. This is the existing explicit
  false-option contract (`changes.ts` markAllStateAsSeen, subscription filtering
  bypass), not a new permission for D2 incremental inputs to omit insertions.
- [x] Focused controls/pin **3/0**,45 filtered; full publication100x **48/0**,
  fixed1657005 and replay712591281. Reports
  `/tmp/tanstack-publication-raw-boundary-green.json`,
  `/tmp/tanstack-publication-raw-100x.json`. Scoped lint exits0 with two existing
  no-shadow warnings. Package tsc still exits2; includes the preexisting
  publication callback key `string|number`→RowKey diagnostic, not introduced
  by these changes. `/tmp/tanstack-100x-repairs-types.txt`.
- [x] Commit `d7f4b9d6`; loss audit preserves the raw-future-event versus
  reconstructable-input boundary, retained-public-value precedence and the
  three report scopes. No supported omissions found. Reused sequential source-
  first context can inherit framing; no reruns, environment or new campaign
  verification, and no merge endorsement.
- [x] Fresh full100x campaign finished at `d7f4b9d6`, overrides unset,
  `/tmp/tanstack-minimal-oracles-repaired-100x.json` and matching `.log`.
  Runtime/tests stayed frozen until exit. JSON-only reporter avoids the earlier
  verbose request-warning/reporting load. Result:1,375 passed/1 failed, below.

### Prefix-fetch cost gate: candidate is not merge-ready

- [x] Controlled synthetic provider probe against pre-fix DB source archived
  from `ec2ec796` and candidate `d7f4b9d6`. Same100 rows, ten10-row pages or
  widening10→100, async provider, no intervening mutations, same installed
  dependency runtime. Both variants assert each visible window against a plain
  array slice. Source/test files in the campaign were not changed.
- [x] Both histories: baseline **110 returned rows / 20 requests / 9 cursor
  requests**, candidate **560 returned rows / 20 requests / 0 cursor requests**;
 100 unique rows installed in both. About5.1x provider row volume. Evidence:
  `/tmp/tanstack-prefix-cost.KpBvcn/probe.mjs`, `baseline.jsonl`, `candidate.jsonl`.
  This counts rows an uncached synthetic provider selects, not wire bytes,
  physical network work, latency, memory, or a comparison of separately built
  db-ivm artifacts. Candidate still passes the disturbed-source witnesses;
  baseline does not. Request-count checks alone miss this regression.
- [x] **Design choice resolved below:** the five-line fix is a correctness baseline,
  not a landing recommendation. Recommended next investigation: preserve normal
  cursor continuation and recover only when source changes invalidate its
  prefix proof. Do not infer that observed high-water rows prove acquisition
  coverage, or silently add another state machine. User was asked whether to
  spend a little more code on the narrower policy rather than accept repeated
  prefixes. Hold this gate separately from oracle green and source-size goals.

### Confirmed loading boundary: approved cheaper continuation

- [x] User approved retaining small acquisition-boundary information and using
  recovery when invalidated, without restoring subset algebra. Source survey:
  `frontend-pagination-research-survey.md`; seven systems, bounded sources,
  no external framework benchmark or transferable correctness proof.
- [x] Added asc/desc × pages/widen × page size3/10 transfer controls to the
  pagination oracle. Each visits ten windows and checks rows before counting
  all provider-returned rows, including duplicates and boundary probes. All
  **8 red** on unchanged runtime:175>50 or560>120 permitted returned rows.
  `/tmp/tanstack-pagination-transfer-red.json`. The fixture receives source
  rows already in requested order; projection removes virtual metadata from
  comparisons. Earlier fixture-only failures were corrected before this red.
- [x] Keep a settled acquisition boundary, not the live high-water row. Check
  the exact requested range after settlement; scope continuation to that range.
  Reuse the existing failure/replay invalidation and publication barrier.
  Preserve the16 intervening-insert cases and the broader lifecycle matrices.
- [x] Verify a bounded ordinary-transfer regression; include outlier arrivals during
  acquisition, backward/shrink moves, filters, ties and source-order changes.
  Measure source lines and indexed read work separately from transfer volume.
- [x] Commit the implementation step (`88fad51b`) and run the standing Field Lab loss audit against its
  frozen evidence and todo reduction. No push or merge-readiness claim yet.
- [x] Prior full100x run finished: **1,375 passed / 1 failed**, at runtime
  `d7f4b9d6`. Publication random seed1678102822, path3298:20; last command
  truncate publishes delete(a5) but model expects no event after request,
  cleanup/restart, private a5, release, no-op restart. Full nine-command trace
  remains in `/tmp/tanstack-minimal-oracles-repaired-100x.json`. Classification
  classified below as a raw-event model error; the old campaign remains red,
  not a green full campaign or a pagination failure.

#### Boundary implementation and evidence

- Test-first commit `3a877188`:8 volume failures,152 filtered. Loss audit
  recovered that all ten row checks passed before the volume failure, while
  the later cursor assertion was not reached. Volume is selected rows
  recomputed from recorded provider requests, including repeated selections;
  the provider suppresses duplicate installed IDs. Not actual writes or bytes.
  Static unique numeric ranks, ten windows, two page sizes: this is a bounded
  regression, not an asymptotic proof or a ties/mutation matrix. Audit reused
  source-first context, no reruns or merge endorsement; omission-focused
  scanning may overstate intentional fixture limits.
- Runtime retains one settled boundary row. Subscription reads the applied
  exact ordered range through existing snapshot code, without starting demand.
  Continuations derive both cursor and offset from the confirmed prefix;
  ordinary live high-water rows no longer supply that boundary. Existing
  ordering invalidation, authoritative recovery and publication barriers stay.
  A prefix delivered by its own in-flight request is remembered at settlement,
  preventing source-delivery invalidation from fetching that prefix twice.
- Preserved the16 settled intervening-insert controls. Added24 cells:
  asc/desc × insertion before/after response × rank0.5/100 × predicate-cursor,
  offset-only and opaque-row-key continuation. The offset widening exposed
  four wrong-row cases in the first prototype (12 green/4 red);
  `/tmp/tanstack-boundary-offset-red.json`. Explicit confirmed offsets repaired
  them. The opaque-key extension passed24/0 without an additional runtime fix;
  `/tmp/tanstack-boundary-key-red.json` is named red but contains no failures.
  It models key continuation; it is not an end-to-end TrailBase test.
- Boundary-read failure: a throw initially failed to retire/recover the
  acquisition (1 red in `/tmp/tanstack-boundary-read-failure-red.json`). It now
  uses the existing failed-acquisition path. The unit keeps ordinary graph
  retries suppressed and verifies explicit retry releases the failed lease
  before requesting authoritative recovery.
- First pagination100x prototype:173 green/3 red in
  `/tmp/tanstack-boundary-pagination-100x.json`, fixed seeds16577/1659 and
  random -716796249. All reduced to4 requests exceeding a3-request bound on a
  one-visible-row source. New8-cell underfill matrix:6 green/2 red,
  `/tmp/tanstack-boundary-underfill-red.json`. Request trace shows the duplicate
  finite prefix, not wrong output. Skipping multi-column tie refinement was
  tried and rejected: locale fallback and later-order-term mutation controls
  failed. Restoring refinement and remembering the settled prefix repairs the
  duplicate without weakening those controls. Focused pagination/loader/work
  gate:263/0 in `/tmp/tanstack-boundary-final-gates-v3.json`.
- Synthetic transfer probe now selects110 rows instead of560 for both ten
  10-row pages and widening10→100, with20 requests,9 cursors,100 unique rows
  installed. `/tmp/tanstack-boundary-transfer-probe.jsonl`; executable probe
  `/tmp/tanstack-prefix-cost.KpBvcn/probe.mjs`. This probe reads2450 rows during
  28 boundary lookups. No CPU/latency/bundle benchmark; local prefix reads can
  revisit rows. The separate eight regression tests permit120 selections for
  100 rows, including their tie probes; do not equate that fixture with110.
- Current source delta:+38 net production lines relative to `3a877188`,
  excluding architecture Markdown. No page history, second index or subset
  algebra added. This does not meet the whole-branch below-main size target.
- Final pagination100x:192/0, no skips, including fixed and fresh random
  properties; `/tmp/tanstack-boundary-pagination-100x-v3.json`. Complete1x
  oracle/loader run:1448/0 across25 files, no skips;
  `/tmp/tanstack-boundary-complete-1x-v3.json`. Seed/path/property overrides
  unset; multiplier100 and1 respectively, runtime/tests frozen through exit.
  These counts overlap; do not sum them. Earlier full1x1400/0 report
  `/tmp/tanstack-boundary-final-oracles.json` predates the underfill repair and
  opaque-key extension; do not present it as final validation of those edits.
- Scoped ESLint passes for loader utils, loader unit tests and pagination
  oracle. Package tsc still exits2 on existing test diagnostics (including
  fast-check direction inference at pagination lines167/240), no `src/`
  diagnostics in `/tmp/tanstack-boundary-types-v3.txt`. Not a green package
  typecheck, whole-repository lint pass or full100x campaign.

#### Post-commit boundary loss audit

- Runtime/test source track recovered the adapter assumption already explicit
  in ARCHITECTURE: the boundary is read from current matching Collection rows,
  not a provider cursor or request-tagged row set. It requires exact ordered
  request fulfillment. The snapshot combines subscription/request predicates
  with cursor.whereFrom, order and limit; it does not replay an offset or the
  whereCurrent tie branch. Mechanism compression dropped this from the TODO.
- The24 cells use successful loads, inserts only, unique numeric ranks,
  implicit single-column order, initial1→final3 and serial settlements. Their
  final-row assertion does not separately prove transient publication/callback
  coherence or transport-path reach. The key fixture requires lastKey in the
  current authoritative array and converts it to an offset; no opaque token
  encoding/expiry, deleted boundary key or key movement. Matrix/category labels
  hid those fixed dimensions; broader suites remain separate evidence.
- The failure unit uses a stub and proves the settlement-time read's rejection
  identity, retry suppression and explicit release/unbounded recovery request.
  It does not assert recovered rows/publications or failures from the separate
  countAcquiredRows reads. Summarizing one location as all read failures would
  overclaim. These are test limits, not newly confirmed production bugs.
- Source-first reused agent context; no edits/reruns/report verification or
  merge endorsement. Omission-focused scanning can overstate deliberate
  fixture limits. A separate report track audits evidence counts and probes.
- Report track recovered exact red reach: all four offset failures are rank100
  with offset-only transport, both directions/timings, at checkpoint0;
  12 passed/4 failed/160 filtered. Underfill failures require explicit key plus
  filter, both directions;6 passed/2 failed/176 filtered. Aggregate counts had
  dropped these conjunctions/stopping points. The key report has168 filtered.
  Final192/0 and1448/0 counts/scopes match. Probe row checks cover the nine
  post-preload windows, not an independent preload assertion; static100 unique
  ascending ranks. Reports alone cannot prove command environment, SHA,560-row
  comparison baseline, source-line totals or process exit. Separate report-only
  reused scanner, no sibling-source inspection/reruns or full100x endorsement.
- Rechecked whole-package source size against fixedmain68366eca: +5344/-2081,
  **+3263 net**, excluding Markdown; DBsrc alone+2800. The below-main goal is
  not met. Committed-head synthetic probe records remain110 selections,
 20 requests,9 cursors,100 installed,28 boundary reads/2450 get calls:
  `/tmp/tanstack-boundary-transfer-88fad51b.jsonl`. The standalone process
  remained alive on timers after both records; stopped that exact probe with
  SIGTERM (exit143). This is output/assertion evidence, not a clean-exit probe.
  Both final Vitest runs exited0 independently.

### Raw truncate after retiring private replay

- [x] Reproduced seed1678102822's complete nine-command history, including the
  two no-op rejected settlements and no-op second restart. At command8 runtime
  emits delete(a5), model expected no callback. Six direct controls cross
  default/explicit-false includeInitialState with update/delete/truncate:
  **6 green/1 red**,46 filtered, `/tmp/tanstack-publication-raw-truncate-red.json`.
- [x] Runtime contract check: explicit `includeInitialState:false` requests ALL
  future source events, including deletes for unseen rows (changes.ts
  markAllStateAsSeen; subscription.ts filterAndFlipChanges). The retained
  snapshot path instead reconciles from held public state. No runtime change
  is needed for the reported deletion; a raw event stream is not always a
  reconstructable result snapshot.
- [x] Added a16-cell product: no prior public row / retained sibling / refreshed
  sibling / newly published sibling × single delete / empty truncate /
  same-key same-value replacement / different-key replacement. **7 green/9 red**,
 53 filtered, `/tmp/tanstack-publication-reset-product-red.json`. All9 failures
  are truncate variants with no retained row left; the four single-delete
  controls and three retained-sibling truncate controls already pass. Each
  failure stops at reset; its unsubscribe suffix is not established by red.
- [x] Model now distinguishes public keys still awaiting refresh from current
  source rows. An unbuffered truncate emits source deletes plus replacement
  inserts in one batch, retaining same-key delete/insert pairs. A held snapshot
  or replay demand still uses the replacement diff. Refresh, successful
  replacement and cleanup/replay retirement update that semantic distinction.
  This adds test-model state, not runtime state; no classifier or test removed.
- [x] Publication100x: **69/0**, no skips, fixed1657005 and random-190819726;
  `/tmp/tanstack-publication-raw-truncate-100x.json`. Original replay1678102822,
  path3298:20: **1/0**,68 filtered;
  `/tmp/tanstack-publication-raw-truncate-replay.json`. Counts overlap. Runtime
  unchanged; tests/model frozen until both processes exited0, then formatted.
- [x] Scoped ESLint:0 errors, two existing no-shadow warnings. Package tsc
  exits2 with the existing callback key `string|number`→RowKey diagnostic and
  other existing test errors. Reports `/tmp/tanstack-publication-raw-truncate-lint.txt`
  and `/tmp/tanstack-publication-raw-truncate-types.txt`; not a green typecheck.
- [x] Commit667ec972 and run source-first Field Lab loss audit. The formatted
  suite also passes69/0, fixed1657005 and random847440060;
  `/tmp/tanstack-publication-raw-truncate-formatted.json`. This repeats the
  suite, not another69 independent tests. The report audit recovered this
  omitted checkpoint, lost by compressing the record to “then formatted.”
- [ ] Broader100x clean-exit gate at667ec972, all24 files from test:oracles plus the
  loader unit suite, coverage off, timeout600000, overrides unset. Outputs:
  `/tmp/tanstack-minimal-full-100x-raw-truncate.json` and matching `.log`.
  Completed1469/0, no skips, JSON success:true, **process exit1**. JSON-only
  reporting contains no reason for the process failure. This closes the
  assertion mismatch, not the clean-process gate. A normal+JSON reporter rerun
  (`/tmp/tanstack-minimal-full-100x-reported.log`) was stopped with SIGTERM143
  after50MB of expected test warnings, without a final report. Replacement run
  uses `--silent` to suppress test console logs but keeps default+JSON error
  reporting: `/tmp/tanstack-minimal-full-100x-silent.json` and `.log`. No test
  changes or ignored errors; fresh random seeds, same100x scope. Runtime/tests
  remain frozen until exit. Do not infer the unexplained exit's cause yet.
- Report loss audit confirms the red failing sets/counts and overlapping green
  reports. JSON does not independently prove multiplier, shrink-path override,
  frozen SHA, formatting order or command exits. Type log has30 diagnostics;
  comparison with earlier logs, not this log alone, supports “preexisting.”
  Reused report-first scanner, no sibling code inspection/edits/reruns or
  inference about the running full campaign. Prior framing and checkpoint
  compression can hide distinctions between repeated and independent evidence.
- Source loss audit recovered that retainedKeys tracks stale public keys, not
  source membership: even a same-value refresh consumes a key without a
  callback; any remaining key selects replacement reconciliation for the
  truncate. Explicit false skips unseen-key filtering, but stale-publication
  reconciliation still runs first and may rewrite/suppress individual events.
  “ALL future events” alone would obscure that ordering.
- The16 cases fix on-demand/explicit-false, one demand, cleanup→restart→private
  write→release, no settlement, and same-value sibling refresh. Unsubscribe
  ends each history with no post-unsubscribe stimulus. The6 direct controls
  use one preinstalled row and undefined/false (not true), and flatten batches.
  The history driver separately checks exact per-command batch boundaries,
  types/keys/values/previousValue and source state; only cross-key ordering is
  normalized. Its callback consumer map is updated but not directly asserted.
  Raw-event equivalence is not snapshot reconstruction. Dimension/assertion
  compression dropped these limits; no new bug follows from the audit alone.
- Source scanner used reused source-first context, not fresh/blind, and did no
  edits/reruns/report certification. An omission-focused scan may overstate
  intentional fixture limits. No whole-PR or full100x correctness endorsement.

### Publication model state consistency follow-up

- [x] Normal-reporter100x run exposed random87900852, path3937: request b,
  truncate, private source b0, release b, request b, no-op restart/abort a,
  abort b, no-op restart, truncate, restart, unsubscribe, release b. Failure at
  command9: delete(b0) observed, no callback expected. Completed1468/1, no skips,
  plus **two Vitest worker Timeout calling onTaskUpdate errors**, exit1.
  Runtime/tests stayed frozen. Log `/tmp/tanstack-minimal-full-100x-silent.log`.
  The timeouts identify a runner-reporting failure in this run; they do not
  independently prove the cause of the earlier JSON-only exit1.
- [x] Source inspection: expected request-snapshot callbacks add the row to
  expected batches/sentKeys but omit publication.visible. The runtime callback
  consumer map is maintained but never compared to model.visible, as the audit
  noted. This can defer a model inconsistency until a later reset. Also inspect
  unchanged private-row writes: no callback must not invent a consumer row.
- [x] After the frozen run exits, pin the full history and add a per-command
  model/consumer-state assertion, plus unchanged-private-write control. Red the
  invariant where state first diverges: **0 green/2 red**,69 filtered, at
  request command4 (actual b0, model empty) and unchanged-write command5 (actual
  empty, model a5). `/tmp/tanstack-publication-consumer-state-red.json`.
  Snapshot callbacks now add their row to model.visible; unchanged writes
  return before adding an unpublished row. No runtime edits. Raw/reset laws
  and all prior batch assertions remain; new invariant checks state too.
- [x] Formatted publication suite **71/0**, no skips, exit0;
  `/tmp/tanstack-publication-consumer-state-green.json`. This is normal scale,
  not the100x follow-up. These changes close the audit's unasserted consumer-
  map gap for this driver; they do not turn raw events into D2 input deltas.
- [ ] Commit then loss audit and publication100x. Full-suite clean-process gate
  remains open separately from model repair: do not suppress unhandled errors
  or loosen assertions to work around the worker-reporting timeouts.
