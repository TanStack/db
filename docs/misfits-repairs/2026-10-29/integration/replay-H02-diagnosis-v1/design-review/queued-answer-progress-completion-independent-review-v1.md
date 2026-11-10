# Independent review of completion ownership v3

This source-only review targets `queued-answer-progress-completion-api-v3.md`,
SHA256 `c53e3bf3767b0bff451d0c05541b31e0a5e51e569e039634a163f42f2803b0e1`.
It follows the v1 independent review and reads v2 as context. Source references
are relative to S:
`/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-progress-main-v1`,
at pinned main `9cfa11fc712866f8f276e85762865ebb8bd49cbe`.

No production, oracle, test, dependency, budget, or campaign changed. No runtime,
test, install, receiving invocation, commit, or publication ran. Only this report
was written. This review does not classify v7 or inherit a receiving result from
another report. V3's statements about missing runtime evidence describe its own
evidence at authorship, not a new classification by this reviewer.

## Verdict

**The proposed owners and APIs are viable. One receipt-handoff correction and
explicit same-run retry rules remain before the design is ready to implement.**

V3 closes the two v1 window-entry gaps in principle. Registering the same graph
completion with the operation active at suspension and with each newly admitted
window prevents both premature completion of an existing operation and literal
`true` from a newly admitted empty operation. A task marker controls permission
to execute; its completion Promise controls window settlement. Keeping these
lifetimes separate permits a quiescent but publication-held graph to resume on a
source callback without spinning timers or waiting on its own publication gate.

An explicit held/complete flush outcome is a small internal API improvement.
Operation-ending belongs in CollectionSyncManager, which already owns operation
records; the builder should not mirror that registry. D2 default callers and
the physical acquisition/lease model need no change for these completion APIs.

The concrete remaining gap is exception safety: facade receipts handed back
only by a successful `flush()` result do not cover accepted commits made before
that flush throws, or the restoring commits made by rollback. Exact sync-run
fencing alone also does not distinguish their later outcomes from a permitted
retry in the same sync run.

## A. Facade receipt handoff must survive a failed flush

The authority is existing coherent publication and atomic window publication,
not a new rule about provider completion. `SyncMethods.commit` returns `true`
when visible or a Promise for visibility (`packages/db/src/types.ts:462`). An
accepted sync transaction stays queued behind a persisting optimistic
transaction (`collection/sync.ts:407` and `collection/state.ts:1159`). Deferred
publication suppresses events but does not defer the normal state/index commit
(`collection/changes.ts:210`).

V3 proposes extending the successful `FacadePublication` return with its
establishing receipts. This misses a legal failure path:

1. Existing facade A has a persisting transaction; a flush writes A and accepts
   its parked sync commit at `bucket-facade-adapter.ts:151`.
2. A later facade write/commit throws. `flush` catches at `:159`, invokes
   `abort`, and throws without returning a `FacadePublication`.
3. `restore` writes the old A rows and accepts a restoring commit at `:338`.
   That receipt is also presently ignored.
4. The failed operation rejects, but an explicit later window retry is allowed.
   Its completion must not forget A's still-unsettled output/restoration work
   merely because the failed flush did not return.

The existing facade rollback grammar already includes held commits across
failed/restoring flushes (`bucket-facade-rollback-oracle.property.test.ts:87`–`:115`).
Its model and driver are at the adapter boundary and do not prove a live-query
window's new completion fence. The missing receiving comparison is completion
of the chosen live-query window while those accepted receipts remain parked.

The smallest correction is an internal nonthrowing receipt sink called
immediately after each returned commit receipt, for both forward facade writes
and restoration writes. Give the sink captured run/config/state identity. A
success-only return field can remain useful metadata but cannot be the sole
handoff. No second receipt registry is needed: use the builder's current-run
unsettled registry. Preserve the existing prepare/publish/rollback sequencing;
do not replace applied receipts with event deferral handles.

This is a demonstrated source-level omission in the proposal, not an executed
baseline production bug or a claim that a particular H02 fixture reaches it.
Waiting conservatively for older current-run graph-output receipts is not
itself a supported contract violation here. The review establishes neither a
new progress guarantee for unrelated retained facade holders nor a numerical
bound for their work.

## B. Attribute same-run receipt outcomes and failed-fence replacement

One run can contain several window attempts and recoverable publication
failures. The architecture explicitly permits a later explicit window move to
retry after failure (`ARCHITECTURE.md:1030`–`:1036`, `:1371`–`:1376`). Therefore
run/config/state identity is necessary but insufficient for receipt failure
delivery to a new completion record.

A failed flush can create a new facade, queue writes to it, and then dispose it
during rollback. State cleanup rejects its queued receipts
(`collection/state.ts:1647`). That is different from failure of an establishing
receipt still owed by the winning public result. A late rejection from this
discarded attempt must not fail the next same-run retry merely because the
builder's current run still matches. Do not infer this distinction from an
`AbortError` name: cleanup of a discarded facade and abandonment of the current
chosen result require different handling.

Use minimal origin metadata on the existing receipt entries: their publication
attempt/continuation identity and whether the owning facade/output obligation
was deliberately discarded by that attempt's rollback. Mark that disposition
before invoking disposal, which can reenter. Every handler removes only its own
entry. A still-accepted root write or retained facade restoration remains an
unsettled obligation until its receipt settles; a failed completion record does
not erase that registry. A deliberately disposed new facade is not a new
current-window failure. No new transport, acquisition, or row-ownership model
is warranted.

V3 says recoverable source failure rejects/invalidates the completion and a
later explicit retry may replace it. Specify the order: the permitted retry
must replace the failed operation fence before attaching to a new operation.
Otherwise it inherits the rejected Promise and cannot retry. A terminal crashed
graph keeps its failed fence until cleanup; this is a distinct case.

Replacing a failed fence while a task is queued must preserve host resumption
ownership. Copying an old task token into a new record is insufficient when its
callback captures and checks the old record identity: the callback becomes a
no-op and leaves the replacement locked. Either keep a stable execution owner
with an explicitly replaced operation attempt, or cancel/requeue a new exact
record/token while keeping immediate execution suppressed. The latter is a
small implementation option. Late old callbacks must not clear the new token.
Rejecting a source participant must not silently remove the host cut and allow
immediate scheduler feedback to resume it.

These are implementation constraints on v3's proposed retry path. No runtime
counterexample or new product behavior is asserted.

## C. Completion checks are sufficient with a successful-tail checkpoint

The held/complete result must reuse the existing gate predicate. In particular,
evaluate the gate before treating a no-delta flush as complete, without changing
whether existing code publishes data. Keep the continuation and receipt
registry out of `pendingOrderedLoads`, `trackLoadPromise`, `isLoadingSubset`,
source recovery, and initial readiness. Otherwise completion can wait for a
flush whose own gate waits for completion.

Capture the input/window-operation generations for the pass whose loaders and
flush actually completed. Invalidate that successful-pass checkpoint before a
new turn or failed publication attempt. A previous complete pass with the same
generations is not permission to resolve after a later tail throws. Run the
success check on the normal success path after `isGraphRunning` unwinds, never
unconditionally from `finally` after an exception.

V3's final checks then provide the appropriate local checkpoint: exact
record/run/config/state; no task owner; drained graph; loaders checked after the
last input; complete flush; no current hold; unchanged input/window generations;
no unsettled required graph-output receipt. Receipt fulfillment schedules a
normal fenced graph turn to recheck this checkpoint. It must not resolve the
completion directly or run loaders around pending sibling input.

Register root receipts before deferred root/facade subscriber delivery. Core's
immediately visible commit returns literal `true`; a parked transaction supplies
the visibility Promise. Do not use `whenSyncAccepted` for this window-visibility
obligation: acceptance intentionally precedes visibility for handler-facing
writes and readiness (`sync-receipt.ts:20`). Keep those other contracts intact.

The registry must observe graph-output commits before any suspension starts, as
v3 proposes. A continuation created later cannot reconstruct a lost earlier
receipt by testing the current root/facade contents. Remove settled entries and
retire the registry on cleanup; retain no settled history. Default literal-true
paths should incur no new host task or Promise completion barrier.

## D. Terminal graph operation settlement has an existing owner

`CollectionSyncManager` owns all unfinished load-operation records
(`collection/sync.ts:103`). Its current settlement path waits for every pending
participant (`:908`), so rejecting only the new completion cannot expose a
terminal graph error when another source peer never answers.

For a genuinely terminal current graph failure, v3's internal
`failLoadSubsetOperations(error)` is suitable and smaller than a builder-owned
operation map or per-caller race. For each unfinished record it can preserve the
already recorded first error, clear pending entries, mark completed, remove the
manager entry, clear the matching active pointer, and reject its deferred if
present. A later `wait()` observes zero pending plus its recorded error; late
source callbacks see `completed` and do nothing. Queued operation-completion
microtasks also already check `completed`. A completed operation is never
retroactively failed.

Call it only against the captured current run, with lifecycle reentry accounted
for. A graph crash cannot recover in place (`collection/lifecycle.ts:412`), so
all current operations on that graph have lost their possible successful result.
This ends operation bookkeeping; it must not clear source load sets, cancel
signals, release leases, synthesize success, or report another source error.
Keep cleanup's separate `AbortError` precedence unchanged (`sync.ts:1163`).

V3 also mentions using the same method for publication exceptions. Restrict that
statement to the actual affected operation/failure boundary. A subscriber throw
can occur after state was installed, without crashing the graph, and existing
code still attempts both root and facade event publication
(`collection-config-builder.ts:1289`–`:1303`). Do not promote every subscriber
exception to a graph-terminal failure or use it to end unrelated operation
records by run identity alone. If all outstanding operations are to reject from
that retryable publication exception, show the receiving history and its existing
window error authority; otherwise narrow the operation target. This is an open
scope decision in the proposal, not a confirmed existing production defect.

Ordinary demand/ordered rejection must retain the existing aggregation policy.
It may reject/invalidate the new fence so that fence adds no permanent wait;
it must not gain the graph-terminal fail-all policy. Preserve exact first-error
identity and existing uncaught reporting separately from operation settlement.

## Receiving cuts and remaining blockers

The v1/v2 inventories remain necessary. Add these cuts to v3's table rather than
replacing host progress with receipt or operation observations:

| Receiving history | Distinction the comparison must preserve |
| --- | --- |
| Facade A's forward commit is parked, later facade B throws, rollback accepts A's restoration, then a legal retry begins before those receipts apply | Exception-safe receipt handoff; retry remains pending for its retained applied obligations. |
| A newly created facade is disposed by rollback, its receipt rejects after a same-run retry has replaced the failed fence | Explicit disposal attribution; old rejection removes only its own obligation and does not reject the new attempt. |
| Recoverable demand/ordered/publication failure while a task is queued; retry before that task runs | Retry gets a fresh pending fence, never a previously rejected one; old task cannot strand or clear new resumption ownership; host cut remains real. |
| Last root/facade receipt settles, normal recheck pass then throws in its publication/status tail with unchanged generations | No completion from a stale successful-pass checkpoint or a success check in `finally`. |
| Terminal graph crash with never-answering peer, existing first error, operation whose `wait()` has not run, and queued completion microtask | Prompt rejection at the terminal boundary, exact applicable error, no success or resurrection from later callbacks. |
| Subscriber exception after installation, with older/superseding operations | Existing exception classification and the affected operation scope; do not assume graph-terminal semantics. |

There is no fundamental source/API blocker to the narrow continuation repair.
The remaining concrete design work is the exception-safe receipt sink, same-run
disposition/retry rules, and the nonterminal publication-exception operation
scope. The implementation should keep these in the existing builder, facade,
and SyncManager owners. This review adds no numerical deadline, retry budget,
permanent-conflict outcome, new cache authority, or broader Effect guarantee.

Only actual pre-edit and repaired receiving evidence can establish the product
result. The proposal counterexamples and source checks in this report are not
RED/GREEN, reach counts, or hostile-mutant rejections.

## Additional source identity

The source hashes in the independent v1 report continue to identify the builder,
D2, subscriber, loader, and SyncManager. Additional inspected sources:

| Source | SHA256 |
| --- | --- |
| `packages/db/src/query/live/bucket-facade-adapter.ts` | `7aae32f2a4d5aad783fe84bfde78073bac0c526ea7a9615b3ce285360e43b6bc` |
| `packages/db/src/collection/changes.ts` | `3a8878ab58df162f8108c5cdd6470562af7e6ed65a7b3e720f6b329bc0378628` |
| `packages/db/src/collection/state.ts` | `932dac87a91546169b25c5300d041a7f3e3247779646aec15301e003c33935c8` |
| `packages/db/src/sync-receipt.ts` | `5ab4074603d96c23decd4fae499ed55f3a6ee5077e379f370d9b76fd90565399` |
| `packages/db/src/collection/lifecycle.ts` | `0aee449fa231215d8d3d086e1e37e761f332c75a6cae50fabd3101ed057a84b7` |
| `packages/db/src/query/live/types.ts` | `2bf32bbb3eba980f720dee5db19a657f378cbf92e9538a17a5cf1a77c6f3ea3c` |

The author received the receipt-handoff and same-run attribution observations
during this review and is preparing an additive successor. This report reviews
the frozen v3 bytes above; it does not independently approve that successor.
