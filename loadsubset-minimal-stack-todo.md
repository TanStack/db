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
  - [ ] Retire a provisional acquisition when the ordered-loader result
        observer throws. A throwing publication/listener callback must not
        leave successful coverage behind or let the queued settlement clear
        the failure gate.
  - [ ] Replace the synthetic callback-before-throw page cell with a reachable
        production integration that throws after adapter startup during local
        read or publication. Keep direct route cells only for method-selection
        laws that cannot be observed through the public API.
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
  - [ ] Retire a failed logical demand even if truncate has already replaced
        its physical acquisition object. Cross failure, truncate, explicit
        retry, and another truncate; the obsolete cursor must not rejoin or
        veto the successful replacement. Use a stable logical-demand handle.
  - [ ] Fence explicit retry while failed-acquisition release is in progress.
        Reentrant `unloadSubset` must not start the replacement before the old
        release succeeds, and a failed release must leave no replacement work.
  - [ ] Extend failed-acquisition tests across async page, prefix, full-source,
        and boundary routes with real acquisition identity, real signal abort,
        final release counts, and exact replay request traces.
  - [x] Derive the zero-window no-load and readiness-wake expectations from the
        requested limit, not observed load count. Every publication now records
        callback-time status, so only one empty `ready` batch can satisfy the
        acquisition wake-up law and a zero window permits none.
  - [ ] Preserve or reject `previousValue` explicitly on every normalized
        public change; do not discard malformed insert/delete payload fields.
  - [ ] Compare the exact public change batch with the reference before/after
        rows instead of leaving scenario `changes` unasserted.
  - [ ] Give every structural matrix cell a fixed semantic witness: a rank tie,
        mixed filter membership, two meaningful windows, and a real mutation,
        while crossing provider tie order independently.
  - [ ] Pin and fix both implicit-public-key tie update failures found by the
        10x state campaign: top-1 equal-rank replacement and offset-1 equal-rank
        replacement must choose the lowest public key after an update.
- [ ] Prevent a reentrant truncate started during synchronous replacement
      publication from letting the superseded attempt emit transient `ready`.
- [ ] Close the public window-reentrancy follow-up audit:
  - [ ] Reject or defer `setWindow()` called synchronously from the initial
        ordered adapter load; it must not return `true` before the requested
        rows are visible.
  - [ ] Reject or defer `setWindow()` called from an ordinary live-query
        publication listener; a coalesced graph turn must not look settled.
  - [ ] Fence outer window settlement by sync-session identity. Synchronous
        cleanup during its adapter request must not let the old operation write
        a settled window into the restarted collection.
  - [x] Preserve the existing async control: a superseding window move made
        after the adapter has yielded remains legal and waits for its own work.
- [ ] Close the subscription-teardown follow-up audit:
  - [ ] Prevent a stale outer cleanup-debt snapshot from unloading an
        acquisition again after a nested `unsubscribe()` already released it.
        Cross multiple debts, repeated teardown, and reentrant cleanup.
  - [ ] Give EventEmitter registrations their own identity. Removing and
        re-adding the same pending callback during an emission must defer the
        new registration until the next emission.
  - [ ] Do not register a subscription that unsubscribed reentrantly during
        automatic `includeInitialState` loading.
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
  - [ ] Store each replay failure on its demand or attempt so an unrelated
        `unloadSubset` failure cannot replace the replay completion error.
  - [ ] Keep status non-ready while an untracked asynchronous demand acquired
        reentrantly from `unloadSubset` still gates replay publication.
- [ ] Reconcile the joined-recovery readiness wording with the public
      multi-source barrier: a single source can become ready before the joined
      replacement is public.
- [ ] Finish the functional-projection boundary matrix: initial placeholders,
      recursive and union sources, ready facades in callbacks, derived scalar
      behavior, and opaque callback roots.
- [ ] Ask multiple fresh reviewers for final coherence, hostile-assay, and
      loss-audit passes.
- [ ] Update RFC/PR text and changeset to match the final design.
