# Serialized rare recovery: candidate, not adopted

## Decision and baseline

Test whether serializing replacement startup can remove overlapping-attempt
bookkeeping without changing ordinary pagination or weakening publication,
ownership, cancellation, and source-session guarantees.

Frozen source: `08f5fbed`. This document proposes a design; it does not report an
implementation, benchmark, or proof. Production is unchanged. Current source
weight is +2,805 package-source lines against fixed main `68366eca`.

The user approved design -> fresh Hostile failure assay -> conditional bounded
spike. A failed design check stops the spike. Do not repair it by quietly adding
a global queue, provider capability API, timeout policy, or source restart.

## Scope and preserved contract

The scheduling scope is one CollectionSubscription's private replacement, not
the source collection, adapter, query client, or application. Sibling consumers
keep their own subscriptions. Shared query publication still waits for the
sources it actually depends on; it is not an independent recovery scheduler.

- Ordinary page, boundary, tie, and deficit acquisition stays unchanged. Retain
  the settled-empty distinction, confirmed range boundary, and live-filled
  window work bounds. No routine full-source refetch.
- Keep the last complete public result while rebuilding private state. Apply
  the replacement before success/readiness; an obsolete intent cannot publish.
- Removing logical demand removes its waits promptly, even if its transport
  never settles. Release changes ownership, not which source rows may exist.
- Retire exact established acquisitions. A start throw is not an acquisition;
  no-op/queued dispatch is not yet physical adapter work. A later enclosing
  snapshot throw still retires work already established inside that call.
- Source cleanup ends the old session before callbacks, rejects abandoned
  callers, and fences late work. It must not unload old work into a new session.
- Retain primary failures and finish logical cleanup despite unload errors.
  Physical release debt is not a publication or readiness participant.
- Synchronous disposal/release and cleanup/restart remain supported. Keep the
  existing clear errors for unsupported recursive imperative window changes.
- No successful old acquisition clears an independent failed window operation.
- Source-owned row retention, graph quiescence, snapshot immutability, and
  callback error behavior are unchanged.

These are constraints from ARCHITECTURE.md, not deletion targets. Sources below
identify the relevant code and tests. The prior interview also permits slower
rare recovery, but does not authorize a new liveness dependency on a provider.

## Concrete scheduling rule

**A newer truncate records replacement intent immediately, but starts its
replacement acquisitions only after relevant older in-replacement work drains.**
It coalesces only replacement attempts that have not begun. It does not serialize
the individual acquisitions within an attempt, ordinary requests, or independent
subscriptions. Abort remains cooperative; aborting is not proof of settlement.

Retain the existing public/private row maps, source-session fence, exact demand
and acquisition objects, failure map, and completion promise. Proposed scheduling
state, all inside the existing replay session:

- latest revision: incremented by each truncate;
- running revision: the last replacement dispatch that actually began;
- setup depth: includes queued replacement startup and synchronous acquisition
  call stacks that have not returned;
- pending participants: logical demand, originating revision, and actual pending
  result; no per-attempt object or per-attempt counter;
- one queued pump flag, if needed to prevent duplicate microtasks.

This replaces, rather than supplements, currentAttempt plus per-attempt
pendingCount/setupComplete. Whether it uses fewer fields or branches is an open
measurement. It must not introduce a history of settled revisions or a generic
task/lease registry. Setup admission is about an in-progress call, not proof
that the adapter established a physical acquisition.

### Transitions

1. **First truncate.** Enter the existing private publication barrier before
   truncate deletes arrive. Record the latest revision, invalidate cursor and
   snapshot tracking as today, abort superseded request signals, and queue
   replacement startup after the truncate commit's events. Work started before
   replay keeps its ordinary readiness rules; do not add it to this drain.
2. **New truncate while busy.** Advance latest revision before callouts. Keep
   the shared public baseline and private state; the new truncate's source
   deletes update that private state. Abort prior acquisitions, stop dispatching
   the old batch's remaining demands, and record one pending replacement intent.
   Do not invoke a newer replacement batch yet. Older failure cannot become a
   failure of the new revision, though its participant may still have to drain.
3. **Acquisition entered during replay.** Admit its synchronous startup before
   invoking the adapter, binding it to the revision under which it began. This
   includes additional ordinary demand and ordered recovery. A returning promise
   replaces that startup admission only if its logical demand/session survives.
   Observe rejection even when no longer participating. A synchronous throw
   releases setup admission and fails only the still-current relevant demand.
   Preserve startSubsetDemand's current rollback of a truly failed new demand.
4. **Drain.** Settle/remove participants on promise completion or logical demand
   release. Finish synchronous setup in finally after ownership/callback work.
   When no setup or relevant pending participant remains, queue one pump. A
   pending latest revision prevents publication or a transient ready event.
   Cleanup debt and promises owned only by released demand do not delay this.
5. **Pump.** Recheck subscription/session, then read the current demand set. If
   latest differs from running, dispatch the latest replacement batch, updating
   running before callouts and aborting its remaining loop if superseded. If
   latest equals running and the barrier is clear, use the existing failure/
   publication path. A failed current batch stays private and rejects its caller;
   do not schedule an automatic retry loop. A later explicit truncate may retry.
6. **Exact replacement ownership.** Keep acquire-new-before-unload-old. A newer
   truncate no longer starts another replacement on the same demand while the
   previous startup stack is active. After normal return, the just-established
   acquisition may become that demand's retained (already canceled) acquisition;
   the queued replacement later replaces it. Do not restore the prior lease
   merely because intent changed. Still handle real startup failure, release
   reentry, and failed unload through the existing ownership paths.
7. **Release/dispose.** Remove logical membership and reject abandoned caller
   waits before adapter callouts. Release the exact established work, retain
   failed physical cleanup as debt, and recheck after callbacks. New demand
   acquired by an unload callback joins the still-private replacement. Last
   owner release retires the barrier; it does not wait for transport. Disposal
   invalidates scheduled pumps; source cleanup also invalidates their session.

Step 3 deliberately makes the before-call admission explicit. It must not be
implemented as a promise-only counter: synchronous reentry can occur before any
promise exists. Nor can latest revision label work that started under an older
revision. That would lose failure attribution even with serialized replacement.

### Ordered recovery boundary — unresolved integration check

Today collection-subscriber.ts queues loadFullSource from the publication-start
hook on each truncate, independently of subscription replay startup. Leaving
that hook untouched can start replacement-related work while the proposed drain
is busy. Calling the hook only after drain changes its role: initial publication
must still be held before any synchronous failure or write occurs.

The spike must account for this hook explicitly. Prefer using the existing
publication hold at truncate entry and invoking its recovery-start work as part
of admitted replacement setup; count any split callback/API or glue as added
production code. Do not claim serialization by changing only handleTruncate.
Whether this can be done without adding more coordination than it removes is
an assay question, not an assumed implementation detail.

## Candidate deletion map

Line references are to frozen source and are search anchors, not promised cuts.

| Existing code | Candidate change | Must remain / added cost |
| --- | --- | --- |
| subscription.ts:121-137, TruncateReplayAttempt and session fields | Remove per-attempt pendingCount/setupComplete objects | Latest/running revisions, startup admission, pending membership and pump scheduling |
| subscription.ts:381-483, handleTruncate | Replace overlapping batch setup/decrement paths with latest-intent pump | Immediate private barrier, abort sweep, post-commit ordering, source-session checks |
| subscription.ts:573-584 and 615-631, obsolete-attempt restoration | Remove these two restore/abort/release branches if a newer batch cannot start yet | Release during adapter/status callbacks and genuine acquisition/unload failure remain |
| subscription.ts:673-713, participant eligibility | Remove drained-old-attempt reopening test and per-attempt counts | Before-call admission, exact demand release, old failure attribution, observed rejection |
| subscription.ts:715-748, removal/completion | Replace per-attempt decrements and overlap completion with single drain/pump | Active failure scope, release-before-ready, publication exceptions |
| subscription.ts:308-370, detached restart | Route its setup through the same bounded admission if that reduces code | Different sync session, detached callers and current source rows; no forced source restart |
| collection-subscriber.ts:309-321, ordered recovery hook | Admit recovery dispatch within the serialized batch | Publication hold before synchronous startup; caller/window promise tracking |

Not deletable from this proposal: SubsetAcquisition, SubsetDemand, releaseDebts,
primary-failure handling, source generation, status revision, private/public row
maps, ordered coverage/boundary state, independent window failure state, D2
contributions, and applied receipts. Removing those needs separate evidence.

No numerical savings forecast yet. The two obsolete-attempt branches are a
small cut; a pump and extra callback boundary could consume it. Reject a spike
that merely moves those branches or adds a parallel scheduler.

## Behavior changes and possible defeaters

- A new recovery may start later and apply fewer intermediate replacement
  batches. Coalescing queued intent may reduce requests; draining can increase
  latency. Report both, including cases where it loses all recovery concurrency.
- Existing replay tests allow some startup superseded before adapter return to
  stop gating publication. Before-call admission may instead delay the next
  batch until that work settles. This is not a harmless expectation update: it
  can become a liveness regression if cancellation does not settle the promise.
- The source contract requires canceled work to stop publishing or drain safely;
  it does not explicitly guarantee an old promise can settle without starting a
  newer acquisition. Test that dependency. Do not assume independent promises.
- Additional demand acquired during drain still starts normally and participates
  in the barrier. This limits serialization's reach and may retain much of the
  current complexity. Deferring all ordinary demand would be a different design.
- Unload callbacks can start demand or reset/clean up the source. Serializing
  promise settlement does not serialize JavaScript callouts or shared adapters.
- A still-owned provider that never settles can already pin a publication;
  this design must not turn a currently recoverable case into such a wait.
  Infinite reset fairness is unproved; finite changes with a conforming,
  eventually settling provider must complete.

No timeout, forced settlement, release-first swap, blanket shared-source restart,
or reduced error reporting is an authorized escape from these cases.

## Verification and conditional spike gate

1. Fresh auditor sees this candidate, source trace, and success standard, but
   no sibling designs or author preference. Ask for concrete failure scenes,
   broken claims, evidence needed and repair conditions. A paper attack is not
   an executed production defect. Disposition every material finding first.
2. If the candidate survives, freeze baseline traces and test inputs before
   changing runtime. Preserve existing oracles and assertions. Separate stated
   timing changes from violations; do not teach the oracle the pump algorithm.
3. Extend the real subscription replay driver with independent observable laws:
   last complete image until current valid replacement; no retired waits;
   exact load/unload ledger; no stale source-session effects; bounded new work
   on a finite reset history. Cover two consumers, reset during startup and
   settlement, additional demand, shared promises, sync/async failure, failed
   unload, release that starts demand, and noncooperative cancellation.
4. Include a provider whose obsolete operation completes only after replacement
   acquisition starts. Compare baseline completion against the candidate; a new
   cycle is a design failure, not permission to change the adapter contract.
5. Run unchanged replay/lifecycle, ordered-loader, ordered-work, pagination and
   publication suites on both versions. Pin discriminating schedules/seeds;
   then run randomized histories, full DB and package types. Retain useful tests
   even if the candidate is rejected. Commit each retained step and loss-audit it.
6. Compare actual whole-diff production lines and diagnostic minified/gzip size
   with 08f5fbed and fixed main, including helpers/hook changes. Record request
   counts, selected rows and logical recovery turns in paired schedules. Treat
   wall-clock timings as local diagnostics, not app performance benchmarks.
7. Accept only preserved guarantees plus actual net simplification. No negative
   line target can excuse a new hang, broad refetch or hidden contract change.

## Source trace and limits

- packages/db/src/collection/subscription.ts:121-137, 274-483, 487-748,
  1044-1231, 1497-1542: replay, startup, exact acquisition replacement and release.
- packages/db/src/query/live/collection-subscriber.ts:309-380: ordered recovery
  startup and publication callbacks; utils.ts retains normal ordered refinement.
- packages/db/src/query/live/ARCHITECTURE.md:625-689, 708-827: source cooperation,
  applied settlement, finite recovery, publication, reentry and release laws.
- packages/db/tests/collection-subscription-replay-oracle.property.test.ts:
  queued supersession case near2363 and replay/additional-demand reentry matrix
  near2410-2555. The latter is a specific timing discriminator, not just rows.
- packages/db/tests/collection-subscription-lifecycle-oracle.test.ts;
  packages/db/tests/query/{ordered-source-loader.test.ts,
  ordered-work-oracle.property.test.ts,pagination-oracle.property.test.ts}:
  unchanged ownership, loader, work and public-result gates.

Design selection emphasizes overlap bookkeeping because it has grown; that may
overstate the removable portion and hide costs in ordered hook coordination.
Source inspection establishes current branches, not the candidate's correctness
or savings. The fresh assay and paired execution remain unperformed.

## Disposition — candidate stopped before a production spike

The text above is the frozen candidate read by the fresh auditor. Its statement
that the assay is unperformed describes that earlier stage, not this disposition.

Fresh report:
/Users/kylemathews/Documents/Codex/2026-09-06/run-a-fresh-field-lab-hostile/outputs/serialized-recovery-hostile-assay.md.
The auditor saw this candidate and frozen code, but not sibling designs, TODO,
or the separate main-task probe. It reports586 baseline tests passing in five
suites. Those are baseline controls, not candidate verification.

| Attack | Main disposition |
| --- | --- |
| A1: old settlement depends on replacement startup | Reject drain-before-start under the preserved provider contract. A main-task real-subscription probe passes both old resolve/reject variants and records load-new before settle-old, retained public rows, new publication/completion, no stale error, and exact unload ownership. The proposed wait adds the opposite edge and creates a cycle. No candidate runtime was implemented or executed. |
| A2: superseded-before-return timing | Existing tests prove an earlier publication escape. Do not rewrite them as obsolete; this candidate cannot justify removing that escape. Infinite nonsettling-provider behavior was not executed. |
| A3: shared consumers and additional demand | Shares A1's mechanism; not a second confirmed bug. Preserve per-owner membership. The combined shared-transport/reset/reacquisition matrix remains unexecuted and is not needed to establish A1. |
| A4: ordered recovery hook | Integration unresolved: loadFullSource returns void and forwards actual results through observers. Moving the hook requires preserving both subscription and graph holds. No unsafe hook change was made. |
| A5: tentative ownership and cleanup debt | Valid preservation constraint, not an observed production bug. Serial startup does not eliminate acquire-before-unload or reentrant teardown distinctions. |
| A6: release callback reacquisition | Candidate's post-callout recheck already addresses the basic hazard. Keep exact demand identity and exception-safe ordering; no new defect established. |
| A7: shifted rather than removed complexity | Savings unproved. Baseline already coalesces queued resets. No source/bundle savings or regression claimed; no benchmark of an unimplemented scheduler. |

The new two-case law is retained in the existing subscription replay oracle:
`starts a replacement that lets canceled replay resolve/reject`. The provider
stops old request-scoped writes after abort; only its waiter settlement depends
on the new registration. This is a contract-level fixture, not evidence that a
shipped adapter currently behaves that way. No adapter survey was performed.

Oracle lesson: independently choosing settlement order does not generate the
dependencies that enable settlement. Preserve both publication-after-drain and
replacement-startup-before-drain as separate rules. This is not a recommendation
to build a generic dependency scheduler into production or the tests.

Main evidence before integrating the unchanged probe body into the existing
oracle: /tmp/tanstack-serialized-recovery-baseline.json/log (2/0),
/tmp/tanstack-serialized-recovery-gates.json/log (588/0,6 files), and
/tmp/tanstack-serialized-recovery-types.log (package tsc exit0). Index fallback
warnings occurred in the broader gate. The first probe draft compared virtual
metadata with plain expected rows; it was corrected to record id/value before
these passing results. That fixture mismatch was not a runtime defect or a red
candidate run. Final retained-file checks are recorded in the TODO.

No production change, no new known production bug, no automatic alternate
design, and no production spike. The author-selected provider dependency and
the hostile stance can emphasize contract exposure over common adapter behavior;
neither establishes prevalence. A1 nonetheless defeats this candidate's own
promise to preserve existing liveness without a stronger provider requirement.
