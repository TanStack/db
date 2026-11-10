# Independent review of queued-answer progress source design v1

This is a source/design review of `queued-answer-progress-source-design-v1.md`
(SHA256 `2ccabce4a8c8107f749495b96c918914059e031e77bb54861d9e8aa9e09d68cf`).
It reviews that version, not its subsequent window-fence revision. The reviewer
used source worktree `S` at
`/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-progress-main-v1`,
pinned main `9cfa11fc712866f8f276e85762865ebb8bd49cbe`. References below are
relative to S. No production, oracle, test, dependency, budget, or campaign was
changed. No runtime, install, test, receiving invocation, commit, or publication
ran. The only edit for this review is this report.

## Verdict

**Conditionally feasible, with one required completion revision.** An opt-in
stop after a complete D2 operator reaches the causal drain that an outer
scheduler change cannot interrupt. Keeping ownership and demand replacement
unchanged is the smallest supported repair location. The proposed trigger is
narrow enough to preserve literal-true initial loading and ordinary synchronous
neighbors by construction, provided it is reached in the actual finite
queued-answer history. That reach remains unproved.

V1's instruction to skip window completion is necessary but insufficiently
specified: window completion also happens outside the graph-run tail. Suppressing
graph runs until a host task runs can allow demand settlement to complete a
window operation while its graph work and publication remain unfinished. An
explicit operation fence is required. This is a source-supported counterexample
to an incomplete implementation of the proposal, not an executed production RED.

The accepted progress law is host return for the reproduced legal finite
custom-cache history, preserving ownership and coherent publication. It supplies
no numerical deadline, universal performance bound, or outcome for permanently
conflicting caches. V6's resource-limited prefix supplies none of those missing
results, and no allocation cause is established here.

## The complete-operator boundary works for this causal path

`D2.run` (`packages/db-ivm/src/d2.ts:59`) repeatedly visits pending operators;
work sent to an earlier operator can keep that loop running. A builder scheduler
change made only after this call returns cannot release that stack.

The feedback enters through a compiler demand tap. Its `run` is inherited from
`LinearUnaryOperator` (`graph.ts:126`): it obtains a finite drained message array,
invokes the tap for each message, and forwards each message. `drain` (`graph.ts:19`)
copies and clears the queue. Input created by demand callbacks is queued for a
later visit. Stopping after the entire tap `run` therefore leaves a coherent
operator result and retains all newly queued input. Stopping inside a callback
or between that callback and its forwarded message would not have that property.

The builder's final output callback only accumulates deltas
(`collection-config-builder.ts:1162`); public root and facade installation occurs
in the later flush. This supports retention across a host cut. It does not prove
that an arbitrary user callback or arbitrary operator terminates, and the design
must not make that broader claim.

The D2 result must distinguish **a requested stop** from **actual suspension with
remaining work**. If the completed last operator leaves `pendingWork() === false`,
the builder must perform its ordinary loader check and completion tail. A stop
request alone cannot skip the tail or queue a task. If a loader then adds input,
the builder drains that input before another loader decision or publication.
This preserves the graph-wide ordered-continuation law at
`ARCHITECTURE.md:1652` and coherent publication at `:1665`.

## Required revision: graph work must participate in window completion

The authority is “Atomic window publication” (`ARCHITECTURE.md:1366`): a window
operation must not report success until its chosen window is visible. The
glossary also separates acquisition settlement, graph work, and publication;
one does not establish the next.

The existing paths explain the gap:

1. `setWindow` begins a Collection load operation at
   `collection-config-builder.ts:451`, and its `wait()` decides whether it
   returns `true` or a Promise (`:492`).
2. A Promise-returning lazy demand creates and registers a participant
   (`beginDemand`, `:534`–`:550`). A graph suspension retains pending D2 work
   and gives the host task exclusive permission to resume it.
3. The already queued answer can settle before that task. `settleDemand`
   (`:563`–`:574`) schedules graph work and then resolves the demand participant.
   Under the proposed exclusive-owner guard, that graph call returns without
   processing the retained input.
4. Once existing operation participants finish, Collection's
   `settleLoadSubsetOperation` (`packages/db/src/collection/sync.ts:897`–`:922`)
   schedules completion in a microtask. That microtask can run before the host
   task. The `setWindow` success callback then advances `settledWindow`
   (`collection-config-builder.ts:499`–`:507`) while the old snapshot is still
   public.

The legal counterexample schema is an ordered operation whose remaining source
participants finish during this gap, including a demand that was created by the
operation. It needs an actual receiving witness; source inspection alone does
not establish that a particular H02 fixture reaches it. The existing source
participants cannot be assumed to cover the new host suspension interval.

A second admission cut matters. Between suspension and the task,
`isGraphRunning` is false. A new `setWindow` can pass the current guard (`:383`),
and, after the earlier demand settles, its operation can have no registered
participants. If its graph run is suppressed, `wait()` may return literal `true`
without computing that window. Adding an asynchronous-gap reentrancy error
would change accepted admission behavior without an authority in this review.

The smallest revision is one sync-run-fenced **graph-continuation completion
participant**, registered with the current Collection load operation before
returning suspended and with every window operation admitted while that
continuation remains unfinished. It represents retained graph work, not a source
acquisition or applied receipt. The task-queued marker and completion participant
need separate lifetimes: clearing the queued-task marker permits a resumed turn;
it does not establish completion. Repeated yields must retain the participant.

Resolve it only after loader-checked graph quiescence and the normal successful
publication completion point; define how a withheld or queued publication reaches
that point. A returned `commit()` call is not, by itself, proof of visible writes.
Keep it out of `pendingOrderedLoads`, source-recovery flags, and the
`isLoadingSubset` publication/readiness gate: otherwise the participant can block
the very flush that must finish it. Use operation-only registration. Cleanup must
reject it with the existing operation abort semantics, and graph failure must
reject affected operations rather than leaving a successful or indefinitely
pending completion behind. Failure with another participant that never settles
requires an explicit receiving cut, not just an unhandled-error check.

## Continuation ownership and publication checks

The continuation must belong to one captured sync-run generation, config object,
and sync-state object. Capture those identities around the demand callback as
well as around the task. A callback can synchronously clean up or restart a
query; its returned demand result must not latch a stop or install a continuation
for the replacement graph. Create the owner only after checking the captured
run again. A stop request should be local to the current D2 call and sticky
within that call: a later unchanged, empty, or literal-true demand update must
not erase an earlier qualifying request.

The scheduler guard is necessary. `Scheduler.flush` removes a job before running
it (`packages/db/src/scheduler.ts:128`), so a reentrant schedule is a new job that
the same flush can execute. Without an exclusive queued-task owner, repeated
callbacks can resume the graph before the host gets control. Old scheduled jobs
must also use exact config/state fencing, not merely the presence of some current
state. A stale task must check its own token before clearing any marker; matching
only the builder identity permits it to clear a replacement run's task.

While actually suspended, pending graph work remains true. Source status and
loading callbacks reach `updateLiveQueryStatus`, but `isResultComplete`
(`collection-config-builder.ts:1453`) checks graph pending work. The only
other direct flush path is reload completion through that same completeness
check. Thus the reviewed source has no independent root/facade flush path that
obviously bypasses the suspension. Retain that property and skip the entire
runner tail, including empty initialization commits. Do not carry the old
transaction/publication context through the host task.

Downstream scheduler jobs may run after the suspended job returns and observe the
upstream's retained public snapshot. This is not alone a coherence violation:
the layered publication owner explicitly permits layers to notify at different
times (`includes-publication-oracle.test.ts:44`). The required receiving cut is
that each layer's installed reads, callback payloads, and downstream observations
remain coherent, including another source changing during the suspension.

## Trigger and neighboring paths

The trigger must sample the existing publication hold before calling `setDemand`,
because synchronous release can retire the last owner. Use
`hasPendingTruncateReplacement` for replay publication holds, including failed
replay. `pendingTruncateReplacement` is only a pending completion Promise and is
absent in some failed-held states. Failed-held replay with new demand is in
scope; yielding must neither recover that replay nor release its ownership.

Returning the existing `DemandUpdate` through `CollectionSubscriber.setDemand`
is a light change if every branch preserves its current bookkeeping: unchanged
does nothing, empty retires demand, Promise results register settlement, and
literal `true` settles synchronously (`collection-subscriber.ts:238`–`:270`).
The trigger must require a changed Promise-returning update and synchronous
input-revision advance, together with the pre-call hold. A Promise without input
feedback, synchronous contraction/empty retirement, and a literal-true acquisition
remain distinct control cells.

The condition is a plausible causal discriminator, not an established witness
of H02. The exact hold and input revision at the v6 conflict are unavailable.
If the actual finite history does not reach this premise, this design does not
yet solve it. Do not broaden the trigger silently: an unheld ordinary mutation
must still satisfy its synchronous public observation cut. Do not replace the
guard with acquisition counts, retry caps, dropped cached claims, delayed
physical releases, or pending-provider counts.

Default D2 callers, including Effects, must keep a full synchronous drain.
An opt-in Collection-builder change establishes no Effect progress result.
An already queued microtask needs stack return; a queued task also needs the
selected task mechanism to admit that answer. A timer is a candidate mechanism,
not a portable scheduling proof or a product deadline. Observe the actual host
and both answer schedules at the receiving boundary.

## Required receiving cuts before any behavior edit

V1's receiving inventory is directionally sound. Add the window-completion gap
and make the following distinctions explicit in the existing owners and composed
H02 witness. No receiving run is admitted by this report.

| History dimension | Required observation |
| --- | --- |
| Actual finite Query Core custom-cache feedback, with a prior nonempty snapshot | Reach the exact trigger; host returns; queued answer executes; leases remain owned; no intermediate root/facade publication; final relation matches the independent model. Cover microtask and task answers. |
| Pending window, answer settles before continuation; newly admitted window during that gap | Operation remains pending and `getWindow()` remains settled state until the chosen complete result is visible. Check success, failure, cleanup, supersession, and another participant that never settles. |
| Stop requested at final operator, with no remaining work; loader adds sibling input; first of multiple tap messages qualifies | No unnecessary task or skipped tail; all message output is retained; sticky request is consumed only for the current call; sibling graph input precedes the next ordered decision. |
| All-literal-true completed initial indexed and required full-source chains | Rows and initial readiness visible before initiating call returns, at the qualified architecture cut. |
| Ordinary synchronous mutations and compatible cached demand outside a hold | Reads, callback payloads, and downstream result coherent at method return. |
| Failed-held replay without a completion Promise; last-owner retirement during the triggering callback | Hold remains meaningful without the Promise; yield does not recover failure; unrelated graph work opens only at the existing lawful retirement boundary. |
| Cleanup/restart, new truncate, old queued job/task, stale answer | No old marker clears a new one; no stale graph mutation, readiness, health, or publication; exact one-shot releases. |
| Quiescent graph with withheld or queued publication; graph failure on resume | Continuation completion is distinct from task dispatch, acquisition settlement, and commit return; successful window completion follows visibility; failures settle through the proper operation path. |

The smallest false-green gap is composition: adapter ownership tests and core
publication tests can each pass while no history queues a real host answer
behind this feedback drain. The operation gap adds a second missing distinction:
the current operation tracker assumes synchronous graph work caused by a source
settlement completes before the participant resolves. Host suspension invalidates
that timing assumption unless graph completion becomes an explicit participant.

The next design revision should retain the narrow trigger and complete-operator
stop, add the operation fence and exact identity/token rules, and state the
quiescence/loader/publication completion point. Implementation feasibility then
still depends on reached pre-edit receiving evidence. There is no closure claim,
GREEN, hostile-mutant rejection, heap attribution, or universal termination proof
in this report.

## Source identity

Required reading included S's full live-query architecture and oracle rubric,
the glossary, oracle-review skill, relevant coverage owners, and the source paths
above. SHA256 values for the principal inspected sources:

| Source | SHA256 |
| --- | --- |
| `packages/db/src/query/live/ARCHITECTURE.md` | `5b5aa10c6672e7e60e38c1d2f5f28fa1f956d60741fb75965808050a256130b1` |
| `docs/contributing/glossary.md` | `f8cec460111439ba9ee65b0c1ecf8a60e466b576c4d94d75af222a9ced4ed02d` |
| `packages/db-ivm/src/d2.ts` | `1afc8bf4a587ea281905333ba2a96a475b7799a08d67fcd10b7531ba1de8adb7` |
| `packages/db-ivm/src/graph.ts` | `a46ce4fc6e9c9399fec7c77281cb056b216dba28d41a22e41ed5eb0c8f26fac0` |
| `packages/db-ivm/src/operators/tap.ts` | `7966b8e60871d3e28dd3d5f54f4375faf2e50de12c0d3bf0b44f6350cae4f9c6` |
| `packages/db/src/query/live/collection-config-builder.ts` | `0c00f76f05ecdea1c842e47e7749ed5dafbbb32f5c9f8a0937faf2776b4f474d` |
| `packages/db/src/query/live/collection-subscriber.ts` | `18ef3bbf99a747182f431bd1d03b985418a6320e595418f3fff57fa3db3acab2` |
| `packages/db/src/query/live/ordered-source-loader.ts` | `188382f75335916bb37ca53c72b469bc345b588082ca310a8390f4dbdaa2a450` |
| `packages/db/src/collection/sync.ts` | `12120489cabc124acd52a4ed690fce1ddd903602c8cda373b910f9fa744b4697` |
| `packages/db/src/scheduler.ts` | `b21cbbdc088b3c1dc4840b7db857ee7f262e6958dc8bc300398ad8e93da4f01a` |

The source-design author received the operation-fence finding during review and
reported a separate additive v2 artifact. This report deliberately leaves that
successor unreviewed; its completion point and failure fanout remain independent
review questions.
