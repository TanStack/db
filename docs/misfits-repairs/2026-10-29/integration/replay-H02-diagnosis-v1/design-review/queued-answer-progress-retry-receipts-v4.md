# Queued-answer progress: retry and exception-safe receipt ownership v4

Status: additive source-only correction to v3, prompted by independent review.
V1, v2, v3, and the independent v1 review remain frozen. This report changes no
production, test, oracle, dependency, run budget, or campaign. No runtime,
install, receiving invocation, commit, push, or publication ran. This proposal
still lacks actual trigger reach, qualified pre-edit product RED, repaired
GREEN, and hostile-control evidence. It grants no implementation or run
approval. The reviewer has identified these gaps in v3; this correction has not
yet received a final independent review.

Source references use S at pinned main
`9cfa11fc712866f8f276e85762865ebb8bd49cbe`, as defined in v1. These are
proposed-design counterexamples, not newly executed baseline product findings.
The accepted finite-history host-return law, cached ownership, atomic
publication, and the absence of a numeric deadline or permanent-conflict
policy remain unchanged.

## 1. Register each returned receipt before the next fallible phase

V3 proposed returning facade receipts on `FacadePublication`. That is
insufficient. In `bucket-facade-adapter.ts`, facade A can commit at line 151
before facade B throws. `flush()` then calls `abort()` and throws without
returning a `FacadePublication`. Restoration itself commits at line 338, also
without exposing its receipt. A root preparation or commit failure can instead
invoke the returned `rollback()`, which has the same restoration path.
Accepted parked writes survive discarded publication notifications; their
application obligations cannot disappear with a thrown flush.

Replace v3's successful-return receipt field with an internal receipt sink.
Invoke it immediately after each graph-owned root or facade `commit()` returns,
before advancing to another facade, preparation, root phase, or publication
callback. This includes facade restoration commits and graph-owned root
initialization commits, as well as ordinary root output and reload snapshots.
Literal `true` contributes no pending obligation. The sink itself records a
receipt and installs observers; it must not invoke user callbacks, run the
graph, or throw as part of ordinary registration. It is not a new public API.

There is still one builder-owned registry of unsettled receipts for the current
sync run. Exception paths do not replace or clear it, and replacing a failed
completion promise does not clear it. Register receipts before a continuation
exists too, as v3 required. A later permitted explicit retry can therefore
observe an accepted write from a failed publication attempt even when its own
flush has no new delta for that facade. All retained root and facade writes and
their retained-facade restoration receipts remain completion blockers until
their own obligations settle. A discarded notification is not an applied
receipt settlement.

This changes observation plumbing, not the synchronous prepare/publish/rollback
sequence, commit order, accepted writes, leases, or queue priority. V3's explicit
`held`/`complete` flush result and final graph/gate/generation/receipt check
remain required. A successful return alone still does not establish visibility.

The sink records returned receipts. A synchronous commit throw provides no
returned receipt to harvest. It follows the existing failure and rollback path;
this proposal does not claim to repair arbitrary partial core state application
or classify every possible core exception as recoverable. The qualified
exception controls must use a stated production boundary rather than assume
all throws have the same receipt behavior.

## 2. Keep the task owner stable when replacing a recoverably failed fence

V3's phrase "replace that failed continuation" is too coarse. Replacing its
whole record while a host task is queued would invalidate that task's captured
owner; attaching the old rejected promise instead would make every retry fail.

Use one stable current-run progress owner with these independently identified
parts:

- The run/config/state identity and optional exact host-task token.
- A current completion incarnation with its own identity, deferred promise,
  and pending, failed, or completed disposition.
- The successful-pass input/window generations used by the final check.

There is at most one current completion incarnation. Repeated lawful yields
keep the same pending incarnation, so existing operations retain their one
obligation. A recoverable source/ordered or publication failure rejects that
incarnation. An admitted explicit retry replaces the recoverably failed
incarnation with a fresh pending incarnation **before** attaching it to the
new operation and before window effects can settle that operation. Old promise
observers keep the rejected old promise. A fatal crashed run keeps its failed
incarnation; only cleanup/new run permits a new one.

The queued task token belongs to the stable progress owner, not to the old
completion incarnation. A retry preserves that token and its scheduler barrier.
The callback checks exact owner/token/run/config/state identity, clears only
its own token, and executes a fresh current graph turn. It then uses the current
completion incarnation. Immediate scheduling cannot enter D2 while that token
is present. Merely receiving a retry does not cancel the task and reopen
synchronous graph entry before host return. This design therefore needs no
token transfer between replacement record objects.

With no queued token, a pending completion remains an obligation rather than
an execution lock: existing source/ordered callbacks and explicit window calls
can run the graph. An old completion handler can never clear or settle the new
incarnation. After the normal completion checkpoint, remove only the exact
successful incarnation/owner; the run's unsettled receipt registry has its own
lifetime and remains available for later suspensions.

This preserves v3's ordinary source-failure aggregation and failed replay hold.
It does not turn a recoverable source rejection into immediate operation
fanout or graph crash. It also preserves existing partial-options inheritance,
window request generations, and synchronous reentrancy guards.

## 3. Attribute receipt settlement within a sync run

Run/config/state fencing alone is insufficient for receipt failures. A failed
publication can create a facade, enqueue a parked commit, and then roll it back.
`restore()` disposes entries absent from its prior snapshot. That expected local
disposal can reject the parked receipt after a same-run explicit retry begins.
An old observer must not fail the retry solely because its sync run matches.

Each entry in the single unsettled-receipt registry therefore also identifies
the publication attempt and its target/disposal scope. This is metadata on the
existing entry, not a second receipt or operation registry. Forward and restore
commits to a retained facade remain live obligations. For a facade newly
created by a failed attempt and explicitly disposed by rollback, mark its
attempt's disposal scope before invoking `dispose()`. That explicit transition
identifies an expected abandoned-target settlement. Do not infer it from an
`AbortError` name, from a later map lookup, or from the mere fact that a newer
window exists.

Every observer first settles/removes only its own registry entry. An expected
rollback-disposal rejection may recheck the current completion after its own
entry is removed, but cannot reject the new incarnation, fan out operation
failure, or crash the current graph. It does not declare that the abandoned
transaction applied successfully. The live retry still needs its own complete
publication and all retained obligations settled. The scope is narrow: it
cannot retire root receipts or receipts for retained facades simply because an
attempt failed or a newer request superseded it.

Unexpected rejection of a still-live target remains a publication failure to
classify at its actual owner boundary. Its observer must not blindly invoke
current-operation failure using run identity alone. It must verify the receipt's
attempt/target relation to the current obligation and lifecycle before acting.
The receiving design must distinguish this case from expected rollback disposal
and stale-run cleanup. This proposal does not grant blanket permission to ignore
old-attempt errors.

V3's internal manager-owned operation failure method remains appropriate for
an exact-current terminal resumed graph/publication failure. Recheck identity
before and after callbacks that can change lifecycle; do not fan out into a
replacement run. Preserve first-error semantics for this terminal method,
existing cleanup AbortError precedence, and graph-crash versus user-subscriber
exception classification. Do not use this method for ordinary source rejection.

## 4. Additional required source controls

These are receiving requirements only. Their continuation-specific reaches
remain UNREACHED until an accepted candidate exists; no run is admitted here.

| Proposed-design history | Required observation |
| --- | --- |
| Facade A returns a parked receipt; later facade B throws before `flush()` returns | The single registry has A's accepted obligation despite no returned `FacadePublication`; a permitted retry cannot finish while retained obligations remain parked. |
| Root preparation/commit fails after facade commits; rollback enqueues retained-facade restoration | Both forward and restoration receipts are observed immediately, and a no-new-delta retry cannot bypass their settled visibility checkpoint. |
| Recoverable fence fails with a continuation task still queued; new partial-options window arrives before dispatch | The new operation receives a fresh pending completion incarnation; the same task token still blocks immediate D2 entry until its host callback. |
| Old completion rejection observer runs after that replacement | It changes neither the current incarnation nor its task token and does not reject the retry. |
| Rollback disposes a facade created only by the failed attempt; its receipt rejects after retry starts | The explicit abandoned-target disposition removes only that receipt obligation; it neither reports application success nor fails the new operation. |
| Same-run retained target has an unexpected receipt rejection | The receipt's attempt/target/lifecycle attribution selects the actual failure path; it cannot be dismissed merely as old or sent indiscriminately to all new operations. |
| Terminal failure callback causes cleanup/new run before operation fanout | Identity fencing prevents failure, cancellation, or completion of replacement-run operations. |

The original v1/v2/v3 controls still apply, including actual narrow trigger
reach, full-operator stopping, no-pending-work tail, operation-only attachment,
held/no-delta publication gates, prior queued output, root and child visibility,
repeated yields, newer window selection, first-error behavior with an unanswered
peer, stale lifecycle fencing, ownership retention, and all-synchronous controls.
No product RED/GREEN or bug-class closure is claimed by this source correction.
