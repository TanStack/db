# Metadata retained-receipt source correction, epoch 3

This packet repairs a test recorder. It changes no product behavior. Root's
`metadata-update-receiving-root-classification-v2.json` authorizes this bounded
source/static/pure step. Independent source review and separate root admission
remain necessary before a fresh native receiving run.

## Diagnosis and repair

The actual failed receiving run captured 206 raw receipts. Its realtime
observer saw follow-up start at sequence 162, the root update to rank 35 at
sequence 182, and follow-up publication at sequence 185. The supervisor retained
21 receipts for post-run replay. It kept the callback but dropped both follow-up
boundaries. The post-run payload checker consequently expected the preceding
reload baseline, rank 30. This was a recorder stage-loss defect.

The sole changed existing source member is
`queued-answer-progress-supervisor.ts`. Its inline selection guard now calls
`retainProgressReceipt`, in the added pure support module
`queued-answer-progress-receipts.ts`. That function preserves the old phase
list and adds only `followup-start` and `followup-publication`. The corrected
selected trace has 23 receipts. Removing those two leaves the exact historical
21-receipt outcome, in the same order and with the same values.

The model, payload comparison, metadata comparison, production driver,
`metadata.finish()` call and generated budgets are byte unchanged. All 511
production source members match the predecessor. Of 588 predecessor members,
587 are unchanged; one pure support member is added, for 589 source members.

## Calibration of the actual handoff

`selector-roundtrip-controls.mjs` loads only an explicit allowlist of pure
models and comparisons. It extracts each supervisor's actual outcome-push
guard with TypeScript's parser. The old phase list is never copied into the
calibration. The corrected guard calls the same helper the supervisor imports.

The calibration also extracts the exact `run()` body from the unchanged native
parent test. Its receiving replacement delivers all raw observations, retains
the first observation error, returns the selected captured outcome, then lets
the actual body call `checkQueuedAnswerProgress` and `metadata.finish()`.
Counters wrap those calls without adding semantic requirements. No test
registration, supervisor process, Collection, QueryClient or receiving driver
is imported or executed. Captured host/provenance fields are premises.

On the 206 actual raw receipts:

- The old guard reproduces the rank 35 versus rank 30 mismatch in post-run
  validation. Realtime observation reports no error. The explicit finalizer
  does not run, matching the original failed parent execution.
- The corrected guard passes outcome validation and then executes the explicit
  finalizer once. The pure parent observes all 31 declared states.
- Fifty deliberately wrong observations are rejected. They include omitted
  baseline, start, publication, source acceptance/application, settlement,
  callbacks and cleanup; stale baseline and follow-up rows; absent, full-current
  and stale-prior `previousValue`; and each wrong public virtual field in
  `previousValue`, at both outputs.
- A control omits the whole follow-up and cleanup tail. Post-run outcome
  validation succeeds, but the unchanged explicit per-history finalizer rejects
  it. No aggregate reach assertion supplies that rejection.
- Post-run-only corruption rejects a stale follow-up callback, an omitted
  follow-up start and an omitted reload-final checkpoint.
- Copying unchanged current metadata onto the correct previous ordinary row
  remains accepted at both outputs. That is equivalent within this history;
  no changing-metadata sensitivity is claimed.

Twelve authored neighboring histories also pass the exact parent body: the four
old no-follow-up paths and eight positive/no-op follow-up paths. Every old path
reaches its original 17 states; subscription paths additionally require their
premise. Their old and corrected selected traces are equal. Follow-up neighbors
exercise an actual authored acquisition obligation in the pure trace. Stage or
settlement omission is rejected per history, including no-op stages.

The unchanged predecessor pure campaign also passes: 32 accepted controls,
140 rejected controls and 6,720 modeled receipt histories. These are pure
calibration results, not generated native reach.

## Static and preservation checks

Direct installed CLI paths were used; no `pnpm exec`, install or Git operation
ran. The scoped full TypeScript project passes. ESLint with every repository
rule enabled passes for both changed source members. Prettier passes for those
members. Logs and commands are bound in `static-results.json`. No oracle budget
was edited, removed or lowered. Broader documentation lint remains with root.

All 1,948 preserved inner failed-run assets and three outer assets were checked
against the existing raw manifest, including their byte lengths and hashes.
The old source freeze, raw assets and failed-result freeze remain unchanged.
The nine predecessor package-own maps still match all 2,544 payloads. This does
not accept the separate shared wrapper incident or establish complete transitive
toolchain/host equivalence. Root owns that recovery gate. The successor keeps
the predecessor dependency preimage rather than accepting changed wrappers.

## Oracle evidence boundaries

- **Law:** retained post-run receipts preserve each observation-stage boundary
  needed to judge retained callbacks against the same stage as realtime
  observation. Authority: root's confirmed instrument-defect classification,
  and the unchanged stage/model/publication contract.
- **Reach:** the failed native run observed all 31 counters; its explicit
  finalizer did not run. This packet adds pure replay with 31 states and a
  successful explicit finalizer. It adds no native reach.
- **RED:** old actual selection plus the actual parent/checker bodies rejects
  the captured lawful follow-up rank 35 against stale baseline rank 30.
- **GREEN:** corrected actual selection passes that pure handoff and finalizer.
  This is instrument calibration GREEN, not product or native receiving GREEN.
- **Mutant:** the old selector is the historical wrong recorder design.
  Fifty wrong-observation controls also fail the unchanged shared judgments.
  No production mutant runs in this source-only phase.
- **Limits:** strict Node assertions stand in for native Vitest assertions.
  Metadata omissions and complete `previousValue` are judged on realtime raw
  receipts; the retained post-run payload checker is not a second metadata
  checker. Fresh native receiving, strict cache-conflict progress recovery,
  changing-metadata transitions, generated native campaigns and product bug-class
  closure remain unestablished.

## ORC-001 through ORC-016

| Requirement | Outcome for this correction |
| --- | --- |
| ORC-001 | Instrument authority and limits are stated above; product laws are unchanged. |
| ORC-002 | Independent models and comparisons are byte unchanged. Selection is recording support, not expected semantics. |
| ORC-003 | The support module explains stage preservation; the unchanged owner explains law, model, grammar, path and comparison. |
| ORC-004 | Product grammar is unchanged. Actual failure is reconstructed by exact guard replay. Stage-selection ablation reproduces the mismatch; 12 adjacent authored histories and omissions are calibrated. |
| ORC-005 | Exact parent body and actual selected outcome reach post-run validation. No fresh production-path claim is made. |
| ORC-006 | Historical selector and 50 corrupt observations fail at the intended pure comparisons/finalizer. |
| ORC-007 | No generated property, seed, replay interface or budget changes. Prior pure finite controls are rerun; native campaigns remain gated. |
| ORC-008 | No reference-model state changes. The existing follow-up stage remains distinct because a later rank-35 callback distinguishes it from rank-30 reload state. |
| ORC-009 | Existing stage and publication terms are preserved; no new product/model abstraction is introduced. |
| ORC-010 | Original raw/source/result freezes remain intact; old mismatch and finalizer nonexecution are retained separately from successor results. |
| ORC-011 | No new shared semantic fault hypothesis: the confirmed fault is missing recorded stage boundaries. Exact raw versus selected replay distinguishes it without a second model. |
| ORC-012 | This record and the packet manifest bind the source, checks and limits. Product closure is not claimed. |
| ORC-013 | The actual follow-up stage distinguishes the old guard; old no-follow-up and no-op neighbors remain legal. Scope is bounded to these calibrations. |
| ORC-014 | No captured-premise result is promoted to fresh host/provider evidence. Fresh receiving remains unresolved. |
| ORC-015 | No generated grammar or declared reach changes. Every existing state must still appear in each relevant authored control; 31 raw-replay states are counted separately from native reach. |
| ORC-016 | No oracle unit tests are added. Wrong observations use the existing shared judgments; fixed histories reuse the unchanged parent, model and comparisons. |

This packet is ready for independent source review. It authorizes no native
run, production edit, PR action or canonical import.
