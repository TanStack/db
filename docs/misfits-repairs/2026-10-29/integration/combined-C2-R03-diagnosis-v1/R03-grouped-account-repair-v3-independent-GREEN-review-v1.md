# R03 grouped account repair v3: independent correction and GREEN review

Reviewer: `/root/review_combined_held_cuts`. Scope: the seven accepted corrections and one same-14 calibration GREEN after the accepted v2 RED. This is source and immutable evidence review. This reviewer ran no tests, compiler, lint, campaign, or mutant; Python only parsed artifacts, reconstructed the patch, compared bytes, and hashed files.

**Verdict: ACCEPTED for the next two commands conditionally authorized by root.** The seven corrections address their accepted findings, and the unchanged actual-driver calibration now passes all 14 schedules. Root and author were directly notified before this record was frozen. The author may run exactly the guarded original R03 replay and the seven finite semantic cases once each on the frozen repaired source, preserving argv/environment/replay mapping, then STOP. A failed first command or missing guard does not authorize the second. No 120/600 campaign or mutant is admitted.

## Bound packet and independent controls

Packet directory, relative to coordinator worktree `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items`:
`docs/misfits-repairs/2026-10-29/prep-pr/replay-batch/evaluation/initial-preload-repair-v1/r03-grouped-account-repair-v3`.

| Artifact | SHA-256 |
| --- | --- |
| primary after snapshot | `260adf375d0119d4cb8ad54e26d3d546981fe2a56b1efa3bbe1d6bb197b337fc` |
| `input-freeze.json` | `1a825b0699cf597d0540ff4e5b97dce0a871c89102a16a756924b66061450465` |
| `grouped-repair.patch` | `eea8fd7ea07e069c2758f6af9124e9bc5c18426d94279aacb64fbfaa5dab0f18` |
| `packet-freeze.json` | `e7588d0de8a350215d6750adb184a21b0a920784078f12f8dbccc09e4141f432` |
| `static-closeout.json` | `3a55a7567c89e2fa128c489d114335e8f76f261fd5e9b6e4714f5aaf8c6b8d32` |
| runtime `result-freeze.json` | `e5b75ec33de8f9ffccff37f8edb22c8211b9310c6268d89fd27f35056b8258b0` |
| runtime raw log | `272a3ced24e2a13db3f0a30cb884f17c29df3a86cba55772a820efe4e9069198` |
| runtime receipt | `b2940cc5d1c10097d439fc13b25a67bd008cf1d5bc89a8313525de84e8b5391c` |
| runtime per-case classification | `a211f8ad810cffb61ea35682c45519b955569b79b6a4977262c1767a9eb01bd8` |
| runtime closeout | `218b00cdf7fb5da9c4e13fffa20888e8558f0ea46fa8a558ca168ccf4ea8d87f` |

Independently verified all 18 source-packet artifacts and all eight runtime-result artifacts. All 1,415 actual author-worktree files match the repaired freeze; receipt before and after equal that freeze. Comparing the prior v2 freeze shows precisely two changed bound files: the primary oracle and `docs/contributing/oracle-coverage.md`. All 511 production files retain identity `60d0fa772d95a340042bf3776c67da573cd407ded732dcb4d7f776f5da339a42`.

Reconstructed the combined primary/coverage unified diff from the exact before/after snapshots; it equals the frozen patch. The same-14 schedule/generation/execution block and `checkFinalDrainOutcome` comparison are byte-identical. The command is identical to the admitted RED command. The patch preserves all original routes/arbitraries and run budgets, including the 600-run campaign. No comparison relaxation or production repair was introduced.

The three author static receipts are hash-bound, each exits zero, and each nested before/after source snapshot equals the repaired freeze: TypeScript 15.304 s, lint 42.406 s, format 0.595 s. This reviewer did not rerun them. The static closeout was frozen before GREEN and says runtime was not yet performed; the later immutable runtime result supplies that result.

## Seven corrections

The accepted law and original finding accounts remain the authority; no new error-priority law is introduced.

| Finding | Reviewed correction and disposition |
| --- | --- |
| `R03-FINALIZER-UNKNOWN-001` | `ReplayDrainFailure` is a frozen event with origin, phase, and unknown reason. Primary presence stays tagged. The finalizer excludes only the exact event already promoted to primary, rather than removing equal reasons. Separate undefined/null/shared reasons remain distinct late events. Accepted source repair; bounded actual-driver RED/GREEN demonstrated. |
| `R03-FINALIZER-WIRING-001` | The same real-driver calibration, sole finalizer invocation, and outcome comparison remain. It now tests what the actual invocation returns after final drain. Accepted calibration correction; planned missing-invocation mutant remains unexecuted, so no mutant-kill claim. |
| `R03-CLEANUP-RECHECK-001` | Actual public cleanup catches route through `swallowCleanup` and the origin-aware receiver. Final-drain cleanup rejections enter the event ledger even when their Error identity belongs to injected failures. The final judgment includes them, and each restoration action is independently attempted through `cleanSync`. Accepted repair; all cleanup/primary schedules now pass. |
| `R03-REACH-LOCAL-001` | The local-success reach requires at least one live own obligation with outcome `ok`, as well as no live unfinished own obligation and another subscription's pending work. The previous all-retired/all-aborted false positive no longer satisfies it. Accepted predicate repair; measured semantic reach is still pending. |
| `R03-REACH-COMPLETED-CUT-001` | Each immutable receipt records `loads.length` when the model freezes it. The reach requires a later issue's zero-based index at least that captured count. A demand issued after the failed request but before receipt freeze no longer qualifies. The cut derives from authored issues, not production pending state. Accepted predicate repair; measured semantic reach is still pending. |
| `R03-EPISODE-MAPPING-001` | Executable prose and coverage map identify an episode as a model-only obligation period after a frozen verdict. A new period may still share an already rejected concrete Promise. The comparison states an obligation-level allowed-error bound, with later periods unavailable to an earlier move. Accepted abstraction clarification; no new concrete-Promise/native-settlement claim. |
| `R03-BATCH-ABSTRACTION-001` | Prose now states the actual allowed set: all captured own receipts completed by the comparison, across provider batches. Batch labels measure the same-batch reach; they do not impose cross-owner priority. The unchanged set is built before matching the observed Error. Accepted clarification; this finding never established a forbidden cross-owner result. |

Event origin/phase preservation is visible in source and attached diagnostics. The unchanged runtime comparison verifies raw reasons, tagged primary/cause identity, multiplicity, and external driver phases; it does not independently calibrate metadata corruption. No metadata-mutant kill is claimed. Restoration-fault injection and arbitrary unknown values beyond this bounded sample are also not established.

## Independent GREEN reconstruction

Parsed the raw log directly, rather than relying on the author's per-case labels. All 14 unique full payload names occur once and map uniquely to their verbose passing result. The summary is 14 passed, 70 skipped, no type errors. The receipt records 2.571 s, exit zero, exception null, empty inherited/effective oracle environment, and no remaining process group.

| Schedule | Payload line | Passing reporter line |
| --- | ---: | ---: |
| late undefined | 7 | 39 |
| late null | 10 | 40 |
| late Error | 13 | 41 |
| late arbitrary value | 16 | 42 |
| two late events share Error identity | 19 | 43 |
| primary and late event share Error identity | 22 | 44 |
| undefined primary and late reason | 25 | 45 |
| cleanup undefined | 28 | 46 |
| cleanup Error | 48 | 65 |
| primary Error before cleanup Error | 51 | 66 |
| null primary before late value | 54 | 67 |
| arbitrary primary before late Error | 57 | 68 |
| cleanup arbitrary value | 60 | 69 |
| primary with shared commit and cleanup reasons | 63 | 70 |

Compared every full payload with the accepted RED raw payload of the same name. All fields, phase sequences, primary flags, reason tags, and expected event counts are identical except the four previously resolved outcomes (`late undefined`, `cleanup undefined`, `cleanup Error`, `cleanup arbitrary value`), which now reject. All 14 now reject and pass the unchanged aggregate/cause/first-member/late identity-and-multiplicity comparison. Thus the previous eight intended failures become GREEN while all six previous controls remain GREEN, without changing the calibration's expected answer.

The payload is emitted after the same positive final-drain, exact delivery, cleanup provenance/cause, and restoration checks. The actual finalizer is still called after the actual finally block. This is actual driver failure-fidelity evidence, not direct-helper-only evidence.

## Exact conditional next step and limits

The prepared semantic gate at `r03-post-account-semantic-gate-v1` preserves the original v1 recipes byte-for-byte for each command's argv and environment. Its input freeze is the repaired v3 freeze above. The original command uses `node --import tsx tests/oracle-replay.ts` with the primary file and the preserved coverage/worker/silent/reporter flags. Its only oracle environment is property `replay.ordered-failed-replay`, seed `-290401844`, path `208:4:3:3:4:3:3`. The second uses the existing `records targeted replay boundary for` selector with an empty oracle environment. The prepared runner rejects inherited oracle settings, records the selected environment, binds source before/after, and refuses the second command without a successful exact one-execution replay guard from the first.

This acceptance supplies root's stated prerequisite for those two commands only. Their outcomes are not part of this review. The seven source corrections are accepted for continued validation, not collectively declared closed. The original R03 remains a model false product RED; there is no production defect, full oracle audit, minified/receiving-path evidence, native Promise-engine settlement proof, or replay-class closure in this calibration result. Wider 120/600 campaigns, exact hostile mutants, pre-verdict retirement, covering replacement, and setup reentry remain pending under the existing owners.
