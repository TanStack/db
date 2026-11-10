# Independent review: receiving update and generated-neighbor plan

**Verdict: acceptable bounded source-preparation design, with one wording correction before implementation.** This is a source-only plan review. It supplies no runtime admission, production-change approval, receiving result, mutant result or bug-class closure.

Reviewed plan: `update-previous-value-and-generated-neighbors-plan-v1.md`, SHA256 `a256e975e090c5db6b7b5bd199abb49615429d6ae9b28e90375630ca6130b843`. Source anchors refer to the receiving worktree at detached source commit `9cfa11fc712866f8f276e85762865ebb8bd49cbe`. The plan and all frozen sources, packets and actual outcomes remain unchanged.

## Preparation correction: locate comparison in the parent

The plan twice places the driver's follow-up after the first `final-publication` “has been compared.” The current child emits receipts; the parent runs `createProgressReceiptCheck` and `createMetadataReceiptCheck` as it receives them. Emitting the receipt does not tell the child that the parent has checked it. Literal implementation of this wording would require an unnecessary acknowledgment mechanism or would claim an acknowledgment that does not exist.

Use this boundary instead:

1. The child establishes the actual complete reload baseline and required applied settlement, records its real `final-publication`, and emits that receipt before `followup-start` and the source write.
2. The parent consumes contiguous receipts in order. It accepts `followup-start` only after it successfully compared the preceding reload-final root/downstream snapshots and aggregate messages. It stores the independently computed expected baseline and its validated entry bindings then.
3. A baseline failure remains the primary failure. A follow-up receipt cannot reset or erase it. No child-to-parent acknowledgment is required.

This is an observation-protocol clarification, not a product-law revision. The receipt sequence records the causal order even if the child has already executed later work when the parent reads the earlier receipt.

## Independent result and before-state

The promised follow-up is independently reconstructible. Five authored roots have ascending ranks `rankScale` through `5 * rankScale`. After the finite reload, the unmarked roots are IDs `keyShift + 2`, `keyShift + 3`, and `keyShift + 4`. The existing ascending offset-one, limit-one model therefore selects ID `keyShift + 3` at rank `3 * rankScale`. Changing only that source rank to `(3 + quarter / 4) * rankScale`, for positive quarter one through three, preserves its selected position and changes its ordinary value. These small integer and quarter domains use exact binary arithmetic.

The follow-up before-state must remain the independently computed, successfully compared reload-final value. It must not be reconstructed from a later observed row, the earlier row4/rank40 baseline, the Query cache, or the follow-up event. Keeping the original prior/final model answers and adding an explicit further stage is appropriate. The new stage is an oracle observation abstraction; it does not stand for a new production controller state.

For default keys, the proposed locked reload-final binding is sound within the declared stable source/join topology. Complete entries first have to match independent ordinary rows; the follow-up must retain those public entry keys. It must not bind a new observed key as its own expectation. This preserves freedom in the opaque key encoding while detecting key churn. Authored root/downstream keys remain independently predicted. Selected upstream metadata must use the locked root binding. A delete/insert pair cannot earn same-key-update reach in either lane.

## Law, actual boundary and mutation sensitivity

The architectural Coherent publication section requires installed state, synchronous reads, change-event payloads and downstream queries to observe the same complete materialized commit. The public Delta Events description identifies an update's `previousValue` as the row before the change. The shared metadata judgment already combines the independently computed ordinary payload with the accepted structured-projection attribution rule, and requires exact before/after messages without collapsing duplicates.

Accordingly, a real retained-key rank update owes a complete preceding public row in the actual root and downstream update messages. Missing `previousValue`, the full current rank35 row, or the older row4 reload baseline are distinguishable from the correct row3/rank30 previous row. They should fail the existing shared judgment, with actual native messages and comparison reaches recorded independently for both outputs. A root failure must not be borrowed as a downstream mutant kill; targeted mutations may be necessary.

The payload mutation is a direct eager source Collection sync `begin/write(update)/commit` after reload. QueryClient continues to provide the established marker/anti-join graph. This legitimately receives the Collection publication and downstream propagation obligation for that **direct source update through the established QueryClient graph**. It does not receive a QueryClient-fetched marker update, a Query DB cache-reconciliation update, adapter-origin `previousValue`, or an update during the held reload barrier. Those paths remain open under their applicable owners; calling this a QueryClient-fetched update would overstate the boundary.

All four output metadata fields remain stable in this profile. Full previous-row comparison is still useful, but a mutant that copies current metadata onto an otherwise correct previous ordinary row is equivalent here. It cannot be claimed killed merely because a full-current-row mutant fails on rank. The plan correctly excludes transitions between distinct optimistic/source metadata values; retain that distinction in the eventual evidence account.

## Repair and the comparison cut

The interval calculation proves relative ordering only. Rank is an order term, so changing it may invalidate prefix authority. The architecture's ordered-repair and applied-settlement obligations remain applicable. The plan correctly requires serving resulting real finite provider work and waiting for required applied receipts without treating source `commit()`, readiness, a quiet Query cache, or two host turns alone as proof of whole-graph publication.

Implementation preparation must identify how it observes the actual complete root/downstream graph cut and distinguishes it from source application. Keep the callbacks throughout any repair, preserving the existing complete-snapshot barrier. Retain an acquisition-to-applied-settlement account when repair happens. Actual repair activity is conditional reach, not a reason to force a provider request. If the driver cannot faithfully establish the cut, stop at the stated driver gap rather than silently moving the assertion later or bypassing repair. This is an unresolved implementation obligation, not evidence that repair currently occurs or that the proposed history currently completes.

## Grammar, scope and minimality

The positive-quarter coordinate creates a real second transition without perturbing the existing failing conflict phase. Explicit registration for each cache/key lane avoids aggregate reach hiding an omitted path. Translation, scale and positive update-distance variation are useful bounded neighbors; they are not a claim to cover every metadata history. Quarter zero supplies a distinguishing no-op control. The original four replacement inputs, strict conflict witness, scope ablation and all existing campaign budgets must survive unchanged.

Use the same model, driver, recorder and comparison in equal-budget fixed and unseeded campaigns for each lane, with direct seed/path replay. Follow-up reach must require actual update messages and full previous-value comparisons at both outputs, not phase names or a passing final snapshot. Strict follow-up states stay UNREACHED when the existing queued-progress defect prevents execution. Scope GREEN cannot lend strict reach.

This is a practical small extension: one authored rank coordinate, an additional observation stage, existing source sync control, and shared judgments. Adding a new nonordering field could avoid some repair work, but would add another modeled and compared payload dimension. No concrete shared semantic fault here requires a second full relational model. Do not replace the existing model with a cache-shaped state machine or add a cross-process acknowledgment solely for the wording corrected above.

## Evidence and review limits

The existing scope cells are delete/insert GREENs; strict cells are bounded queued-progress REDs. None establishes this proposed follow-up. Running a real stable-key follow-up GREEN on unchanged production calibrates new receiving coverage. It must not be presented as an invented metadata RED. A later actual metadata failure must reach the intended update comparison and preserve its failure separately from setup, resource, timeout and cleanup outcomes.

The plan preserves the oracle-first ordering for any subsequent progress repair and requires actual production mutants for later receiving claims. Pure wrong-observation controls can calibrate the checker before runtime admission, but cannot replace receiving path evidence. Frozen packet/provenance changes need a successor packet. No previous packet or result should be overwritten.

For this plan review, ORC-001/002/008/009 have a supported bounded design; ORC-003/004/005/006/007/010/013/014/015/016 remain implementation-and-evidence obligations as described above. ORC-011 has no additional concrete shared-fault hypothesis requiring a second formulation within this bounded extension. ORC-012 supplies no comprehensive executable-oracle or bug-class-closure verdict here. Existing paths with distinct metadata values, QueryClient-origin updates, held-barrier overlap, second reload, other providers/schedules and framework receivers remain outside this plan's evidence.

Review work consisted of source/document reads and hashing, followed by this report. The current review reopened the oracle-review skill, complete glossary/rubric, applicable coverage account, shared metadata judgment, ordinary model, driver and relevant architecture/public-guide contracts. No native test, collection execution, receiving run, mutant, process probe, installation, source edit, Git/worktree operation or canonical cutoff/status/manifest update was performed. The coordinator should include this report addition in its next documentation lint gate; this review did not run lint without runtime authority.
