# Loading lifecycle refactor plan

Status: baseline, move and failure-state substep audited; source-state clarification
implemented and tested, awaiting its fresh audit.
Planning baseline: 15987067 on codex/loadsubset-minimal-stack.

## Aim

Make ownership, legal states and callback ordering easier to understand without
adding a framework. A modest source increase is acceptable when it removes
implicit rules or reduces the number of places needed to understand a change.
Net source/bundle size, retained state and work remain checks, not the sole aim.

This plan uses the completed state-machine and D2 Design grammar reports and
Formation section, including their loss-audit qualifications. Their generated
forms are candidates, not proven implementations. This planning pass checked
the current ordered loader, acquisition handoffs and demand controller against
the full live-query architecture contract. No tests were run.

## Proposed ownership

| Concern | Owner after refactor | Must not absorb |
| --- | --- | --- |
| Query rows and required-key multiplicity | Existing compiled D2 graph | Adapter promises or physical cleanup |
| Request admission, replacement and exact release | Subscription-local acquisition lifecycle | Replay completion or global Collection readiness |
| Safe ordered continuation and retry policy | OrderedSourceLoader | Public window acceptance or provider exhaustion claims |
| Replay membership and source replacement | Existing subscription replay session | A universal pending-work ledger |
| Publication and accepted window | Existing query builder/window coordinator | Physical request ownership |

These are boundaries, not five new classes. Keep facts that can coexist separate:
source evidence and pending work; logical retirement and physical cleanup debt;
source replay success and window failure; settled window and requested window.

## Step 0 — Freeze behavior and map the states

- Capture the baseline revision, targeted/full test results, bundle measurement
  and source count before implementation. The last recorded full gate is not a
  fresh baseline run.
- For every field being replaced, list its writer, reader, lifetime and event
  that invalidates it. Map reachable combinations into the proposed states
  before deleting a flag. Do not infer redundant state from similar names.
- Build on existing lifecycle, replay and ordered oracles. Record public rows,
  statuses, promise outcomes/error identity, adapter calls and exact release
  ownership at callback boundaries. Do not use final rows as the only check.
- Keep the model independent: tests must not import the production reducer or
  derive expectations from its new state tags.
- Add a missing transition law before changing runtime behavior. A new baseline
  failure is a separate bug to red/green, not permission to alter the oracle.

Exit: an explicit transition/owner map and reproducible baseline, including
reentrant callbacks, obsolete settlements and teardown.

## Step 1 — Make ordered loading a named local protocol

### Frozen field map and baseline

At 15987067, the fresh full DB gate passes 4758/0 with zero skips across
147 files; package tsc --noEmit exits 0. Artifact:
/tmp/tanstack-ordered-state-baseline.json. Vitest emitted its experimental
type-testing notice and TimeoutNegativeWarning; this was not warning-free.

Diagnostic baseline: esbuild 0.20.2, src/index.ts, bundle, packages external,
ESM, es2022, minify: 368361 bytes / 103734 gzip. Artifact:
/tmp/tanstack-ordered-state-baseline.mjs. This is a paired diagnostic for this
refactor, not an application bundle or a comparison with an earlier invocation.
The side-effect import warning remains. No runtime/heap measurement is claimed.

| Existing fields | Writers / lifetime | Consumers / distinction to preserve |
| --- | --- | --- |
| pending | observe, completion/failure, reset, provisional observer failure | Waiters and request admission; each request is registered separately |
| hasEstablishedSourceCoverage, sourceBoundary | non-boundary success, invalidation; reset clears only boundary | Initial prefix forcing, cursor, local confirmed-row count; established-empty is valid |
| needsFullSourceRecovery | invalidation sets, full-source success clears | Full-source selection and publication hold; finite success must not clear this obligation |
| fullSource, fullSourceFailed | startup, sync/async failure, explicit retry, replay success | Retained acquisition versus failed result; sync failure can leave false/true, async failure true/true |
| failed, failedWindowOperationGeneration | success clears, failures set, explicit retry claims new operation before release | Automatic retry exclusion; undefined operation is still a real failure |
| releaseFailedAcquisition | async failure sets, explicit retry takes before callback | Exact physical release; success does not itself clear a retained release handle |
| requesting | request, release and observer-error call stacks | Reentrant startup guard, independent of asynchronous pending state |
| active, generation | dispose/reset/provisional failure | Stale success ignored; active stale failure still invalidates evidence before generation check |
| lastPage, lastPrefixCount | request attempts, successful prefix, invalidation | Work/dedupe guards, not extent proof |
| hasLastBoundary, lastBoundary | tie attempt, reset/failure | Presence differs from an undefined boundary value |
| info window/index/comparator/dataNeeded | supplied by caller; window can change | Physical query policy, not accepted public-window state |

The state design must preserve these products. In particular, source evidence
and a recovery obligation can coexist; pending work and a synchronous call guard
can coexist. The generated grammar's one request-phase sketch is not yet a
proven replacement for all of these fields.

Fresh post-commit baseline loss audit (97b5d872) verified counts and found no
missing mutable field. Three lifetime qualifications are retained:

- resetCursor retains failure, recovery obligation, full-source flags and the
  failed release handle while discarding pending identity and cursor guards.
- settleFullSourceReplay only conditionally clears fullSourceFailed; it does
  not perform ordinary request-success cleanup.
- Promise identity decides whether a callback may clear pending, independently
  of activity/generation checks. Reset does not cancel the underlying promise.

This was one source-bundle static audit, not another runtime test. A field list
can hide callback sequencing. Compression also needs its tool recipe: the
recorded gzip size is reproducible with gzip -n -c; comparisons use the same
runtime/tool for both artifacts.

### Step 1a — mechanical move

OrderedSourceLoader and OrderedRequestKind moved verbatim to
query/live/ordered-source-loader.ts; two production consumers and its focused
test import that module directly. No compatibility re-export or behavior change.
The architecture's concrete map points to the new owner.

Targeted gate: 629/0, zero skips, six files; package types pass. Artifact:
/tmp/tanstack-ordered-move-targeted.json. Exact moved-body comparison passes.
Touched-file lint reports the pre-existing prefer-const diagnostic in Effect;
the baseline stdin check is recorded separately. No clean lint claim.
Baseline stdin lint reproduced the same prefer-const error (exit 1).
Paired diagnostic bundle remains 368361 minified bytes; gzip changes
103734 -> 103749 (+15), using Node v24.5.0 / zlib 1.2.12 on both artifacts.
Module ordering/identifier changes can affect compression without semantic
changes. This is not an application-size or performance result.

Fresh mechanical-move loss audit at 200f96fc returned null: the moved body,
remaining utility bodies, all consumer uses and test assertions were preserved;
no public export or new dependency-cycle path was introduced. Static comparison
only; its mechanical lens does not establish correctness of existing behavior.

### Step 1b — first explicit state transitions

Replace failed + failedWindowOperationGeneration with a failedRequest record.
Presence represents failure even without an explicit operation generation.
Completion clears the record; retry claims its generation before releasing old
work. A retained release handle without a current failure remains independent.
Synchronous and asynchronous failures share recordRequestFailure, which clears
request/tie dedupe guards. Existing activity/generation and call-stack guards,
source evidence, recovery obligation and full-source lifecycle remain separate.
This is a bounded substep, not completion of the whole source-evidence refactor.

Remove hasLastBoundary: canExpressCursorOrder rejects null and undefined before
the equality guard, and reset always clears lastBoundary. The initial field map
listed presence/value as separate facts but did not account for that operand
domain. A proposed undefined-tie test was wrong: the supported path deliberately
loads the full source. The corrected five-cell control crosses nullish full-source
fallback with valid falsy ties (zero, false, empty string), including subsequent
refinement and no repeated tie acquisition.

Those controls pass the old runtime. Removing the order-safety guard as a
temporary sensitivity mutation yields 2 failed / 3 passed (44 tests filtered).
The mutation is restored; no defect is being claimed in the baseline.
Artifacts: /tmp/tanstack-ordered-state-controls.json and
/tmp/tanstack-ordered-state-red-control.json.

Candidate targeted634/0, no skips, six files; types and changed loader/test lint
pass. Full DB gate4763/0, zero skips,147 files, exit0; artifact
/tmp/tanstack-ordered-state-full.json. Paired diagnostic vs original baseline:
368361 -> 368196 minified (-165), 103734 -> 103737 gzip (+3), same Node/zlib.
Only one failure record is retained at a time; no event history/row mirror added.
No heap or throughput claim. Production source net +1 versus planning baseline,
+2806 versus fixed main68366eca (documentation excluded).

Fresh post-commit state audit returned null; complete source trace is in
[loadsubset-ordered-failure-state-loss-audit.md](loadsubset-ordered-failure-state-loss-audit.md).
It verified the dormant operation ID was unread while failure was absent, the
release handle still has independent lifetime, and the cursor domain justifies
removing the presence bit. It did not execute tests. The five new controls are
synchronous method-sequence tests, not substitutes for integration lifecycle
and failure/reentry coverage.

The first 100x ordered lifecycle/work campaign reported256/2; both failed work
properties ended near the default five-second limit with STACK_TRACE_ERROR, not
an assertion mismatch. The replay uses the reported random seed1560018276 and
unchanged fixed seeds, with --testTimeout=120000 for this invocation only.
No assertion or runtime policy was relaxed. Preserve the first artifact:
/tmp/tanstack-ordered-state-100x.json. Replay passed all 258 tests with zero
failures or skips; runner JSON success is true. Artifact:
/tmp/tanstack-ordered-state-100x-retry.json. The work suite replayed the failed
random seed; the lifecycle random campaign also used that seed on this run.

Original surface: OrderedSourceLoader in query/live/utils.ts, consumed by the
collection subscriber and Effect. The separate mechanical move above is done.

### Step 1c — keep independent source facts explicit

At baseline 7a17c3f0, the remaining source fields do not form one exclusive
phase. Keep the product instead of encoding it in a large enum. Rename private
hasEstablishedSourceCoverage to hasSettledSourceRequest, sourceBoundary to
settledSourceBoundary, and fullSource to hasFullSourceDemand. Rename the private
invalidation transition requireFullSourceRecovery to state the obligation it
creates. The exact request's settlement is not proof of provider extent, and
retaining full-source demand is not proof that the acquisition succeeded.
No conditions, assignments, callback ordering or public methods change.

Six control cells cross reset/dispose with obsolete resolve/reject/AbortError.
They check the replacement promise's identity, no stale release, prefix offset
zero after reset, and authoritative recovery even after a finite replacement
succeeds. This makes the distinction between finite success and repair debt
executable without reading private fields. On the baseline all55 focused tests
pass. A temporary mutation that ignores stale failures before invalidation
produces2 red/4 green cells; it is restored. This is test sensitivity evidence,
not a newly found production bug. Artifacts:
/tmp/tanstack-ordered-source-state-controls.json and
/tmp/tanstack-ordered-source-state-red.json.

Candidate targeted640/0, zero skips, six files; package types and changed-file
lint pass. Artifact: /tmp/tanstack-ordered-source-state-targeted.json.
Fresh post-commit loss audit is next. This substep adds five comment lines,
no runtime fields, retained history or state object.

The remaining source facts stay separate for these reasons:

- Source evidence: no established request; a fulfilled finite range (possibly
  empty, with no new boundary); invalid evidence requiring full-source repair;
  a fulfilled full-source request.
- Request outcome: idle, pending or failed, carrying the relevant request and
  operation identity. Final tags depend on the field-to-state mapping.
- Synchronous invocation guard stays separate: adapter startup, release and
  result-observer delivery can reenter while other state exists.
- Retained full-source demand stays separate from proof of successful loading.
  Owning that demand must not claim it succeeded or trigger duplicate replay.
- Page/prefix/tie signatures remain distinct guards unless equivalence is shown.

Use named transition methods such as requestFailed, requestSucceeded and
sourceOrderChanged, with explicit inputs. They own the corresponding writes.
No event bus, generic reducer library, deferred effect queue or event history.
Do not introduce replacement flags alongside old flags as permanent mirrors.

Keep source-order arithmetic, index reads and fallback rules unchanged. An empty
later range retains the earlier safe boundary; it does not prove exhaustion.
Invalidation can coexist with an in-flight request. Stale success and stale
failure need their existing, distinct generation rules. A failed window does
not become publishable merely because source replay later succeeds.

Exit: one place to read each loader transition, unchanged caller API and
observable traces, no additional retained page or row index.

## Step 2 — Make acquisition transfer explicit

Current surface: subscription.ts's startSubsetDemand,
startTruncateReplayDemand, replaceSubsetAcquisition,
releaseOrRetainAcquisition, release and teardown paths.

First name the transfer record and transitions within the subscription. Extract
a private collection/subset-acquisition.ts module only if it can own its state
without a large callback/configuration interface or circular imports.

The transfer record identifies the logical demand, candidate acquisition, any
prior acquisition, source session and captured replay attempt. It replaces
stack-local ownership ambiguity; it must not become a second owner registry.

Required sequence:

1. Install tentative ownership before invoking adapter code.
2. Invoke the adapter synchronously at the existing call site.
3. Classify return versus throw, then recheck owner/session/attempt identity.
4. Accept or retire the exact candidate; restore a prior lease where the
   existing replacement contract requires it.
5. Let the existing replay and readiness owners admit their participants.

Represent physical release separately: held, releasing, or failed release
awaiting retry. A single representation may replace releaseDebts plus the busy
release set only if it preserves both facts and their reentry ordering.
Logical retirement happens once; retrying physical cleanup must not repeat it.
An old session's debt must never be sent to a new adapter.

Keep initial acquisition and replay as distinct callers of common transitions.
Do not force them into one all-purpose start function. They have different
admission and rollback policies. Preserve the early result callback: it can
expose provisional ownership before later snapshot work throws. Do not revive
the rejected returned-handle-only API.

Exit: acquisition decisions are local; replay/status bookkeeping remains with
its existing owner; callbacks cannot hide which exact lease must be released.

## Step 3 — Review integration, not a new publication framework

Update ARCHITECTURE.md with the resulting owner/transition map in place of
duplicated explanations, while retaining the normative laws.

At the existing builder and subscription boundaries, make checks and call sites
read in terms of source replay, ordered operation and accepted publication.
Do not combine them into one ready flag or introduce a second barrier manager.
Keep direct subscriber buffering distinct from graph publication.

Walk these traces end to end:

- A provisional result is observed, then local snapshot work throws.
- An unload releases its own consumer, then throws.
- A pending finite request receives an order-changing source write.
- A failed window is followed by successful source replay.
- Cleanup/restart precedes an old request's return or rejection.
- A callback acquires new demand while replay completion is being checked.

Exit: each trace can be explained through the named owners without reconstructing
scattered boolean assignments. Existing snapshot, error and notification laws
still hold.

## Step 4 — Separate, optional D2 demand-presence experiment

Replace only compiler/joins.ts's manual demandWeights maintenance with existing
equality-key normalization and D2 distinct/presence operators. Keep segment
ownership and adapter effects in SubsetDemandController.

This is not automatically behavior-preserving: per-message delivery versus
graph-turn consolidation can change load/abort timing. Compare drop/readd within
one turn, multiple contributors, equality-equivalent raw values, synchronous
adapter writes, batching and Effect/query consumers. Preserve the no-demand
fast path and count retained graph state and adapter work.

Retain the experiment only if it gives a clearer boundary with acceptable
measured overhead and preserves the selected timing contract. If it needs a
new timing policy, stop for that decision rather than calling it a refactor.

The larger segment-reachability D2 form is not part of the initial implementation.
It assumes a stabilized-demand boundary and applies only to live-query/Effect
demand, not plain subscribers. Its reservation, rollback and indexing machinery
needs a separate justification. This preserves the fourth candidate for later
without making it a dependency of the two local state refactors.

## Validation and review gates

- Preserve all valuable current tests; do not replace the integration oracles
  with tests of the new types. Add small transition matrices alongside them.
- Cross request kind, settlement phase, callback reentry, ownership outcome,
  replay/restart and consumer type using valid sub-products, not impossible
  global combinations.
- Keep fixed structural cases and random fast-check histories. Run targeted
  gates per commit, package types and full DB integration at milestones, then
  the 100x relevant oracle campaign and affected Query DB/adapter gates.
- Check trace behavior as well as final values: callback timing, exact errors,
  source calls, unload ownership, notifications and accepted windows.
- Check retained state after long replacement/retry chains; no settled attempt
  history, recursive promise chain, new row mirror or per-event log may remain.
- Measure source and bundle changes, requests, scans and retained objects.
  Report modest growth honestly when it buys a demonstrated clarity gain.
- Commit each completed implementation step, then have a fresh agent run the
  Field Lab loss audit against that step's frozen plan and diff. Audit omissions
  feed the checklist before the next step. Never rewrite published history.

Architectural acceptance test: a reviewer should find a transition's owner,
legal predecessor states, callouts and failure result locally. The change must
replace the old representation, not add an abstraction around it.

## Sequence and scale

Step 0 precedes all runtime work. Step 1 is the first complete slice: a roughly
500-line existing class with two consumers. Step 2 touches several hundred lines
of acquisition/replay ownership inside a larger subscription class; it is the
higher-risk slice. Step 3 follows both. Step 4 is independent and optional.

After the baseline, the two local slices can be developed on separate branches,
but integrate and validate them one at a time; the ordered loader calls the
subscription API. This plan starts no agents or branches.

Expect several small commits, not a whole-stack rewrite. State-machine grammar
estimates allow either modest shrinkage or growth; no net-size claim is made.
The initial refactor adds no public API, library dependency, adapter contract,
universal scheduler, new supported behavior or new recovery mode.
