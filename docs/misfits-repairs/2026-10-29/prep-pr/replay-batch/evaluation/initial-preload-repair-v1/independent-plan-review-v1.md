# Independent plan review: REPLAY-COMPOSITION-R02

Review version: v1. Reviewer: `/root/review_combined_held_cuts`. Scope: frozen test-only plan, additive correction, frozen diagnosis, and the stable production sources identified by that diagnosis. This is an independent plan review. It is not a review of the author's changing tests or an executed pre-production gate.

## Decision

The plan and correction have a sound accepted-law target and a suitable primary owner. They are a basis for test-only authoring. The correction resolves the plan's incorrect result-shape explanation. The concrete requirements below remain to be demonstrated in a frozen test epoch before production repair is accepted. No test-gate pass, repair approval, GREEN, mutant kill, or bug-class closure is granted here.

The decisive defect is the final quiet public `[]` versus independent `[10]`. Earlier identical-window fulfillment is an observed clue, not this review's contract verdict. The original plan stays immutable and must be cited together with its correction.

## Reviewed identity and evidence

All SHA256 values below were checked from the named bytes in this review.

| Input | SHA256 |
| --- | --- |
| `plan-and-receiving-inventory-v1.md` in this directory | `7fc5fbfc3268d6ebf11be378acde80f9df0bf0be1289d948a53381a8ba05ce5b` |
| `causal-correction-addendum-v1.md` in this directory | `05fb44226d8368d2ef9e3b13bdcd88dcfcf1bf8079075851d354bbe4a5715f2b` |
| Diagnosis `REPLAY-COMPOSITION-R02-source-event-v1.json` | `22d7c87591b93c8c419759071c00ffd38eaebd60a642646e86bc07ceccd4229e` |
| Diagnosis `runs/X03-exact-history-trace.json` | `54a673acacfbd99af3acce7e5ee2121695bcde03eae71725d894d4faa0038ecf` |
| Diagnosis `runs/X03-public-adapter-model-trace.json` | `eaee3fec48477b681c8b13bc14e374b898d1f9fa2dc5492911648ec083a53224` |
| Diagnosis `effective-traced-primary.source-snapshot.txt` | `771d4cc6dbbbc3b36c762844736f6d4476283a0dd400483f6f82528905cdd43f` |
| Diagnosis `causal-analysis-v1.md` | `80a9f1e602b92859c9f05eca15c0e6929132e9d6644ee41c08f640c5a7990142` |
| Diagnosis `causal-analysis-v1.json` | `bb18e688c5d3f39d3238d3abe6ba91eb34852c2c8b360ceb20ef6bcdc25ccf8e` |
| Stable C1 `collection-config-builder.ts` | `08a621237296456aad194a4b5087889016cd78049e570a1af6a21f471b53a8f2` |
| Stable C1 `ordered-source-loader.ts` | `1dfb9733f02c56807b1deb7904d24e6331b815a8b12386fef7bdbf691fe6ea2a` |
| Stable C1 `ARCHITECTURE.md` | `5b5aa10c6672e7e60e38c1d2f5f28fa1f956d60741fb75965808050a256130b1` |

“Diagnosis” means `integration/combined-C1-post-S004-v1/preload-window-diagnosis-v1` under this repair run root. Stable C1 is `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-combined-c0-s004-gate-v1`. The frozen snapshot contains diagnostic instrumentation; it is not asserted to have the uninstrumented primary source hash.

Required glossary, rubric, oracle-review skill, coverage-owner limits, and architecture contracts were read. The relevant frozen architecture sections were reopened against the C1 identity above. No runtime, build, test, lint, production edit, executable test edit, staging, or commit was performed by this reviewer.

## Authority and independent judgment

The governing promise already exists. Frozen C1 architecture, “Atomic window publication,” lines 1368–1382 requires completed-window publication, retention on failure, later successful retry, and retirement of obsolete participants. Initial readiness at 1558–1563 and normative laws 7, 9, and 10 at 1833–1855 separate applied acquisition success, coherent publication, and currently reachable demand. These sources authorize the final quiet result; no new identical-window reacquisition or initiating-stack timing policy is needed.

Reconstruction does not use the builder's participant set, ordered-loader states, or failure classifier. Roots are `(1,10),(2,20),(3,30),(4,40),(5,50)`. Markers name roots `1,3,4,5`. Inner join keeps those four roots. Ascending rank order followed by offset 0, limit 1 selects root 1, rank 10. Thus `[10]` is required once current work succeeded and no retained failure or replay barrier excuses withholding it.

The frozen X03 trace supplies those premises. Sequence 5 applies markers and starts keyed root2 while root0 waits. Sequence 7 rejects root0. Sequence 9 records root0's exact options unloaded, its signal aborted, owner count zero, root3 successful with all roots applied, and root2 still pending. Sequences 11–12 record root2 success, ready status and settled preload while public rows remain empty. Sequence 13 preserves move1's own rejection. Sequence 14 records latest move2 successful, no pending acquisition, no model replay barrier, and `remainingWorkSucceeded=true`; roots and markers remain publicly installed. The final missing result is therefore not explained by absent source facts at this cut.

The primary frozen model independently filters, sorts, and slices provider truth (`snapshot:482–519`). Its final comparison occurs before recovery truncate (`2092–2137`, truncate at 2148). The existing grammar already reconstructs the exact replay. Existing declared reach (`3397–3426`) protects preload replay failures, discarded moves, and preload checks, but does not force this joint failure/retirement/overlap schedule. This is a structural reach gap, not an incorrect final answer or an absent final comparison.

The source event records four guarded semantic RED executions across combined/standalone source/minified paths. This review inspected the frozen event and trace; it did not rerun or independently certify every run receipt or loaded module. Those runs reject minification-only causation and the necessity of companion composition. They do not isolate the precise shared branch.

## Concrete requirements for the frozen test gate

### R02-P1: Make the corrected overlap a measured grammar distinction

The original plan's statement that a literal-true replacement adds no promise is wrong for an explicit move. Stable loader lines 1117–1129 require no window-operation generation for synchronous completion; lines 1363–1378 wrap the result and register the tracked Promise. The addendum correctly retracts the causal inference. Provider result kind remains useful inventory, but cannot stand in for participant lifetime.

Keep two legal schedules in the focused family: marker-triggered root2 settles before move2 begins, and root2 stays required across move2 and settles afterward. Record the boundary observations, not merely the requested action order. The latter is the R02 overlap; the former distinguishes the conditional empty-set reset hypothesis. Preserve provider Promise coverage. If literal true is varied, establish applied rows before returning it and record the actual result kind separately.

Declare the joint state reached in each production driver before the final comparison can throw. A collection of unrelated per-event counts does not prove one history joined marker-first growth, original failure, exact retirement, successful replacement, and surviving work across the newer move. Choose and report a minimum for each material schedule/path. Fixed and random campaigns must use the same family and budget; an exact replay is additional evidence.

### R02-P2: Separate obsolete work from older work that remains required

The plan names older rejection and current failure, but does not yet specify enough observations to reject an overbroad generation-based repair. “Older” alone cannot classify a participant as obsolete. Architecture 1377–1382 preserves older source work that still gates the chosen window.

The gate needs these neighboring distinctions, whether supplied by the focused family or explicitly identified existing witnesses:

| Legal schedule | Required distinction |
| --- | --- |
| Root2 remains needed across move2, then succeeds | Final coherent chosen window must publish after required work settles. |
| Root2 remains needed across move2, then fails | Its failure must still receive the applicable current-operation/replay judgment; the repair must not discard it solely for its older operation generation. |
| Exact failed acquisition or demand retires, then its outstanding callback rejects, succeeds, or never settles | It no longer gates publication or readiness and cannot poison replacement state. Retired transport need not stop to prove this. |
| Current replacement fails after some writes apply, then a later explicit retry succeeds | Failure preserves the preceding settled read and event snapshot; successful retry publishes the new model window. |
| Older move rejects after newer success | The older receipt keeps its own injected error without reverting the newer window. |

Use a nonempty preceding snapshot and a distinct private replacement where retention would otherwise be vacuous. An initial empty snapshot alone is weak protection against a repair that simply removes the failure gate. Check exact error identity where already promised. Do not require an obsolete source to publish request-scoped rows after abort; that would violate the source contract.

### R02-P3: Credit the actual Query boundary only for observed premises

The pre-edit inventory correctly names a real default-cache Query marker driver and requires shared independent judgment. The gate must bind the actual receiving execution to the same initial/preload and marker-first root-growth premises. An ordinary Query success or retirement witness cannot supply this R02 premise by analogy.

For each claimed receiving path, report adapter acquisition attempts and accepted leases separately from `queryFn` transports. Include exact request identity, signal/unload outcome, result kind, applied receipt/delivery boundary, and remaining held work. Several acquisitions may share transport; cached true may start none. Cache or full-source reuse may change which schedules are reachable. Observe and report that result rather than forcing one acquisition per fetch or changing cache identity to reproduce the fixture.

Record per-path joint reach before assertions throw, including RED. If an advertised cache/result branch does not occur, mark it unmeasured and keep the receiving claim scoped. Do not derive expected values from Query cached rows or production participants. The driver should supply entry point, event control, and observation recorder to the shared model/history/comparison.

### R02-P4: Bind neighboring barriers and calibration to the candidate's scope

A reset of sync-run-wide failure state can affect initial preload, established windows, source replay, and cleanup. Before production changes, the inventory must name concrete receiving tests and their exact checkpoints for the relevant neighbors. Existing tests can discharge this requirement; new duplicate suites are unnecessary.

At minimum preserve initial success without failure, established ordinary lazy failure, held join/include read-and-event retention, and the R02-P2 distinctions. Identify active/failed/superseded/last-demand-retired replay coverage and cleanup/restart or reload coverage while old callbacks remain pending. The replay barrier must retain its own authority; an explicit move must not clear it. Sync-run checks must precede failure-state mutation. If a specific path is outside the proposed change, give the source-level reason and preserve that limit rather than claiming aggregate coverage.

Use the unchanged builder as the original hostile implementation for the final quiet failure, then retain or reintroduce that defect for repaired sensitivity evidence. Also challenge a plausible wrong repair: ignoring all older callbacks or allowing publication after a current failure. Checker controls must reach the shared comparison. Classify timeout, setup failure, unreached path, and semantic assertion rejection separately. A RED process exit alone supplies no control evidence.

### R02-P5: Preserve replay identity, observation fidelity, and evidence chronology

Retain seed `-1820259748`, path `264:3:2:4:8:8:5:5:6:6:6:6` for `replay.ordered-preload-recovery` without altering its arbitrary mapping. Add the focused family separately. Keep all existing budgets and normal source/minified obligations. Explain reconstruction, bounded ranges, semantic ablation, and a nearby invalid history rejected by the new grammar.

Capture final quiet observations before recovery truncate or cleanup. Capture callback-time values as immutable observations suitable for the row/event law. Keep exact acquisition retirement evidence and primary mismatches even when cleanup has secondary failures; release all resources. A skipped comparison or a classifier based on the observed empty output would invalidate the result.

Freeze tests, shared model/grammar/checker, drivers, imports/configuration, unchanged production identity, commands/environment, and artifact inventory before the author runs the new gate. Preserve every reported version. Obtain separate primary and actual Query semantic RED and separate positive controls before any production repair. A later combined receiving run must use the accepted test epoch and must not borrow standalone evidence for changed combined bytes.

## Rubric disposition at plan stage

| Requirements | Review outcome |
| --- | --- |
| ORC-001, ORC-002 | Accepted-law target and independent finite judgment are adequate in the frozen sources; new test sources still need review. |
| ORC-003, ORC-009, ORC-016 | Preserve literate responsibilities, canonical vocabulary, and shared model replay; compliance of unwritten/changing sources is unreviewed. |
| ORC-004, ORC-007, ORC-013, ORC-015 | R02-P1/P5 specify reconstruction, schedules, campaign parity, distinguishing neighbors and per-path joint reach; execution remains pending. |
| ORC-005, ORC-014 | Frozen controlled trace has sufficient facts at the final cut. Actual Query handoff is correctly inventoried but not demonstrated here; R02-P3 remains required. |
| ORC-006, ORC-010 | Original semantic mismatch supplies a sensitivity target. New controls, freeze, failure fidelity and cleanup must be inspected in the later gate. |
| ORC-008 | No new model state is proposed. Any added participant/verdict abstraction must identify a legal next action distinguishing it from existing state. |
| ORC-011 | No separate model is demanded: no concrete shared semantic fault in the finite relational rule was identified. Root2 scheduling is a history distinction, not a second-formulation requirement. |
| ORC-012 | This is versioned plan evidence only. Full conformance and closure require the frozen executable epoch, raw outcomes, per-path reach, relevant hostile control and explicit remaining coverage-map limits. |

The repair-location table places the accepted final quiet disagreement in production. Test work belongs in the primary owner's grammar/reach and the Query receiving driver. No evidence here supports changing the finite relational expectation or retiring an architectural law. The sticky-failure analysis is source-supported and experimentally distinguishable, but the minimal reset and scoped-ownership alternative remain unexecuted candidate designs.
