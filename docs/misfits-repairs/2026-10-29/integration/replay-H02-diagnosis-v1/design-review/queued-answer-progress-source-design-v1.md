# Queued-answer progress: source design v1

Status: independent source analysis, not an implementation decision or product
verdict. No production, oracle, test, dependency, budget, or campaign changed.
No runtime, install, receiving invocation, commit, push, or publication ran.
The only new artifact is this report. The required pre-edit product RED remains
missing, and no next receiving run is admitted.

`S` below is
`/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-progress-main-v1`,
at pinned main `9cfa11fc712866f8f276e85762865ebb8bd49cbe`. Source references
are relative to S. The task's accepted law requires host return for an already
queued answer in a legal finite custom-cache history. It establishes no numeric
deadline and decides no policy for permanently conflicting caches.

The frozen v6 handoff records conflict 214 and completed enqueue 216, followed by
no answer execution before native heap failure. That is a finite resource-limited
prefix, not product RED/GREEN. The independent v6 reviewer reports that every
accepted acquisition returned a Promise, including all 14,175 after enqueue.
I did not reproduce or independently recount that observation. The counts are
not pending-provider counts: the preserved source inventory identifies only 13
provider requests. No allocation cause follows from this source analysis.

## Causal boundary and preferred candidate

The smallest candidate is an **opt-in D2 suspension at a completed operator
boundary, owned by the live-query Collection builder**. Keep acquisition,
cached-row application, lease release, and demand replacement unchanged.

The source chain explains why an outer scheduler-only change cannot work:

- `packages/db-ivm/src/d2.ts:59` drains operators until an entire pass runs none.
- Compiler taps call demand effects during that drain, for includes at
  `packages/db/src/query/compiler/index.ts:871` and joins at
  `packages/db/src/query/compiler/joins.ts:502`.
- `packages/db/src/query/live/subset-demand-controller.ts:142` starts a segment;
  `:330` enters `requestSnapshot`. Its final release path at `:376` aborts and
  releases retired segments synchronously.
- `packages/query-db-collection/src/query.ts:2380` subscribes a recreated cached
  observer, and `:3396` immediately applies its current result. Final release
  can synchronously commit row deletion at `:3494`–`:3555`.
- The builder's reentry guard at
  `packages/db/src/query/live/collection-config-builder.ts:822` prevents another
  graph call; it does not stop the current D2 pass loop at `:860`.

Thus the asynchronous demand result can be pending while its synchronous cache
effects repeatedly generate input for that same drain. Scheduling after
`graph.run()` cannot supply a host return if `graph.run()` never returns.

Proposed concrete trigger, to be confirmed at the actual receiving boundary:

1. The builder is running its current graph behind an existing replay or ordered
   publication hold. Capture this fact before the demand callback can retire the
   last owner.
2. A changed lazy-demand update returns a Promise and synchronously advances the
   builder's `graphInputRevision` while applying/releasing source rows.
3. After that operator finishes, D2 still has pending work.

This is a causal condition, not a retry/acquisition/pass budget. An acquisition
whose result is literal `true` does not meet it. An ordinary synchronous source
mutation with no existing publication hold does not meet it. A Promise alone
does not meet it either.

Expose the existing `DemandUpdate` result through
`CollectionSubscriber.setDemand` (`collection-subscriber.ts:238`), after its
existing `beginDemand`/settlement registration. The builder's callback at
`collection-config-builder.ts:1612` can capture the hold and input revision around
that call. This uses the existing result and revision; it needs no cache-version
classifier or second ownership model.

Add an optional stop request to `D2.run`, checked after a complete `op.run()`.
Its default remains the current full drain. Report whether the requested stop
left pending work. The builder must return immediately on suspension: no
ordered-loader decision, `flushPendingChanges`, empty commit, readiness update,
or window completion may run over an unfinished graph. Retain the existing root
accumulator, child-facade deltas, D2 relations, and acquisition leases. Resume
normal loader selection only after processing pending sibling input. Preserve
the existing completeness check at `collection-config-builder.ts:1471`, which
also prevents status callbacks from marking an unfinished graph ready.

The **continuation owner** is the builder's current sync run, not a demand or a
Query cache entry. Queue one host task for that builder; capture
`syncRunGeneration`, config, and sync-state identity. Extend the existing
generation fence at `collection-config-builder.ts:934` with the config/state
identity checks already used at `:843`. Until it runs, any
immediate transaction-scheduler callback for the builder must leave the pending
graph to that owner. Otherwise `Scheduler.flush` (`packages/db/src/scheduler.ts:96`)
can immediately reenter and recreate starvation before the host returns.

A portable zero-delay timer is one candidate task mechanism. Zero is a scheduling
request, not a product deadline. A microtask alone covers v6's queued microtask
answer but can starve a queued timer/task; do not claim the broader host law from
that mechanism. The continuation clears its own pending marker, checks the
captured run, then schedules a normal fresh graph turn. Do not retain the old
transaction/publication context across the host boundary.

Cleanup must cancel that task and discard its marker in
`clearSyncRunState` (`collection-config-builder.ts:1035`). Generation checks
remain necessary because cancellation cannot recall a task already dispatched.
A late task must neither operate on nor clear a replacement run's marker.
Cancellation does not settle demand, release cached ownership, or open a replay.
Existing teardown owns those transitions. A graph error after resumption must
still crash the query and settle the affected operations through their existing
error path; asynchronous error delivery needs an explicit receiving check.

## Hold semantics and alternative locations

`hasPendingSourceRecovery()` (`collection-config-builder.ts:784`) reads
`hasPendingTruncateReplacement`: it includes a failed replay that still holds
publication. `pendingTruncateReplacement` instead exposes an unsettled completion
Promise. These are different facts. The proposed admission uses the publication
hold, including failed-held state, together with the new Promise-returning demand
and input feedback. It does not treat a missing completion Promise as permission
to publish, retry, or recover. New demand behind a failed hold is therefore an
explicit neighboring receiving cell, not silently excluded.

The hold inventory must also match the existing ordered gate at
`collection-config-builder.ts:1210`–`:1225`; a failed-operation flag by itself
is not evidence of new asynchronous work. The triggering demand Promise supplies
that distinction. The exact v6 hold flag at the triggering update is not in my
evidence. If no permitted existing hold is present there, this candidate does not
yet repair the receiving trace. Broader suspension would then need a separate
decision about ordinary synchronous observations.

| Location | Assessment |
| --- | --- |
| Builder plus opt-in D2 stop | Preferred smallest candidate. It reaches the actual inner drain and preserves the adapter's current ownership behavior. Generic D2 callers keep their current semantics. |
| Move demand side effects out of compiler taps | Architecturally attractive: stage each plan's latest demanded keys, drain D2, then execute a finite demand pass. It still needs a host cut and publication protection when the pass feeds input back. It changes demand timing/coalescing for joins, includes, and Effects; it is a larger repair with additional receiving obligations. |
| Transaction scheduler alone | Insufficient: the current D2 call must first return. Broad scheduler yielding also changes unrelated synchronous transaction cuts. |
| Query adapter cache boundary | Defer-before-claim or ignore-while-fetching can stop this trace by dropping/delaying cached ownership. The accepted reacquisition contract forbids that shortcut, including failed refetch and peer cases. Deferring physical release similarly invents a retention policy. No adapter-only alternative is established here. |

The opt-in builder change would not repair an analogous Effect feedback loop.
Effect has its own `graph.run()` at `packages/db/src/query/effect.ts:1019` and
callback-publication gate. Shared D2's default must remain unchanged; Effects
need receiving controls for that claim. Effect-wide progress remains outside
this candidate's scope. No permanent-conflict outcome is selected.

## Required actual receiving controls

Prepare and independently review these controls **before** any production edit.
Run them on unchanged receiving code before the edit, and reuse the same model,
histories, observations, and comparison afterward. This report admits no run.
Ordinary core fixtures do not substitute for real Query Core custom-cache
ownership at the H02 boundary.

| Receiving history and observation cut | Wrong repair it rejects; existing owner |
| --- | --- |
| Actual Query Core distinct custom keys, stale nonempty pivot versus newer empty sibling result, pending un-aborted answer actually queued. Record the existing hold at the proposed trigger, scheduler return, answer execution, retained prior public snapshot, and final independently recomputed relation after applied replies. Include a nonempty prior snapshot and microtask/task answer schedules. | Unreachable guard, microtask-only starvation, retry caps, suppressed demand, and partial publication. Composed H02 receiving gap; current v6 is not RED. |
| Compatible all-literal-true completed initial ordered chains: indexed page/tie/refill and required full-source/fallback. Compare rows and readiness before the initiating call returns, without an `await`. | Blanket async yield. `packages/db/tests/query/ordered-lifecycle-oracle.property.test.ts:948`, `:1070`, `:2467`; deferred-start qualification in `packages/db/tests/live-query-deferred-acquisition-oracle.test.ts:29`. |
| Ordinary synchronous source insert/update/delete and route move outside every replay/ordered barrier; include a compatible cached lazy acquisition. Compare reads, callback payloads, and downstream result at method return. | Yielding whenever any load is Promise-returning. Layered owner: `packages/db/tests/query/includes-publication-oracle.test.ts:23`; add the actual Query DB receiving premise. |
| Fresh/stale cached reacquisition, failed/same/empty refetch, held older release, zero/one/two peers, then release peers and reacquired lease. Observe while held, after application, after refetch, and after every release. | Dropped cached ownership, delayed claim, stale release erasing a new owner, and retained-row leaks. `packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts:962`. |
| Suspend with replay live; supersede by another truncate, retire demand, cleanup/restart, or abort; let old answer and old continuation arrive afterward. Check exact releases, current readiness/health, and no stale rows/publications. | Unfenced continuation, stale error/ready signals, double release, or resuming a discarded graph. Lifecycle grammar `packages/db/tests/collection-subscription-lifecycle-grammar-oracle.ts:4`, cleanup/restart owner, includes temporal owner. |
| Failed-held replay with no completion Promise, then new demand with finite success/failure; separately retire its last demand and mutate an unrelated sibling. Observe retained publication, failure identity, and reopening only at the existing lawful boundary. | Confusing replay completion with publication hold, recovering on yield, or keeping an unreachable source hold forever. `packages/db/tests/query/replay-failure-boundary.test.ts`, `packages/db/tests/replay-adapter-ownership.test.ts`, includes temporal owner. |
| Hold an establishing applied receipt across suspension, settle sibling work first, and fail/abort or apply the selected receipt. Also inject graph failure on resume. | Treating host return as applied settlement, early operation success, or lost asynchronous failure. Ordered lifecycle and `load-subset-transaction-refinement-oracle.test.ts` owners. |

The smallest test gap is the missing composition: cache reacquisition ownership
is checked independently, and ordinary finite graph/publication histories do not
force the nonmonotone anti-join/include feedback while a real host answer waits.
More settled-row examples cannot establish that the host receives control.

No closure follows from this design. Before implementation, require qualified
pre-edit RED at the reached premise, actual pre-edit receiving neighbors above,
and a reviewed source change. Afterward require the same histories GREEN and
the original behavior rejected at the intended progress comparison. Keep
resource termination, setup failure, and uncaught graph failure distinct from
that comparison. Source-only uncertainties remain: exact trigger reach,
continuation/task ordering in each claimed host, asynchronous failure delivery,
Effect progress, and retained allocation. No numeric product bound, heap-leak
attribution, universal termination proof, or permanent-disagreement policy is
claimed.
