# Queued-answer progress: successful tail and operation failure scope v5

Status: additive source-only correction following the independent v3 review,
`queued-answer-progress-completion-independent-review-v1.md`, SHA256
`535e962c79f983788b1f909ff2e5ca3859a7c45f295e03791f39178f918e04c7`.
Read this with v4's receipt sink, stable task owner, replaceable completion,
and receipt-disposal attribution. All predecessors remain unchanged. This
successor is a design proposal; it has not received independent final review.

No production, test, oracle, dependency, run budget, or campaign changed. No
runtime, install, receiving invocation, commit, push, or publication ran. Source
references use S at pinned main
`9cfa11fc712866f8f276e85762865ebb8bd49cbe`. The accepted finite-history
host-return law and existing window/publication authority remain unchanged.
Actual trigger reach and qualified product RED/GREEN/hostile-control evidence
remain required. This report grants no implementation or run approval.

## 1. Completion belongs only to a newly successful graph tail

V3 required a complete flush and matching generations. Those conditions alone
permit reuse of a previous successful pass if a later pass with unchanged
generations throws. A success check in `finally` could then resolve the fence
from that stale checkpoint while exposing the error separately.

Invalidate the saved successful-pass checkpoint before entering every new
graph turn and before any additional publication attempt outside that turn.
A pass becomes eligible only after its loader, publication, initialization,
and status tail finishes normally. `finally` clears `isGraphRunning`; it must
not create a success checkpoint or resolve completion. Run the final completion
check only on the normal successful path after that flag has unwound.

The final check still requires exact owner/current completion/run/config/state,
no queued task, drained D2, loaders checked after the last input, complete flush,
open existing publication gates, matching input/window generations, and no
unsettled required output receipts. The successful-pass checkpoint belongs to
that exact turn and current completion incarnation. Replacing a failed
incarnation starts with no successful checkpoint.

A receipt fulfillment removes only its entry and requests a normal fenced
graph turn. It cannot resolve the completion directly. If that new turn throws,
the old successful pass is already invalid, even when no input or window
generation changed. All graph-owned commit receipts still use applied
visibility, never `whenSyncAccepted`, whose earlier acceptance boundary serves
a different existing contract.

## 2. Distinguish graph-terminal failure from an affected publication failure

The independent review accepted manager-owned terminal operation settlement,
but correctly left v3's publication-exception scope open. A subscriber can throw
after state installation. Existing code still tries both root and facade
publication (`collection-config-builder.ts:1289–1303`), and the graph remains
eligible for a later explicit retry. Run identity alone does not make every
unfinished operation an affected operation of that publication.

Use the existing manager-owned operation Set and each operation's pending
participants to select scope. The internal API proposal is:

```ts
failLoadSubsetOperations(error: unknown): void
failLoadSubsetOperationsForParticipant(
  participant: Promise<unknown>,
  error: unknown,
): void
```

The first method remains reserved for a genuinely terminal current graph crash:
all unfinished operations of that graph have lost a possible successful result.
The second selects only unfinished operations whose existing `pending` Set
contains the captured current pending completion promise. It needs no builder
operation registry. Factor their common record-ending mechanics within the
manager rather than duplicating them.

For a retryable exception in a resumed publication/status tail, capture and
verify the pending completion incarnation and exact run identity. Invoke the
participant-scoped method **before** rejecting that completion promise, while
the selected operation records still contain it. Then reject/invalidate only
that incarnation and preserve the existing host exception reporting and
window-failure bookkeeping. The selected operations depend explicitly on this
failed publication obligation. They cannot be made to wait forever for an
unanswered source peer before observing its error. An unfinished operation
without that participant is not ended merely because its run matches.

The common manager mechanics preserve an already recorded first error, clear
that selected record's pending entries, mark it completed, remove it from the
manager Set, clear only a matching active pointer, and reject its deferred if
present. A later `wait()` reads its recorded error. Already completed records
and queued completion microtasks cannot resurrect or fail it again. This does
not settle an acquisition, cancel its signal, release its lease, clear source
loading sets, or report a source error. Cleanup keeps its separate AbortError
precedence.

An ordinary synchronous call before any suspension retains its existing
catch/cancel/throw path. A resumed tail with no captured pending completion
cannot invent a participant scope or fall back to fail-all. A stale old receipt
or rejected old completion is likewise no permission to select the new fence;
v4's exact attempt/target/disposal checks still apply. Ordinary source/ordered
rejection continues to use existing aggregation plus rejection of its own new
fence; neither manager operation-ending method becomes its general policy.

This narrows the new operation behavior to the dependency introduced by the
continuation. The proposed source mechanism must be tested at that receiving
boundary. It is not an executed proof of which older/superseding operations a
particular fixture actually attached.

Recheck exact lifecycle identity before operation fanout after any callback
that may retire or replace the run. A callback must never use a same-shaped
replacement run or a new completion incarnation to supply the missing scope.
Graph crash, retryable subscriber exception, ordinary source error, and expected
rollback disposal retain their separate meanings.

## 3. Required receiving distinctions

Add these controls to the frozen v1–v4 inventory. Their continuation-specific
reaches remain UNREACHED until an accepted candidate exists. No run is admitted.

| Proposed-design history | Required observation |
| --- | --- |
| Last required receipt settles; normal recheck then throws with unchanged input/window generations | No completion from the previous successful-pass checkpoint and no completion from `finally`. |
| Publication succeeds but a later initialization/status step in the same graph tail throws | The current pass supplies no success checkpoint; installed state alone does not silently fulfill the pending window. |
| Retryable subscriber exception after installation, with attached and unattached unfinished operations and an unanswered peer | Only records containing the captured pending completion are ended by the new scoped method; existing first error/exact exception is preserved, with existing host reporting and later explicit retry. |
| The completion observer is queued when scoped failure runs | Scope is selected before promise rejection/removal; late observers see completed records and do not change the outcome. |
| Terminal graph crash with the same operation mixture | Current-run graph-terminal settlement ends every unfinished record, including a record whose `wait()` has not run; no other run is touched. |

These design constraints resolve the two additional source omissions identified
by the frozen independent v3 review. Independent assessment of this successor
and actual pre-edit/repaired receiving evidence remain outstanding. No product
RED/GREEN, numerical deadline, broader Effect progress claim, or bug-class
closure is asserted.
