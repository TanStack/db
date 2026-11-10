# Queued-answer progress: completion ownership v3

Status: concrete source/API proposal, suitable for implementation only after the
required pre-edit RED and actual receiving gates. It is not implementation
approval. No production, oracle, test, dependency, budget, or campaign changed;
no runtime, install, receiving invocation, commit, push, or publication ran.
V1, v2, and the independent review remain unchanged.

This report resolves the proposed-design completion gaps in v2. I read the
independent v1 review (SHA256
`2a6c60066e9977d9cfd1ee685569922ce5801fcf6acd17c9def8e970f065742a`)
and inspected the relevant operation, receipt, facade, and crash source. Source
references use S at pinned main `9cfa11fc712866f8f276e85762865ebb8bd49cbe`, as
defined in v1. None of the counterexample schemas below is an executed baseline
production finding. Actual trigger reach and a qualified product RED remain
missing.

## 1. One continuation owner; separate queued task and completion

Keep v1's narrow trigger: existing publication hold captured before demand
update, changed Promise-returning demand, synchronous graph-input revision
advance, and actual remaining work after a complete D2 operator. The stop latch
is sticky only within that D2 call. Recheck run/config/state after adapter
callbacks before installing a continuation. A stop request with no remaining
work reports drained and runs the normal loader/publication tail.

The builder owns one continuation record for its current sync run:

- captured sync-run generation, config object, and sync-state object;
- one deferred completion Promise;
- an optional queued-task token/cancellation handle;
- the input and window-operation generations of its most recent successful
  graph/publication pass.

The optional task token owns permission to resume D2. While it exists, immediate
scheduler callbacks leave the graph untouched. Its host callback checks exact
record/token/run/config/state identity before clearing only its own token and
running a fresh graph turn. It does not carry the old scheduler context.

The completion Promise owns the obligation owed to window operations. It
survives task dispatch, repeated yields, and a quiescent graph whose publication
still waits. With no task token, source callbacks can run the graph normally;
the still-pending completion is not an execution lock.

Register completion only through the existing operation-only tracker
(`collection-config-builder.ts:648`, `collection/sync.ts:943`). Attach it before
returning suspended, and immediately after `beginLoadSubsetOperation` in any new
`setWindow` while the record exists (`builder:451`). This closes both v2 paths:
an existing operation cannot lose its last participant before the host task,
and a new operation cannot return literal `true` merely because source demand
already settled.

Do not add a suspended-state reentrancy error. New asynchronous-gap window calls
remain legal and update the requested top-K under existing request/window
generations. A call inside an actual graph/operator/publication callback still
uses the existing synchronous reentrancy guard (`builder:382`). Older window
requests retain their existing join of `latestWindowRequest` (`:503`).

## 2. Make the flush outcome explicit and retain applied obligations

Change the internal `SyncState.flushPendingChanges` signature
(`query/live/types.ts:36`) to return this conceptual result:

```ts
type GraphPublicationOutcome =
  | { kind: 'held' }
  | { kind: 'complete' }
```

`held` means an existing replay, ordered, failed-window, or reload-completeness
gate prevented publication. `complete` means the normal root/facade publication
tail finished for this graph pass, including a legitimate no-change result.
Evaluate the same existing gates before returning a no-change completion.
Extract their current predicate rather than copy another gate classifier.

The builder separately records **only unsettled graph-output applied receipts**
for its current run. This is not a publication or readiness gate. Register each
non-literal receipt before invoking its publication callbacks, remove it when it
settles, and discard the run's registry at teardown. Record these receipts for
graph output even before a continuation starts, so a later continuation cannot
miss an already queued output transaction. Retain no settled receipt history.

The source supplies these existing receipts:

- Capture the root `commit()` result currently ignored at builder `:1279`.
- Extend internal `FacadePublication` (`bucket-facade-adapter.ts:58`) with its
  establishing applied receipts. Capture the `sync.commit()` results currently
  ignored at `:151`; the builder registers them as part of that flush. No-op
  facade publication contributes none. The existing prepare/publish/rollback
  sequence remains synchronous and unchanged.

This includes child-facade writes because an external holder can legally keep a
facade transaction persisting while graph writes queue behind it. Waiting only
for the root receipt would not establish visibility of the chosen materialized
window. It does not authorize queue priority or withdraw accepted writes.

At the end of the graph runner, after its `isGraphRunning` flag unwinds, complete
the record only if all these facts still hold:

1. Exact record/run/config/state identity matches; no queued task owns resumption.
2. D2 has no pending work and ordered loaders were checked after the last input.
3. The last flush returned `complete`, and no existing publication gate now holds.
4. The current input and window-operation generations match that completed pass.
5. The graph-output receipt registry is empty.

Only then resolve completion and remove that record. A public callback can add
input or change lifecycle before the tail returns; conditions 1–4 prevent its
earlier flush from completing newer work. A receipt fulfillment removes its own
entry and schedules a normal current-run graph turn to recheck these facts.
That turn may finish with no delta; it must not bypass loader checks or gates.

This is a receipt-aware publication checkpoint, not a call to `commit()` renamed
as visibility. A skipped flush leaves completion pending. A parked receipt
leaves it pending. Neither state needs a queued timer merely to wait. Existing
source/ordered settlement callbacks, receipt settlement, and explicit window
calls supply the next action.

Keep completion and the receipt registry out of `pendingOrderedLoads`,
`trackLoadPromise`, `isLoadingSubset`, source-recovery state, and initial-query
readiness. Those gates would make publication wait for the completion that
publication must establish. All-literal-true initial paths allocate no
continuation and retain their synchronous cut.

## 3. End terminal graph operations without waiting for an unanswered source

Add one internal `CollectionSyncManager.failLoadSubsetOperations(error)` method.
The manager already owns every current-run operation in
`loadSubsetOperations` (`collection/sync.ts:103`); do not add a second operation
registry to the builder. For each unfinished operation, this method:

1. Keeps its already recorded first error, or records the supplied exact error.
2. Clears its pending set, marks it completed, removes its manager entry, and
   clears the active-operation pointer when it points there.
3. Rejects its existing deferred waiter with that recorded error.

An operation whose `wait()` has not yet run still has zero pending entries and
the recorded error; the existing `wait()` path returns a rejected Promise
(`sync.ts:889`). Later source settlements see `completed` and do nothing
(`:902`). This ends operations; it does not abort acquisition signals, release
leases, report source errors, or declare provider success. Cleanup keeps its
existing AbortError precedence at `sync.ts:1163`; do not accidentally change it
to the first-error rule above.

On an exact-current **terminal resumed graph failure**, cancel the task, reject
completion, invoke this operation-failure method, and use the existing graph
crash classification. D2 failures already call `crashQuery` (`builder:869` and
`:1492`); a crash cannot produce a later successful graph result. Every current
window operation depends on that same crashed graph, so ending its operation
records is the correct owner boundary. A never-settling source peer can no longer
hide the graph error. Keep the failed completion associated with the crashed run
so a subsequent admitted window cannot return success; cleanup/new sync run
retires it. No in-place crash recovery is added.

Use the same operation-ending method for a resumed publication exception that
already fails the window's synchronous path. Preserve the existing exception
classification: a user subscriber exception is not automatically a source
failure or graph crash. Preserve its exact error and existing host reporting.
The existing window rejection callback restores requested/settled bookkeeping
(`builder:507`); a later permitted explicit retry may replace that failed
continuation. A receipt rejection in the exact current run follows the
establishing publication's failure path; cleanup/stale rejection acts only on
its discarded record.

Ordinary demand or ordered-load rejection is still a source participant failure,
not a new graph crash. Reject/invalidate the continuation fence from those
existing failure callbacks so it adds no new wait for a failed publication gate.
Retain the core operation's existing source-aggregation/error semantics and the
failed replay's publication hold. Only the terminal graph/publication path uses
the immediate operation-ending method above. This distinction prevents the new
fence from holding an already failed window forever without inventing a general
source fail-fast policy.

## 4. Exact receiving seams and cuts

The continuation scheduler does not exist in current production. The neighbor
author must mark its specific reaches UNREACHED until an accepted candidate
exists. Do not intercept all timers: Query Core and the driver have their own
task schedules. Later instrumentation must bind enqueue/run/completion to the
builder's exact continuation token and source identity. A narrow internal
scheduler function is an implementation option, not a new public API.

I sent `native_shutdown_receiving` the following required observations. They
supplement the existing ownership, synchronous, replay, and stale-run controls.

| Receipt/cut | Required comparison |
| --- | --- |
| Actual suspension accepted, answer microtask executed, last demand settled, continuation task not yet run | Existing window Promise remains pending; `getWindow()` and root/facade public result remain the prior settled snapshot. |
| New partial-options window requested in that same host gap | Admission succeeds; it returns a Promise, preserves inherited requested options, and cannot accept its window before the winning chosen result is visible. |
| First continuation runs, then another qualifying demand or tie/refill yields | Completion stays the same pending obligation; old and new operations cannot lose its attachment. |
| Loader-checked D2 quiescence with `flush = held` | No completion or window fulfillment. A later lawful source/ordered callback can run the graph even though no continuation task is queued. |
| `flush = complete`, establishing root or touched-facade receipt still parked | Promise remains pending while the exact visible result remains held; applying the selected receipt, with peers applied, admits completion only after the final revision/gate check. Include a prior queued output receipt. |
| Graph/publication fails on resume while another source participant never settles | The operation rejects with its existing first error, or the exact injected error when no earlier error exists; no success, stale window acceptance, or dependency on that peer's settlement. Keep crash versus subscriber-exception classification distinct. |
| Recoverable demand/ordered failure behind held replay | The new fence contributes no permanent extra wait; source failure and failed replay retention keep their existing meanings. |
| Cleanup/restart or reentrant lifecycle change in the triggering callback | Old task/receipt/operation callbacks cannot install, clear, mutate, or complete a replacement record. |

The draft controls must demonstrate the actual premise and checkpoint; an
unrelated timer turn, changed source rows, or callback that never runs supplies
no reach. Qualify baseline versus proposed-design outcomes separately. The new
early-window-success mutant must fail the window-publication comparison; the
original starvation behavior must fail the progress comparison after its actual
premise. Neither an OOM nor a setup exception earns either result.

This proposal selects internal owners and completion APIs. It leaves no
permanent-conflict policy, timeout, retry budget, or cache authority decision to
implementation. Its feasibility still needs actual pre-edit trigger reach,
qualified RED, receiving neighbors, then the same repaired GREEN and hostile
controls. No such execution is claimed here.
