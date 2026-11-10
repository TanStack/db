# Independent actual review: full-child failure receiving

**Instrumentation failure; no receiving product RED or GREEN.** The intended first handled-failure/pre-peer-release cut and its shared failure judgment were not reached. The original-peer guard component and raw callbacks 302/315 remain **UNCLASSIFIED** as product behavior. The checkpoint phase collision is now confirmed by frozen source plus raw order, rather than remaining only a hypothesis. No source was repaired, no run was admitted or repeated, and slot 2 is returned.

Reviewed E freeze: `5dd02625d22a6f096470737b3d09a447cf89c985d91f819e5e30cdda5c5e7b8a`; E report `a996ecb6ba66a560297c19b70fd2fb4efcec581e7c9bceb88a486b2312e089b3`; summary `cc46d3a0581aa6109677da0293797fb3609a43869dd673dd97c09ee536e51eab`. E is `candidate-controls-pagination-shared-window-failure-receiving-runtime-v1` beside this report's directory. Bound worktree/base remain `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-candidate-controls-v1` / `9cfa11fc712866f8f276e85762865ebb8bd49cbe`. The freeze supplies the exact source identities beyond that base; no Git action occurred.

## Law, experiment, inference, and missing enforcement

The authority remains “Atomic window publication” in the bound architecture, beginning at line 1366: an imperative window move with unfinished required work keeps the last settled complete public snapshot; required refinement failure cannot publish the private partial replacement. Lawful retirement of the original peer is permitted. The first failure barrier may observe that original peer pending or observably retired, without inventing a no-cancel law. The independent shared reference uses authored root/marker/child facts and full recomputation, rather than production loader or cache classifications.

This actual invocation attempted the real QueryClient receiving path for that law. Its earlier held-window data are retained, but instrumentation stopped before the exact failure disposition and public failure cut were recorded and before failure-epoch callbacks were replayed through the shared comparison. An injected backend error, an observer exception, a broad identity guard failure, and a partial raw callback are distinct evidence; none substitutes for the missing gate. The same-recorder successful neighbor, real later failure settlement/retry, hostile calibration, candidate states and wider class closure remain open under the pagination coverage-map owner.

This reviewer performed read/hash/strict-JSON/source reconstruction only. Independent audit `4a4a90` / session61853 / final `868bba` exited 0. Facts `shared-failure-actual-independent-facts-v1.json` SHA256 `0a01f7f2f65ff02f70601950ed10f64769a7785cbe5b8b912ef4bd4f4df6f88a`. No bound module, model, helper, supervisor, configuration or compiler was imported or executed. No native/process/signal probe or fix occurred. The object-spread reconstruction below is a static envelope calculation over captured data and source-defined phase constants, not an execution of the oracle or a retrospective product judgment.

## Exact execution and evidence integrity

ROOT's failure-only admission `61d6c5fee04057a468647bc392127d43f5f092708e287aa3b43cd932be439769` matches all five exact pins. The actual tool receipt records elevated `3be14d` / session90331 / final `d1dc4d`, exit 1, with the admitted Node executable, two arguments and cwd. It transcribes retained tool observations; omitted wall times and lexical shell quoting remain omitted. This record is distinct from parent and inner completion. The failure-only admission is spent and supplies no retry or success authority.

The parent command exited 1, signal null. Its complete stdout names one test, one failure, the exact plain title “checks a selected baseline constituent through the shared judgment” and exact source file. The inner command likewise exited 1, signal null, logging one test/one failure with “records a source-bound completion receiving gate.” No FastCheck suffix or ancestry fallback is needed. Outer stdout parses exactly to the retained parent outcome; outer stderr is empty. Parent and inner streams and outcomes are retained separately, including all four parent diagnostic errors.

All **1996** manifest members / **36035934** bytes match, with the freeze itself excluded and no unexpected file. All **1972** raw copies match their still-available original bytes and recorded sizes/hashes. Frozen binding copies match their originals. All raw 323 receipts parse and have exact contiguous sequence 1–323. The selected excerpt consists only of original complete lines; it is not a replacement for the full stream.

The audit rehashed 596 active source bindings, 85 immutable copies and 511 unchanged production files. Node, two locks, four reuse links and the same finite named dependency closure match: 255 unique roots, 11974 exact own regular payload files, 405 declared resolution edges and 112 absent optional/peer dependencies. This is not a broader dependency or native-runtime equivalence claim.

## Confirmed recorder defect: checkpoint phase collision

`H02-D-CHECKPOINT-PHASE-COLLISION` — **confirmed-open instrument defect**, not a product defect.

The physical checkpoint is supposed to precede closing and replaying its callback interval. The complete public cut is supposed to follow that close. The source implements those distinct concepts, but their transport identity collides:

1. `queued-answer-completion-baseline-driver.ts:1012` puts `phase: completion-baseline-cut` in `common`.
2. At line 1024 it calls `emit(completion-baseline-checkpoint-captured, common)` before `closeEpoch()`.
3. `receipt-transport.mjs:102–104` builds `{ h02: true, sequence: ++sequence, phase, ...details }`. The payload's `phase` wins.
4. The actual first physical checkpoint is therefore raw **291**, `phase=completion-baseline-cut`, without the later cut's `operation`/`pendingProviderAnswers` fields. Raw **292** ends `1:held-window`; raw **293** is the complete held-window cut with `operation=window` and `pendingProviderAnswers=2`.

This chain is present in frozen evaluated driver `fd18243a473264578e18ab7685ee9c03afc0be0bcf5d14c2ca45760f7ddfa958` and writer `2a9261ce37221b142ebce90077d9ade71d096d55938f7f1038ecff01f4e07eb0`, with their bound retained V8 sources. Static object-spread reconstruction with the source-defined phases gives raw 291 exactly. No raw `completion-baseline-checkpoint-captured` receipt exists. The prior source-preparation review missed this integration between the payload field and writer spread order; its bounded source acceptance never supplied execution evidence.

The parent guard at `queued-answer-completion-baseline.test.ts:425` correctly rejects a complete public cut while its epoch is still active. Its original observer error is “public cut preceded its complete callback interval.” The stack locates this observation in the supervisor's final drain (`supervisor.ts:480`), after the child had exited. `killAttempted=false` is preserved: there is no basis to blame the parent's observer exception for the child's preceding guard failure. The observer guard must remain strict.

**Narrowest proposed correction, not applied:** fix only the pre-close checkpoint emission so its payload cannot override the marker's phase. A local expression such as `emit(checkpointPhase, { ...common, phase: checkpointPhase })` leaves the typed final-cut observation and shared writer behavior untouched. Equivalently, build an unphased physical payload locally. Do not relabel or reorder the retained raw 291/292/293 records, skip receipt 291 during replay of the original run, move the complete cut earlier, or relax the parent's active-epoch guard. A global writer-envelope change is broader than the immediate correction and needs its own caller audit.

**Minimum calibration before a successor claim:** use the actual receipt writer/reader boundary with the same parent routing judgment to show marker → epoch-end → complete cut remains three distinct receipts, the marker does not invoke the complete-cut comparison, and the complete cut invokes it exactly once. Preserve a wrong pre-close complete-cut control that still fails the unchanged guard. Include the old colliding payload as a sensitivity control; it must reproduce the premature-cut error, while the corrected local emission must retain the marker. These are proposed controls, not executed evidence or admission. Any oracle/driver edit must follow oracle-authoring guidance and receive a fresh exact source freeze.

## Peer guard and raw callback evidence remain open

`H02-D-PEER-GUARD-DIAGNOSTIC-GAP` — **confirmed-open evidence gap**. It does not identify a product defect or establish a false-positive guard.

Raw **289** records the original children request 2 for parent [3], load 2, generation 0, enteredAt 227, receipt 80, options 78, signal 79 and the complete query key. Raw **295** fails marked request 2 with `baseline-source`; raw **296** records marked load 2 rejecting with that exact registered error. The injected Query error appears separately in child stderr.

The child then throws at `baseline-driver.ts:818`: “completion instrument: original held peer binding changed before failure barrier.” This disjunctive guard checks request appliedLoad/options/queryKey identities and query-key snapshot equality; request source/ID; and each load's provider-list membership, ID/source/generation/entry, receipt/options/signal/queryKey identities and key snapshot equality. It records no failed clause or before/after values. The raw guard error proves at least one expression rejected the binding. It does not say which one changed, whether a saved snapshot was faithful, or what the original peer's pending/retired disposition was.

**Minimum diagnostic correction, not applied:** preserve every current predicate and the same failure, but record the failed predicate label(s) immediately at this pre-cleanup guard. Supply recorder identities for the relevant saved/current object references and the relevant scalar or key snapshot for each failed clause, retaining actual source/load identity and generation. For a snapshot-equality failure, retain enough representation information to distinguish mutation from a cloning/prototype mismatch; ordinary JSON alone erases that distinction. An immediate post-bind self-check of the saved query-key snapshot can distinguish an already-unfaithful snapshot from a later change. No specific snapshot defect is established by this run. Do not replace the bound original peer with a newly selected request, infer cancellation from absence in the pending list, delete identity checks, or require that the peer stay pending.

Raw **302** is a root callback and **315** a downstream callback; each inserts row 3 with `children=[]`. Their complete reads and change messages are retained; the inserted changes have no `previousValue` field. They remain **UNCLASSIFIED** product evidence in this review. The failure action did not finish, no `baseline-source-failure-applied` proof or source-failed-peer public cut was emitted, and no normalized failure-epoch callback was replayed through the shared comparison before cleanup. The raw callbacks do not turn outer exit 1 into receiving product RED. A successor must first establish the exact original-peer premise and run the promised judgment through the intended boundary.

## Binding, resources, cleanup and validation

The retained verifier reports `bound`, `completion-baseline-v1`, 340 binding entries and failures []. I rechecked each declared evaluated-inventory association, source allowance, retained transformed-source digest and retained V8-source digest. The sealed startup inventory, acknowledgments and inspector disconnect-before-history flags remain intact. Startup compiled inventory may contain unused code; child module evaluation does not prove invocation of the independent parent checker. No precise runtime coverage was collected. Runtime coverage/typecheck remain false in unchanged standalone Node/jsdom configurations; the earlier scoped static TypeScript pass stays separate and no ordinary package runtime credit transfers.

Outer sampled elapsed time is 3020.879292ms and peak aggregate RSS 707510272 bytes, below 60000ms/1GiB limits. Inner is 2290ms and 453361664 bytes, below 20000ms/1GiB. Both signals are null; outer heap=false, identityMatched=true, cleanupErrors=0, remainingGroup=0, cleanupDiagnostics=[]; inner killAttempted=false and cleanupErrors=[]. No resource trigger is recorded. These are finite sampled/recorded observations, not proof about unrecorded signal attempts or escaped groups.

Raw **317** starts cleanup; **319** rejects children load 2 with registered `error:5` during cleanup; **321** records cleanup complete; **322** positively records worker-cleaned; **323** records the original guard error and stack. The supervisor also retains 322. This positive cleanup evidence is not erased by the parent's unexpected-worker/omitted-observations diagnostics. Conversely, cleanup-time rejection cannot establish the original peer disposition at the missing earlier failure cut, and `error:5` alone establishes no AbortError identity/name there.

Original owned-group before/final inventories are both empty. Saved named-only elevated check `8a89fe` exited 1 with empty output for exactly outer PID 83258, parent group 83269, parent test worker 83272 and inner group 83275. This establishes absence of those names at that saved check only. I ran no process probe. The inner failed-kill path and spawn/registration-race limits remain uncalibrated.

Post-run audit `ca1b5ac86b43f8ccdd5ea0b9462beb92aff717c47ac6c68447937e790abdd77d` remains retained. Its initial read-only audit failure `29ab82`, exit1, wrongly resolved relative material-package paths against cwd and wrote no partial result. The corrected audit resolves them against the frozen worktree. Both adverse record and successor remain; this reviewer independently checked the same current closure, rather than normalizing that failure. Historical recovery false flags/four unrelated A38 mismatches remain untouched.

Latest saved exact lint remains `d04e0b` / session70292 / `99c04e`, exit0, account `ea0627d641fe84ccb1aa1e9683ffd09715812cca11bba7f8e8fd5d0b6b8d1874`. Later additive capture/review artifact validation is **PENDING ROOT**. The task expressly assigns final coordinated lint to ROOT; this static reviewer did not execute another lint or validation command.

## Rubric outcomes and loss audit

| ID | Actual-result outcome |
| --- | --- |
| ORC-001 | Accepted atomic-window authority unchanged; result limited to instrumentation failure. |
| ORC-002 | Shared independent reference unchanged; intended failure judgment not reached. |
| ORC-003 | Existing prose and five oracle responsibilities unchanged; this report supplements actual evidence. |
| ORC-004 | Fixed constituent selected; no generated grammar/reconstruction/ablation execution credit. |
| ORC-005 | Real receiving path and raw callbacks ran; exact required failure premise/cut/comparison remains unestablished. |
| ORC-006 | No checker sensitivity, hostile-mutant rejection or repaired GREEN supplied by this run. |
| ORC-007 | No fixed/random/replay campaign credit; one separately admitted plain constituent only. |
| ORC-008 | No model-state change; trigger absent. |
| ORC-009 | No changed semantic vocabulary or abstraction. Physical checkpoint and complete public cut must stay distinct. |
| ORC-010 | Original observer/guard/backend errors, raw callbacks, secondary diagnostics, full streams and positive cleanup preserved. Instrument fidelity still needs the proposed transport calibration. |
| ORC-011 | No proven shared semantic fault requiring a second model; trigger absent. The recorder issue is an instrument fault. |
| ORC-012 | All sixteen outcomes recorded; no closure claim. Unresolved cells remain with the pagination owner. |
| ORC-013 | Required failure/success distinction not established; successful neighbor still unrun. |
| ORC-014 | Real QueryClient execution occurred, but the required controlled premise was not established at the failure checkpoint. Receiving handoff remains open. |
| ORC-015 | Intended failure reach receives no count; no candidate-state or actual-helper reach credit. |
| ORC-016 | No oracle/source edit. Retained programs still target shared judgment; no standalone expected answer introduced by this review. |

All ten received categories are accounted for: admission/tool-versus-child; complete frozen assets/originals; exact tests/observer error; transport phase/order; original-peer guard and missing cut; full raw callback values/change/previousValue; binding limits; resources/cleanup/absence; post-audit/lint limits; bounded verdict/minimum correction/no admission. Two new instrument/evidence items remain confirmed-open; the raw partial-callback interpretation remains an open evidence item, not a product finding. No item was dropped, deferred or rewritten. No repair occurred in this review-only assignment.

The author's actual-result reporting is accurate and appropriately restrained: it preserved both failures, complete raw assets and positive cleanup without claiming receiving RED, and labeled the phase diagnosis unverified pending independent review. The diagnosis is now stronger because of the source/receipt reconstruction. Hire recommendation for evidence capture and reporting: yes; the instrument needs the corrections and calibration above before a successful receiving claim. Whole-PR readiness is not assessed.

Failure admission is spent. Source hold remains active. Success, retry, production edits, canonical import and publishing remain unadmitted. All 20 candidate states and actual-helper/no-active-operation remain UNREACHED; state 14 remains proposed. Earlier controlled primary bounded RED gains no further receiving credit. No rerun is implied by this report.
