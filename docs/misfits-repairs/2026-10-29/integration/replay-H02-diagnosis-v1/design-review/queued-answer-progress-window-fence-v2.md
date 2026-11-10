# Queued-answer progress: window fence v2

Status: additive source-only correction to
`queued-answer-progress-source-design-v1.md`, whose bytes remain unchanged.
The v1 report remains useful for its causal boundary, narrow suspension trigger,
and neighboring-law inventory. Its continuation design is incomplete: suppressing
graph execution without participating in window settlement can report success
before the chosen window is visible. This is a counterexample to the proposal,
not an executed defect result on unchanged production.

All source references below use the same pinned S worktree and main commit as
v1. The independent `ordered_traversal_design` reviewer identified the window
counterexample. I independently inspected the cited source and coordinated the
revision directly with that reviewer. No production, oracle, test, dependency,
budget, or campaign changed. No runtime, receiving invocation, install, commit,
push, or publication ran. No production edit or next receiving run is admitted.

## The missing operation boundary

In `packages/db/src/query/live/collection-config-builder.ts`:

1. `setWindow` begins a load operation at `:451`, calls the graph, then waits for
   the operation at `:492`.
2. Under the v1 candidate, the graph suspends with pending work. Its queued host
   task suppresses synchronous graph execution until that task resumes.
3. A queued backend answer can settle the demand before the host task runs.
   `settleDemand` at `:563` calls the suppressed graph callback at `:568`, then
   resolves the demand participant at `:569`.
4. `packages/db/src/collection/sync.ts:903` removes that last operation
   participant. Its microtask at `:913` completes the operation, before the
   graph-continuation task runs.
5. The window continuation at builder `:499` accepts `settledWindow`, even
   though the graph remains unfinished and the public result remains retained.

There is a second entry path. During the asynchronous gap,
`isGraphRunning` is false and `activeWindowOperation` has been restored by
`:489`. A new `setWindow` can pass the reentrancy guard at `:382`, change top-K,
and see no tracked load. Its `wait()` can return literal `true`
(`sync.ts:889`), accepting the window at builder `:494` while graph execution is
still suppressed.

Architecture's atomic-window-publication law requires the window promise to
wait for the completed chosen window. The fix cannot redefine demand settlement
as graph publication, or extend synchronous `SetWindowReentrancyError` into this
otherwise legal asynchronous interval without a contract decision.

## Smallest revised continuation design

Add one **graph-continuation completion participant** to the builder-owned
continuation record. It means that graph work which crossed the host boundary
has reached its required publication checkpoint. It is neither an acquisition
lease nor a successful subset-load result.

- Create and register its Promise synchronously when suspension is accepted,
  before returning control. Attach it to the active load operation with the
  existing `trackSubsetLoadOperationPromise` path (`builder:648`,
  `sync.ts:943`). Demand settlement can then keep its existing meaning and
  timing without draining the operation's pending set.
- After `beginLoadSubsetOperation` in every newly admitted `setWindow`, attach
  the current continuation participant before changing top-K or testing
  `wait()`. Keep asynchronous window admission legal. The existing request and
  window-operation generations continue to choose the winning request; older
  requests retain their existing join of `latestWindowRequest`.
- Keep one participant through repeated suspensions of that drain. A task
  being queued and the participant being incomplete are different facts.
  Suppress immediate graph execution only while its host task owns resumption.
  If the graph becomes quiescent but another publication gate still waits,
  later source callbacks must be able to run it and finish publication.
- Resolve only after loader-checked graph quiescence and the normal successful
  publication checkpoint for the current chosen window. A timer firing,
  `pendingWork() === false`, a settled demand, or an empty publication attempt
  is not that checkpoint. A publication gate that still holds is not success.
- Preserve v1's sync-run/config/state fences. Cleanup cancels the task and
  rejects the unfinished completion with the existing abort semantics. A late
  task must not resolve or clear a replacement run's completion.

Register this Promise **only as an operation participant**, not through
`trackOrderedLoadPromise`, `trackLoadPromise`, or another publication/readiness
gate. In particular, `pendingOrderedLoads` blocks the flush at builder `:1211`.
A participant that blocks publication and resolves only after publication would
wait for itself. Initial-query readiness already requires the graph to have no
pending work (`:1471`); the new participant must not enter a gate whose condition
is needed to complete it.

This adds one completion obligation to the already proposed continuation owner;
it does not add retry limits, cache authority, or another ownership state machine.
All-literal-true synchronous initial chains create no suspension participant.
Ordinary synchronous changes outside the existing hold remain on v1's unchanged
path.

## Publication and terminal errors still need an exact implementation

The completion cannot simply resolve after `flushPendingChanges()` returns.
That method can return while a gate holds. The root flush also calls `commit()`
at builder `:1279` without retaining its applied receipt; deferred publication
callbacks finish at `:1301`. A receiving history must establish whether the
chosen window is actually visible at the proposed completion point. If its root
transaction can remain queued, the new completion needs that existing applied
receipt as well. This is not authority to add priority to a queued transaction.

On graph or publication failure, reject the new completion with the exact
failure, preserve the prior public result, and end the affected operation under
the existing error contract. Rejection of this participant alone is not yet a
complete design: `sync.ts:908` still waits for other pending participants.
`crashQuery` at builder `:1492` and `lifecycle.ts:418` set crash state; they do
not themselves establish rejection of every outstanding window operation.
A never-settling source peer must not conceal a terminal graph failure. The
smallest way to end the affected operation without misclassifying source loads
remains an implementation question before approval. Cleanup's existing abort of
operation records (`sync.ts:1163`) is evidence for cleanup, not this crash path.

## Additional pre-edit receiving cuts

These supplement, rather than replace, v1's receiving inventory. Prepare and
review them before a production edit; no run is admitted by this report.

| Actual receiving history | Required observation and wrong repair rejected |
| --- | --- |
| Window operation causes the declared suspension; the queued answer settles its last demand in a microtask before the host continuation runs. | Before resumption, window promise stays pending, `getWindow()` stays settled, and retained rows/events stay unchanged. Rejects demand-only settlement and resolving completion when the task is merely queued or fired. |
| In that gap, call another legal `setWindow` after its needed demand has already settled, including partial options. | It is admitted without a new reentrancy error, returns a pending Promise, and publishes the winning requested window before fulfillment. Rejects the literal-true empty-operation path and a blanket suspended-state reentrancy guard. |
| Resume once, discover a tie/refill or changed lazy demand, and suspend again. | Original and superseding operations remain pending through the continuous graph completion. Compare exact final rows/order, events, and settled window. Rejects resolving a per-task participant before the whole chain and losing the superseding operation's attachment. |
| The graph drains but replay/ordered publication still holds; separately hold the output root's establishing applied receipt if reachable. | No operation fulfills at the skipped flush or before visible chosen rows. Rejects treating graph quiescence, commit acceptance, or a returned flush as publication. |
| Cleanup/restart, newer truncate, source failure, graph failure, or publication failure occurs while suspended; retain a never-settling peer in the terminal-failure cell. | Exact abort/error reaches the affected operation, no obsolete completion changes the new run, and no partial result publishes. Rejects success-on-cancel, orphaned operation waits, stale completion, and failure hidden by aggregation. |

The publication and operation laws stay with the ordered-lifecycle and
layered-publication owners named in v1. The host/Query Core composition remains
the H02 receiving gap. The same model, histories, and comparison must run before
and after a proposed production repair. Require the original behavior and the
early-window-completion wrong repair to fail at their intended checkpoints.

This successor closes a source-design omission only. It supplies no executed
RED, GREEN, reach count, mutant rejection, or bug-class closure. Exact hold
reach, receipt-aware publication completion, terminal graph-failure settlement,
and actual host ordering remain unresolved implementation/receiving questions.
