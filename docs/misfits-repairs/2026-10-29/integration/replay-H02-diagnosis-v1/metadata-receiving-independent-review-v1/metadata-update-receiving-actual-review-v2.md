# Actual receiving result and retained-trace phase review, v2

Reviewer: `/root/replay_covering_authority`, independent of the author.
Scope: the frozen scope/default quarter-2 receiving attempt and its first
outer failure. This record authorizes no correction, native run, retry, next
lane, product closure, or canonical import.

## Verdict

The actual outer test failed with exit **1**. Its receiving child exited
normally with **0**. The selected test failed; nineteen tests were skipped;
none passed. The first mismatch is a confirmed evaluation defect: the retained
outcome drops the follow-up phase markers but keeps the follow-up callback.
The post-run checker therefore compares rank 35 with the completed reload's
rank 30. This is not a demonstrated production-law violation.

All 31 declared metadata reach counters were printed as one. The realtime
observer reached the `worker-cleaned` path, whose publication requirement had
already compared both stages. Those observations do not establish execution of
the explicit `metadata.finish()` call. The outer check throws at test line 74;
the call at line 76 and the caller's `reach.assertReached()` are not reached.
There is no receiving GREEN, product RED/GREEN, generated-campaign result, or
mutant closure from this attempt.

## Bound evidence and provenance

This review pins `metadata-update-receiving-result-freeze-v2.json` to
`e490825ed92a6fa97891d2ab8b0414f65691bc06c214573e7ed119e9d236d9eb`.
Its raw manifest is
`091d5b2cec5155f52003ee629758b2ce69e0bd20a6f56ea15eda012d15432803`.
The audit independently read every original and preserved regular member:

| Capture | Exact file count | Exact bytes | Result |
| --- | ---: | ---: | --- |
| Inner | 1,948 | 31,372,571 | Both complete sets and every member's bytes/hash agree |
| Outer | 3 | 15,840 | Both complete sets and every member's bytes/hash agree |

The selected history has canonical digest
`bb837d81114314f37f2d8383f471aedbd3d2a3350c84db4075a5d3b79247b213`:
query, microtask, scope cache identity, default metadata keys, includes,
window, nonempty prior, key shift 0, rank scale 10, follow-up quarter 2.
Actual `history.json`, `worker-start`, prepared invocation, supervisor and
writer records agree with that program and source root. The captured identity
record has one exact candidate, selected by program and recorded identities,
not by first-new or mtime.

The audit rehashed all 588 successor source files against inventory
`c5cdea6b41d82b331435162ea06b9254be96acff7b7450be79e0c37690cb74b2`.
Source freeze
`4ae26549a4edc1565ef08ca7f1b096f7b644b32773fa520d688431335aa5bd8a`
remains unchanged. Complete captured prelaunch and fresh recheck identity
objects agree, including the 511 production-file, 2,544 named dependency
payload, and four reuse-link declarations. This audit did not independently
rehash the installed dependency payloads or infer full transitive equivalence.

The outer tool's recorded completion is exit 1, independently of child exit 0.
Recorded identities are outer PID/PGID 52259, receiving parent PID 52323,
detached leader/target group 52405, and writer PID 52441. All six captured
absence probes show empty `ps` matches and signal-zero ESRCH. No new process
probe or signal was issued. The original lack of a persisted initial actual
`getpgid` remains a limit; writer absence does not establish its initial group.

The final bound supervisor records reason `exited`, null signal, 23 key
callbacks, no primary realtime observation error, no cleanup errors, warnings,
prefix violations, kill attempt, or heap diagnostic. Elapsed inner time was
2,451 ms; maximum sampled group RSS was 450,707,456 bytes. The 60-second test
timeout is not a hard overall outer watchdog. Child binding does not establish
the parent's compiled checker bytes or invocation provenance.

## Confirmed finding: retained receipts erase a required phase distinction

**Challenged claim:** the supervisor's selected semantic receipts suffice for
the independent post-run judgment.

**Authority:** architecture law 9 and its Coherent publication section require
reads, events and downstream queries to observe the same complete graph result.
The accepted reload barrier retains its prior complete result until the new
result completes. A subsequent authored source change has its own complete
result. No accepted law freezes an already completed reload's row forever.
The payload owner states its projection and delegates public virtual-field
classification to `virtual-row-fields-oracle.test.ts`; the coverage map near
lines 739–748 preserves that separate receiving gap.

Independent reconstruction is small: initial unmarked roots are IDs 2 and 4;
offset 1/limit 1 selects row 4/rank 40. The finite reload removes the marker
from row 3; the same relational calculation selects row 3/rank 30. The later
source update changes that retained row's rank to 35, leaving it in the same
window. Both stages owe complete values and truthful prior event values.

The raw legal history records these cuts in contiguous order:

| Sequence | Observation | Meaning |
| ---: | --- | --- |
| 159, 160 | Root/downstream replacement callbacks | Complete row 3/rank 30 replaces row 4/rank 40 |
| 161 | `final-publication` | Settled reload baseline compared |
| 162 | `followup-start` | Advance the model from reload to authored update |
| 177 | `followup-source-applied` | Actual eager source update applied |
| 182, 183 | Root/downstream same-key `update` | Current rank 35, complete `previousValue` rank 30 |
| 185 | `followup-publication` | Complete root/downstream rank 35, ready, no sync error |
| 186, 206 | Cleanup start, `worker-cleaned` | Normal worker cleanup observed |

The realtime parent receives every raw receipt. The existing
`createProgressReceiptCheck` advances `prior` and `final` at `followup-start`
(progress oracle lines 301–320). It therefore compares callbacks 182/183
against the correct stage. The metadata observer similarly advances after the
independently compared baseline and checks both complete update payloads.

The supervisor's retained-phase array (lines 225–244) omits `followup-start`
and `followup-publication`. It retains `public-change`, so its returned outcome
contains callback 182. All 21 returned receipts equal the source selector's
exact projection of the 206 raw receipts; this is not a corrupt raw capture.

`checkQueuedAnswerProgress` constructs another receipt checker and replays that
selected outcome (lines 517–518). It sees `final-publication` 161 and locks in
rank 30, never sees transition 162, then rejects callback 182 at line 341.
The captured outer stack and actual expected/received values match that path.
A pure Python snapshot-phase explanation of the captured trace finds exactly
this mismatch at 182; the full raw trace preserves the distinction. This pure
explanation is not execution of the TypeScript checker or receiving fixture.

This attacks **enforcement**, specifically recorder-to-comparison composition.
The model already contains the needed distinction. Under the repair-location
table, the repair belongs in evaluation: the retained observation projection.
No production edit, new contract decision, or relaxed rank comparison follows.

## Why the earlier pure checks missed it

`metadata-update-source-v2/pure-controls.mjs` lines 106–124 feed complete authored
receipts to the realtime root/downstream payload and metadata observers, then
call the shared finalizer. They do not pass receipts through the supervisor's
retained-phase selector and then through `checkQueuedAnswerProgress`.
The static preparation checks and native list/selector runs likewise did not
exercise that round trip. The earlier independent preparation review failed
to identify this composition gap. Its positive pure judgments remain evidence
for their stated input path, not for the missing post-run path.

The smallest general improvement is one source-shared retention selection,
with a pure round-trip calibration that uses the same selection as the real
supervisor. It must pass legal full programs through the post-run checker as
well as the realtime observers. This protects phase preservation when another
observation stage is added later.

## Correction proposal and required next evidence

Preserve the missing follow-up start and publication receipts in contiguous
order. Keep the existing phase-sensitive model and event accumulation; each
callback must be compared with its appropriate model phase. Reuse one retention
selection in runtime and calibration if practical. Do not infer the phase from
the callback's rank, accept rank 30 or 35 indiscriminately, stop at the first
final publication, discard follow-up callbacks, or remove the reload assertion.

Before any new native admission, the successor source/pure preparation should
show all of these obligations through the actual retained-outcome path:

1. Completed reload baseline and lawful quarter-2 same-key update pass their
   shared comparisons, followed by explicit per-history finalizer completion.
2. A wrong reload baseline, early follow-up transition, rank 35 before its
   transition, or regression after either completed stage is rejected.
3. Missing follow-up markers, omitted follow-up work, absent final publication,
   omitted cleanup, and stale or missing `previousValue` remain rejected where
   the governing checker requires them. Both receiving layers retain their
   update, exact-message, key, metadata and callback-read obligations.
4. Quarter-zero no-op and all old 17-state histories retain their original
   semantics. New 31-state obligations cannot replace or waive them.

These are proposed calibrations, not executed results. The correction must
load oracle-authoring before editing the relevant driver/checker. Root must
classify this frozen result and separately admit any later execution. This
attempt and all earlier stopped packets remain preserved.

## Guide qualification and limits

This is a bounded actual-result review, not a comprehensive oracle audit or a
repaired-oracle claim. ORC-001/002 authority and independent relational
reconstruction support this diagnosis; ORC-003 responsibilities are traced
across the existing named companions. ORC-005 fails for composition of the
post-run observation path. ORC-008's distinguishing history shows why the
reload/follow-up stage cannot be erased. ORC-009 terminology remains unchanged.
ORC-010 has the complete preserved capture and separately qualified outer,
child and cleanup outcomes. ORC-012 gets no closure credit. ORC-014 receiving
completion remains open because the selected test failed. ORC-015 has 31
observed counters for one fixed history, not a passing campaign or finalizer.

ORC-004/007 generated grammar/campaign conformance is not re-established here;
none was admitted. ORC-006/013 correction calibration and adjacent boundary
evidence remain next work. No specific shared production/model semantic fault
triggers an additional ORC-011 formulation: the demonstrated fault is dropped
phase information. ORC-016 source organization is unchanged; this review adds
no executable oracle or test registration.

Stable output metadata limits the actual receiver: copying current metadata
onto an otherwise correct previous ordinary row is equivalent in this domain.
The evidence does not prove changing-metadata sensitivity. The source update
uses a real eager source sync through the established QueryClient graph; it is
not a QueryClient-fetched marker/cache-reconciliation transition. The earlier
strict conflicting-cache queued-progress RED is separate and keeps its own
unreached terminal metadata boundary.

No production-first repair, expectation relaxation, quiet exclusion, generator
budget change, or product closure claim was made by this review. The actual
evaluation failure stays open pending a source-reviewed correction. Reviewer
artifacts join the coordinator's next documentation lint gate; no lint ran here.

## Reproducible reviewer audit

Run the adjacent script with `python3 -I -B`. It performs only file reads,
hash/JSON comparisons, a pure snapshot-phase explanation, and writes its own
adjacent audit JSON. It launches no native tests and probes no processes.

- Script SHA256: `5545aff9abcddf0bd999d04802a7e1ffe1a864cab9c7bc0759c738cbd04bf122`
- Audit SHA256: `0776f3a772e3680cb68fa3b9f99aaa0133d60ef2ebd3caf2be3dd307f985d1d6`
- Result: `QUALIFIED ACTUAL OUTER1 / CHILD0; CONFIRMED RETAINED-TRACE PHASE GAP`.
