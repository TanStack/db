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

No layer may use a production-only counter or infer correctness from the same
helper that production uses.

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
      per-consumer prefix and monotonic-publication assertions because live
      collections may publish progressive bootstrap prefixes while Effects
      publish the same result in one batch.
- [x] Complete the public lifecycle trace: generated histories observe
      demand/release, settlement, source mutation, replay, cleanup/restart,
      failure, and public snapshots at intermediate points. The release path
      now generates a later reacquisition instead of ending the history.
- [x] Complete the atomic-publication observer for root rows and
      collection-valued children so no callback can observe a mixed epoch.
      The replay oracle checks each public batch and callback snapshot; the
      includes publication suites check matching root/facade snapshots.
- [ ] Add or name the metamorphic laws for consumer equivalence, stale-event
      erasure, replay equivalence, independent-history commutation, and exact
      sharing. Split/merge acquisition equivalence is deliberately absent
      because the product no longer promises subset algebra.
- [ ] List each deliberate mutation in the focused audit and name the exact
      oracle assertion that kills it.
- [ ] Add one shared on-demand source fixture only if a third current test
      needs the same adapter protocol. Do not create a helper merely to hide
      two readable fixtures.
- [ ] Run a focused mutation audit after the oracle surface is stable.

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

- [ ] Reconcile all production findings.
- [ ] Reconcile every oracle/maintenance recommendation.
- [ ] Map every public law from deleted full-flow/lifecycle/model files.
- [ ] Confirm no production-only oracle counters or test hooks remain.

### Deleted-suite audit

Audit each removed stack-only suite by test title, not only by file. A checked
row means every distinct public law has a named destination and has been run.

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

| Still-valid law from the large stack                                                                          | Public destination                                                                                                                     | State                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Exact demand identity includes predicate, order, cursor, offset, and limit but excludes owners                | `ir-stable-identity.test.ts`; `subset-dedupe.test.ts`                                                                                  | covered                                                                               |
| Exact unabortable peers share work; abortable owners do not; reject/reset/restart permit retry                | `subset-dedupe.test.ts`; `collection-subscription-replay-oracle.property.test.ts`                                                      | covered                                                                               |
| Ordered windows equal independent full recomputation for live collections and Effects                         | `pagination-oracle.property.test.ts`; `ordered-work-oracle.property.test.ts`                                                           | covered                                                                               |
| Multi-source residual filters refill an underfilled ordered window                                            | `ordered-work-oracle.property.test.ts` exhaustive and generated LEFT JOIN cases                                                        | covered                                                                               |
| Locale, nullable, reverse-index, multi-column, public-key-tie, offset, and beyond-end windows stay correct    | `pagination-oracle.property.test.ts`; focused `order-by.test.ts` cases                                                                 | covered                                                                               |
| Every locale continuation and reversed-index demand stays bounded by a limit or cursor predicate              | `pagination-oracle.property.test.ts` whole-trace bounded-load assertions                                                               | restored and covered                                                                  |
| Cursor predicates denote the same nullable mixed-direction tuple order used by pagination                     | `cursor.property.test.ts`; compact semantic `cursor.test.ts`                                                                           | restored; red/green found null-placement bug                                          |
| A non-ordering visible-row update does not cause new ordered source work                                      | `ordered-work-oracle.property.test.ts`                                                                                                 | covered                                                                               |
| A zero-sized ordered demand starts no adapter work through either a live collection or an Effect              | Cartesian live collection/Effect cases in `ordered-work-oracle.property.test.ts`                                                       | restored and covered                                                                  |
| Truncate/replay retains the last complete snapshot and publishes one atomic replacement                       | `collection-subscription-replay-oracle.property.test.ts`; `load-subset-replay-refinement-oracle.test.ts`; includes publication oracles | covered                                                                               |
| A joined replacement stays private until every recovering source settles                                      | `load-subset-replay-refinement-oracle.test.ts` “waits for every recovering source…”                                                    | restored and covered                                                                  |
| Stale or released replay settlements cannot overwrite the current generation                                  | replay model, fixed stale/newest cases, restart histories, and same-tick scheduler property                                            | covered                                                                               |
| Optimistic rows remain above a private replay and converge after settlement                                   | `collection-subscription-replay-oracle.property.test.ts`; collection metadata/state oracles                                            | covered                                                                               |
| Cleanup fences pending replay and ordered continuation work                                                   | collection replay oracle; D2 source reconciliation oracle; focused subscription/Effect tests                                           | covered; audit exact old variants                                                     |
| Failed adapter release remains retryable for exact and in-flight replay acquisitions                          | `collection-subscription.test.ts` exact-release and replay-release regressions                                                         | restored and covered                                                                  |
| Ownership exists before reentrant release for direct/deferred and sync/async adapter starts                   | `collection-subscription.test.ts` Cartesian reentrant ownership matrix                                                                 | restored and covered                                                                  |
| A caught or escaped reentrant release failure keeps the exact acquisition retryable                           | `collection-subscription.test.ts` Cartesian failed-release matrix                                                                      | restored and covered                                                                  |
| A synchronous replay that drops its demand releases each physical acquisition exactly once                    | `collection-subscription.test.ts` synchronous replay-release regression                                                                | restored and covered                                                                  |
| Load errors preserve the exact error, do not hang readiness, and allow a later retry                          | `subset-error-matrix.test.ts`; source-readiness and replay-refinement suites                                                           | covered                                                                               |
| Abort before apply cancels; abort after publication begins cannot undo committed rows                         | `load-subset-transaction-refinement-oracle.test.ts`                                                                                    | covered                                                                               |
| Source truth survives D2 graph teardown/restart and exact prior rows drive retractions                        | `d2-source-reconciliation-oracle.property.test.ts`                                                                                     | covered                                                                               |
| Independent source histories commute                                                                          | `d2-source-reconciliation-oracle.property.test.ts`                                                                                     | covered                                                                               |
| Predicate subtraction behavior outside loadSubset                                                             | origin/main `predicate-utils.test.ts` unit matrix                                                                                     | retained at its prior contract; stack-only null-safe algebra cases removed with request refinement |
| Binary, Date, Temporal, opaque-reference, and invalid-value identity match evaluator semantics                | comparison, cursor, and `ir-stable-identity.test.ts`                                                                                   | covered; focused suite 323/323 green (6 skipped)                                      |
| Temporal and opaque sortable range operands cross the public subscription boundary unchanged                  | Cartesian adapter-boundary cases in `collection-subscription.test.ts`                                                                 | restored and covered                                                                  |
| PowerSync publishes only active demand, fences startup/cleanup, settles current tracking, and retries release | compact public trigger/request/release tests in PowerSync on-demand and load-hook suites                                               | restored; red/green; adapter suite 105/105 green                                      |
| Persistence keeps replacement ownership and preserves reject/abort semantics                                  | persistence adapter suite                                                                                                              | retained; run adapter suite                                                           |
| Query DB keeps exact owners, idles after eager cache GC, restarts on remount, and clears retained metadata    | Query DB ownership lifecycle suite plus public cache/metadata cleanup tests                                                            | restored; red/green; adapter suite 336/337 green (1 skipped)                          |
| Electric waits for public commit application, waits for both cursor requests, and removes session listeners   | focused Electric sync-mode tests                                                                                                       | restored and covered; compact adapter suite 219/219 green                             |
| Electric starts no work for an already-aborted request/session and cancels a pending refresh on cleanup       | Cartesian abort-source cases and pending-refresh cleanup in `electric.test.ts`                                                         | restored; red/green found two adapter regressions                                      |
| A failed include-demand release cannot suppress a later incarnation or poison a valid source commit          | `includes-temporal-oracle.test.ts` fixed/generated release-reentry laws                                                               | restored and covered                                                                  |
| Effect cleanup reports release failure, retains only failed cleanup debt, and retries on the next dispose     | `effect.test.ts` Error and falsy-throw cleanup cases plus obsolete-demand release                                                     | restored; red/green found retry loss                                                   |
| The same public demand path yields the same rows and lifecycle state across entry points                      | live collection/Effect parity in `ordered-work-oracle.property.test.ts`                                                                | covered                                                                               |
| Out-of-order settlements and same-tick cleanup/restart preserve the recomputed result                         | replay settlement-order model and scheduler property; pagination multi-source recomputation                                            | covered                                                                               |
| Generated histories visibly reach failure, sharing, restart, tied/null, and beyond-end regimes                | explicit reach checks plus pagination's exhaustive fixtures                                                                            | covered                                                                               |
| No-progress ordered loads stop without false exhaustion, hidden diagnostics, or an identical request loop     | `ordered-work-oracle.property.test.ts`; focused live/Effect no-progress script                                                         | covered                                                                               |
| A filtered join starts one exact demand per source rather than repeating graph work                           | `ordered-work-oracle.property.test.ts` “loads each source of a filtered join once”                                                     | restored and covered                                                                  |
| A zero-sized indexed query can widen later and publishes only its complete window                             | `ordered-work-oracle.property.test.ts` “publishes one complete batch…”                                                                 | restored; red/green found index setup bug                                             |
| Reentrant cleanup cannot erase the exact synchronous ordered-load error                                       | `subset-error-matrix.test.ts` “preserves a synchronous ordered error…”                                                                 | restored and covered                                                                  |
| Ready transitions survive callback failure, stop when superseded, and restart as a fresh cycle                | `collection-lifecycle.test.ts`; `collection-events.test.ts`; `query/scheduler.test.ts`                                                 | restored and covered                                                                  |
| An already-aborted demand starts no eager, deferred, or adapter work and rejects with `AbortError`            | `collection.test.ts`                                                                                                                   | restored and covered                                                                  |
| Cleanup during a root/facade publication suppresses callbacks from the cleaned facade                         | `includes-collection-oracle.property.test.ts`                                                                                          | restored as a public observation                                                      |
| Internal order-only swaps propagate through root, Collection, array, scalar, and materialized consumers       | generated adjacent swaps in `includes-collection-oracle.property.test.ts`                                                              | restored without private revision counters                                            |
| Pending optimistic work never exposes a mixed source/query publication, including same-key confirmation       | collection metadata/state oracles plus the layered-query publication oracle                                                           | retained through independent public-state models                                      |
| Canceling one metadata owner cannot cancel a retained owner or publish a row change                            | `collection-metadata-publication-oracle.property.test.ts` fixed/generated public adapter traces                                        | rewritten without private transaction/snapshot topology and covered                    |
| Root and facade state cannot diverge when either side rejects a publication                                    | includes root/facade failure regressions plus `bucket-facade-adapter.test.ts` rollback laws                                             | child preparation now precedes the final root commit; covered                          |

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
- The generated predicate-subtraction oracle and its stack-only null-safe unit
  cases existed to justify algebraic request refinement. That path is gone.
  The utility's prior origin/main tests remain; strengthening an otherwise
  unused exported helper is not part of this RFC.

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
      cleanup, so the mirrored lifecycle generation is gone. PowerSync remains
      105/105 green.
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
