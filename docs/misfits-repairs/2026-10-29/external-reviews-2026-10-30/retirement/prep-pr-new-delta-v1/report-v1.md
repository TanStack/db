# Retirement prep review evaluation

No law change needs a decision. The additional P2 finding was a generated-reach enforcement gap, and it is repaired. The sole optional P3 cleanup remains unapplied for the prep-pr one-at-a-time user decision.

HEAD is `5e3cb22a4c94c9c64889bc6537976a62b8341dcf`. Working oracle SHA256 is `fbbaef1c6a2c43740517ff075de7dd0bf3e33219b2fcba1895f0c81e2ce0964f`. Production remains unchanged. Only the oracle and its existing coverage-map row differ from HEAD. The original five-item evaluation and its frozen patch remain separate and unchanged.

## Law, experiment, and inference

The accepted atomic-window law retains the prior complete snapshot and emits no partial publication while the authoritative replacement answer is held. Its authority is ARCHITECTURE.md, Atomic window publication. ORC-015 requires generated reach at the claimed observation cut separately for each receiving path. The original model, shared driver, held assertions and fixed replays were already correct; unload-only reach buckets did not prove the generated campaign reached those assertions.

On unchanged production, replacing the receiver's held-answer boolean with constant false passed the old campaign, reproducing the test-integrity false green. The repair retains unload buckets and adds Collection-held-answer and Effect-held-answer buckets. They record only after the held-answer premise, prior-window comparison and empty-publication comparison pass, before answer release. The same always-unheld ablation now fails at the intended reach comparison: both held buckets are zero against minimum 20. This is a reach-check RED, not a public product defect or setup failure.

The restored generator passes all 55 state-owner tests. Fixed held reaches are Collection 47 and Effect 55; random reaches are Collection 43 and Effect 52. Fixed unload reaches are 98/102; random unload reaches are 107/93. The model, grammar, public assertions, production path, request progress relation, run budgets and independent expected rows are unchanged. The coverage row now states separate unload and held-answer reach. This closes the reported obligation within the existing receiver bounds; it does not prove every possible lifecycle composition or provider transport.

Exact experiment receipts and raw log hashes are in the parent experiments.jsonl:

- `prep-R01-original-unheld-falsegreen-v1`: old reach accepted the ablated grammar, exit 0.
- `prep-R01-enforced-unheld-RED-v1`: new reach rejected it at missing held buckets, exit 1.
- `prep-R01-owner-GREEN-v1`: restored repaired owner, 55 tests pass.
- `prep-R01-scoped-types-v1`: scoped TypeScript check passes.
- `prep-R01-lint-final-v1`: lint:changed passes. Prettier and git diff --check also pass.

All temporary changes were restored; loader SHA256 remains `1dfb9733f02c56807b1deb7904d24e6331b815a8b12386fef7bdbf691fe6ea2a`. The earlier 104-test neighbor result belongs to the frozen pre-reach bytes; it is retained as historical evidence rather than represented as a new exact-byte run. A repeated neighbor campaign was unnecessary for the reach-only amendment.

## Lossless ledger

| ID | Verdict | Action and durable value |
| --- | --- | --- |
| PREP-RET-R01 | Confirmed P2 test-integrity gap; fixed-now | Four reach buckets enforce both cuts in both consumers. Always-unheld calibration demonstrates sensitivity. |
| PREP-RET-S01 | Valid optional P3 clarity; confirmed-open pending optional decision | Explicit fault/start records preserve all numeric values and correct the equal-clock label to at-publication. Draft removes 120 test bytes, with zero production change. |

Both raw source outputs and the narrow follow-up review are retained. No item, footnote or nonblocking proposal was dropped. No new sibling violation was found. The optional P3 decision is distinct from an uncompleted accepted-law repair.

## Reviewer assessment

Quality reviewer: hire. The P2 identified a real distinction between fixed replays and enforced generated reach, proposed the smallest repair at the correct cut, and supplied a useful ablation. Executable verification confirmed the claim and remedy. The narrow follow-up found no new findings. The reviewer made no unsupported product-bug claim.

Simplifier: hire for focused cleanup. The sole proposal is modest and accurately optional. Its explicit record form is easier to read, and the proposed label matches the clock values. Numeric equivalence is checked in simplification-equivalence-v1.json; no product RED is appropriate for that nonbehavioral suggestion. Its runtime checks would run after application if accepted.

## Implementation and readiness

The required P2 repair and coverage amendment are applied and checked. The optional P3 patch is prepared and applies cleanly but is not applied. Root owns its Add/Skip presentation and the final prep-pr gate. No commit, push, changeset modification, PR body change or external publication occurred. Slot 1 is released with no active execution sessions.

Item accounting is complete: 2 raw items = 1 fixed-now + 1 confirmed-open optional decision. The original external review remains 5 items = 3 fixed-now + 1 refuted + 1 stale. Whole-PR readiness remains unproven by this scoped task: the new diff is uncommitted/unpublished, and final pushed-head CI and intended companion integration remain coordinator work.
