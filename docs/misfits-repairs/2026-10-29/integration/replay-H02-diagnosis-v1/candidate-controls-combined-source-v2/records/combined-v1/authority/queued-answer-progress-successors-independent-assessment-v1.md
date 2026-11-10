# Final source assessment of queued-answer progress v4 and v5

This assessment reviews the frozen additive successors:

- `queued-answer-progress-retry-receipts-v4.md`, SHA256
  `9d11de5a62098008f4797ab0bdf76649726bcea237402a87de23437033464b59`.
- `queued-answer-progress-success-tail-scope-v5.md`, SHA256
  `b8d6170ed3f2b83bcaf993f71f3a52756983359b7ce77c3c9cb02f4e168c1eb8`.

Source is S at pinned main `9cfa11fc712866f8f276e85762865ebb8bd49cbe`, as
identified and hashed in the two preceding independent reviews. This is source
assessment only. No production, oracle, test, dependency, budget, or campaign
changed; no runtime, test, install, receiving invocation, commit, or publication
ran. Only this report was written. Runtime statements in predecessor documents
describe their evidence at authorship; this report does not reclassify v7.

## Verdict

**V4 and v5 answer the concrete source/API blockers identified in the independent
v3 review. The narrow continuation design is feasible for implementation under
the constraints below. No additional architectural or ownership redesign is
required by these reviewed seams.**

This is not product closure or independent approval of receiving results. The
implementation still must preserve the accepted finite-history host-return law,
cached ownership, coherent publication, qualified synchronous cuts, existing
error classification, and operation admission. It introduces no deadline,
permanent-conflict policy, cache authority, or Effect progress guarantee.

| Reviewed blocker | Successor answer | Assessment |
| --- | --- | --- |
| Facade commits accepted before a later phase throws never reach a successful return value | V4 hands each returned receipt to a sink immediately, including forward, restoration, root, and initialization commits | Covers the exception path without another registry or changed commit order. |
| Old rollback-disposal rejection can poison a retry in the same run | V4 records attempt/target scope and explicitly marks disposal before disposing a newly created facade | Correctly distinguishes abandoned target from retained applied obligation; run fencing alone no longer selects failure scope. |
| Replacing a failed completion strands an old captured task or reopens immediate feedback | V4 keeps the run owner/task token stable and replaces only the recoverably failed completion incarnation before operation attachment | Preserves host resumption ownership and permits legal asynchronous-gap retries. |
| A stale successful pass or `finally` can resolve after a later throwing tail | V5 invalidates before each attempt and creates success only after the normal whole tail returns | Removes the false-success path, including unchanged input/window generations. |
| Retryable subscriber failure is sent to every operation by run identity | V5 selects manager records containing the captured pending fence before rejecting it; terminal graph crash alone uses fail-all | Selects the dependency actually introduced by suspension, without duplicating operation ownership. |

## Implementation constraints

The following are concrete constraints on the selected design, not requests for
another design draft.

1. **Keep the original narrow trigger and complete-operator stop.** Capture the
   existing hold before demand effects; require changed Promise-returning demand,
   synchronous input feedback, and actual remaining work. Keep the stop latch
   local and sticky within the current D2 call. A stop request with no remaining
   work proceeds to normal loaders and publication. Default D2/Effect execution
   remains a full drain.
2. **Use one stable run owner.** Its generation/config/state and task token fence
   execution. Its current completion incarnation fences operation settlement.
   A retry replaces a recoverably failed incarnation before attaching it to the
   new operation, preserving the queued token. A fatal crashed run retains its
   failure until cleanup. An old completion handler changes neither the new
   incarnation nor task token.
3. **Register only operation participation.** Attach the pending completion at
   suspension and immediately after a newly admitted window begins its Collection
   operation. Do not add it or the receipt registry to source/ordered/readiness
   publication gates. Retain legal asynchronous-gap `setWindow` admission,
   partial-options inheritance, and existing window generations.
4. **Make receipt handoff exception-safe.** Invoke the nonthrowing internal sink
   immediately after every returned graph-owned commit receipt and before the
   next fallible phase. Include restoring writes, and register receipts before
   any suspension exists. Preserve accepted writes and ordinary FIFO application.
   A commit that throws supplies no returned receipt; retain its actual existing
   failure/rollback classification rather than inventing one.
5. **Keep one unsettled registry with explicit disposition.** Every handler
   removes only its own entry. Mark rollback disposal before calling disposal.
   Only a facade created and explicitly discarded by that failed attempt gets
   the abandoned-target treatment. Root writes and retained-facade restoration
   cannot disappear merely because a newer window or completion exists. Do not
   infer abandonment from an error name. An unexpected live-target rejection
   must follow its actual attempt/target/lifecycle relation, never a blanket
   old-error exemption or current-run fanout.
6. **Complete from a new successful whole tail.** Invalidate any previous
   checkpoint before each graph/publication attempt. After the normal loader,
   flush, initialization, and status tail returns and `isGraphRunning` unwinds,
   require exact owner/incarnation/run identity, no queued task, graph quiescence,
   loader checks after the last input, complete rather than held flush, open
   existing gates, unchanged input/window generations, and all required output
   receipts settled. `finally` never declares success. Receipt fulfillment
   requests a normal fenced turn; it does not resolve completion directly.
7. **End operations through their existing manager.** Factor common ending
   mechanics inside CollectionSyncManager. Terminal graph failure selects all
   unfinished current-run records. A retryable resumed-tail failure selects only
   records whose pending set contains the captured current pending fence, and
   selects them before rejecting that fence. Preserve recorded first error,
   cleanup's separate AbortError precedence, and late-callback no-op behavior.
   Do not settle acquisitions or use either method as a new ordinary source
   failure policy.
8. **Fence callbacks before mutation.** Check captured identity before installing
   an owner after demand callbacks, before task-marker clearing, and before
   operation fanout after lifecycle reentry. Old tasks/receipts/completions must
   not use a replacement owner, state, or incarnation to supply missing scope.
   Preserve exact host exception reporting separately from operation rejection.

The source supports these owners: D2 owns its private operator state; the
builder owns graph/publication completion; the facade adapter exposes its exact
commit obligations and explicit rollback disposition; CollectionSyncManager
owns operation records. The design adds no cache or acquisition state machine.

## Evidence obligations

Applicable baseline receiving observations can run on unchanged production.
They include the actual finite custom-cache history, ownership/reacquisition,
qualified all-literal-true initial loading, ordinary synchronous mutation cuts,
failed replay retention/retirement, and cleanup/restart. This source assessment
does not require a future continuation token or suspension seam to exist in that
baseline, and an absent candidate-specific seam is not a failed baseline product
comparison.

Prepare candidate-specific controls against the exact proposed owner/token and
receiving boundary while those applicable baseline cuts run. After the candidate
exists, measure its declared reaches separately. The key additional observations
remain:

- Both existing and newly admitted window operations stay pending through the
  pre-task answer-settlement gap; repeated yields retain their obligation.
- Failed/held no-delta flushes and parked prior root/facade/restoration receipts
  cannot count as completion. Forward-plus-restoration receipt handoff survives
  a later facade or root failure.
- Explicit rollback disposal followed by a same-run retry removes only the old
  target obligation; a retained target's failure receives its real classification.
- A failed completion is replaced before new attachment while the stable task
  owner preserves host return. Old token/incarnation callbacks cannot strand,
  clear, fail, or complete the replacement.
- Receipt-driven recheck followed by a throwing tail cannot use an old success
  checkpoint. Subscriber exceptions retain their classification and select
  attached operations; terminal graph crash ends all unfinished current-run
  operations despite an unanswered peer, including an operation not yet waiting.
- Root/facade installed reads, callbacks, downstream results, settled window,
  readiness/health, and one-shot releases remain correct at their stated cuts.

The original starvation behavior must be rejected at the actual progress
comparison; early-window success must be rejected at window/publication
comparisons. Candidate-specific fault controls need their own reached premise.
Neither setup failure nor resource termination supplies those results.

No further source-design blocker was found in v4/v5's answers to the reviewed
completion gaps. Remaining work is implementation and behavioral evidence within
the authorized gates. This report supplies no runtime RED/GREEN, reach count,
mutant rejection, universal termination proof, or bug-class closure.
