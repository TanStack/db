# Integration and handoffs loss audit

**Bounded null:** this pass recovered no supported baseline assertion or architectural distinction that is absent from the candidate within the selected bundle. The builder changes the treatment of obsolete or already-retired promise callbacks. It preserves the current-participant failure barrier. The new test states and exercises a builder-boundary claim; it does not establish loader or adapter behavior.

## Frozen inputs and method

- Baseline **B**: `69f45d227c365e4c90691b1ee61d1d23e51f02f0`.
- Candidate **C**: `1e69e83818844c259dcc408b6edbbcde33eb0d38`.
- Read-only repository: `/Users/kylemathews/programs/tanstack-db/.worktrees/codex-loadsubset-minimal-stack`.
- Selected source bundle: `packages/db/src/query/live/collection-config-builder.ts`, `packages/db/tests/query/scheduler.test.ts`, and `packages/db/src/query/live/ARCHITECTURE.md` at B and C.
- Method: Field Lab Hidden-signal recovery assay (`loss-audit`), one fresh pass over this bundle. The scan compared frozen file contents, traced the changed runtime guard, checked retained assertions and laws, and matched the added handoff summary to its named owners. Subscription and loader excerpts were read only for that last check.

Pointers below use `B:path:line` or `C:path:line`; they refer to the frozen Git objects, not mutable worktree lines. Prior audits, plans, TODO files, sibling results, and task discussion were not inspected. No tests ran and no production files changed.

## Per-source loss trace

### Builder: no supported contract recovered as lost

At `B:packages/db/src/query/live/collection-config-builder.ts:517–528`, a rejected promise sets `orderedLoadFailed` before checking participant membership. The session check guards scheduling only. At `C:packages/db/src/query/live/collection-config-builder.ts:517–530`, session equality and successful removal from `pendingOrderedLoads` precede the failure write.

| Callback state | Baseline | Candidate | Loss reading |
| --- | --- | --- | --- |
| Current session, registered participant, rejection | Removes participant, sets failure, withholds scheduling | Same | Current failure barrier retained |
| Current session, registered participant, success | Removes participant; schedules only if no pending load and no failure | Same | Drain and failure conditions retained |
| Obsolete session | Can set the failure flag and attempt removal before the session check | Returns before either change | Explicit exclusion of obsolete work; no baseline law requires its mutation |
| Participant already removed | Rejection can still set failure | Returns before setting failure | Participant admission now also guards failure mutation |

The surrounding controls remain unchanged: teardown advances the session and clears participants and failure state (`C:packages/db/src/query/live/collection-config-builder.ts:845–888`); publication still checks window failure, ordered failure, source recovery, and pending ordered loads (`C:packages/db/src/query/live/collection-config-builder.ts:1060–1078`). The old comments about retaining the complete snapshot and scheduling without re-entering loaders remain. The full-file comparison found no other runtime change in this file.

Thus the removed behavior is traceable to an explicit admission rule, rather than compression of a supported contract. This is a static branch reading, not a run of the changed code.

### Scheduler tests: no old assertion lost

The frozen comparison retains every old test body. Changes outside the new test only add `createDeferred`, add `flushPromises`, and expand the existing utility import without removing its names. The baseline has 99 lines containing `expect(` and the candidate has 109; more decisively, no old test-body line is deleted or replaced. The inserted test is `C:packages/db/tests/query/scheduler.test.ts:1398–1476`, before the old load-more callback test.

The four cells cross obsolete resolution/rejection with replacement settlement before/after the obsolete outcome (`C:packages/db/tests/query/scheduler.test.ts:1398–1406`). They inject two distinct deferred promises directly through `trackOrderedLoadPromise(..., true)` across cleanup and preload (`C:packages/db/tests/query/scheduler.test.ts:1426–1435`). The explicit comment identifies the builder boundary and says loader guards must not mask it.

Assertions check the retained `old` row while replacement work is pending; no publication caused by the obsolete outcome; exactly one replacement publication after replacement settlement; a later synchronous update; and final ready status with no subset error (`C:packages/db/tests/query/scheduler.test.ts:1445–1468`). In the already-settled replacement cells, the later update is material: it observes whether obsolete rejection re-closes the gate even though the replacement snapshot is already visible.

The test name's claim about ordered publication participants across restart fits that injected boundary. It does not call `setWindow`, use an ordered query, exercise physical cancellation, run truncate replay, or create child facades. It does not independently isolate same-session participant removal, shared-promise identity, several current participants, or replacement rejection. These are limits of the new evidence, not assertions removed from the baseline. This audit did not execute even the four stated cells, so it reports their assertion structure rather than a passing result.

### Architecture: no old law or distinction lost

The candidate inserts 23 lines at `C:packages/db/src/query/live/ARCHITECTURE.md:102–124`. Every baseline line remains in order and unchanged. All 13 normative laws at `B:packages/db/src/query/live/ARCHITECTURE.md:908–945` remain at `C:packages/db/src/query/live/ARCHITECTURE.md:931–968`. The added table explicitly retains the detailed laws and says its owners cooperate rather than form exclusive phases.

The limited method checks support the table's distinctions:

| Added summary | Frozen implementation support |
| --- | --- |
| Tentative acquisition precedes callbacks; transfer accepts replacement ownership before releasing the old lease; failed release retains exact ownership or debt | `C:packages/db/src/collection/subscription.ts:530–545`, `1088–1109`, `1112–1145` |
| Loader request settlement, continuation boundary, and repair state are distinct; cursor reset and disposal invalidate later settlement work | `C:packages/db/src/query/live/ordered-source-loader.ts:19–38`, `209–234`, `292–361`, `400–445` |
| Replay counts setup and logical acquisition participants and checks completion after release callbacks | `C:packages/db/src/collection/subscription.ts:680–750`, `1512–1539` |
| Replay success ends its source replacement hold; failed replay can retain the hold after its completion promise rejects | `C:packages/db/src/collection/subscription.ts:758–808`, `893–908` |
| Builder publication participation is session-scoped; asynchronous window acceptance uses an operation generation | `C:packages/db/src/query/live/collection-config-builder.ts:333–383`, `499–535` |
| Graph draining and public publication are separate; root and child changes remain subject to the existing gates | `C:packages/db/src/query/live/collection-config-builder.ts:613–647`, `1060–1105` |

The loader row is a summary of asynchronous settlement ownership. It must not be read as a claim that every method becomes immutable after disposal. Likewise, the replay row's “success closes the source replacement gate” means it ends the hold: `flushTruncateReplay` clears `truncateReplacementPending` in the query path. The detailed retained text and the next paragraph disambiguate that wording.

The table does not replace the detailed distinction between full-source replay success and a failed window operation. Nor does it equate graph quiescence, exact request settlement, provider exhaustion, and window acceptance. No missing baseline item can be traced to its compression within the whole candidate document.

## Limits and audit-induced flattening

This null applies only to the selected integration bundle and the named-method checks. It does not certify the branch, establish adapter conformance, or prove all normative laws at runtime. Mechanical retention proves that assertions and laws remain written; it does not prove they pass or are exhaustive.

The audit itself compresses callback histories into branch classes and uses the architecture's owner names to organize evidence. That can hide reentrant combinations and make preserved prose seem equivalent to preserved behavior. The single injected root-row scenario also leaves nested publication and real transport behavior unmeasured. No recovered item was ranked, restored, or turned into a redesign recommendation.

