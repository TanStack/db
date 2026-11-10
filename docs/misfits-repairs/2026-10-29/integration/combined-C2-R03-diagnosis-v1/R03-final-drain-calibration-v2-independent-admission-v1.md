# R03 final-drain calibration v2: independent admission review

Reviewer: `/root/review_combined_held_cuts`. Review scope: frozen calibration-only v2 seam, finite recipe, static receipts, and runner. This is source/artifact inspection; this reviewer executed no test, compiler, lint, build, generated campaign, or mutant. Python was used only to parse and hash artifacts and compare frozen inputs.

## Verdict

**Suitable for root to admit exactly ONE finite calibration RED command before any repair.** The new comparison judges the result of the actual `checkOrderedReplay` driver after its final drain and restoration. It does not call the finalizer helper directly. Faulty v1 finalization and cleanup propagation remain in place, so the first run can establish the intended harness RED rather than validate a repair made in advance.

This is admission advice, not runtime authorization or a RED/GREEN result. Root retains runtime admission. The planned missing-finalizer-call mutant requires a separate admission after the first result is inspected. The other seven semantic cases, original R03 replay, broader campaigns, model/reach/prose repairs, and production edits are outside this admission.

## Frozen identity

Packet directory:
`docs/misfits-repairs/2026-10-29/prep-pr/replay-batch/evaluation/initial-preload-repair-v1/r03-final-drain-calibration-v2`
in the coordinator worktree `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items`.

Author worktree: `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-replay-latest-main-v3`.

| Artifact | SHA-256 |
| --- | --- |
| `input-freeze.json` | `6b2852d39cc34b31e66e66b3f7dd7b4bf4d19bfec4a7234f0cd02a2bba5744d6` |
| `primary.before.source-snapshot.txt` | `de457a827d34b5fa7cd3be6fab89f212c0c1d82d26641f2c8346d092319c2638` |
| `primary.after.source-snapshot.txt` | `d6a7d4ba896078cb2252be3fa04cb798ffee3f48a932ee267a0487a4a8565cfd` |
| `calibration-only.patch` | `4947026fe77435d2b846376bcf13e4ef5135fc0abebf3de69b834ab09cae51e4` |
| `unchanged-spans.json` | `4741e0abe4e17ad7d5e0a1bb5fd25b4e250f03cc5bccd926a142f6f5164383a8` |
| `runtime-recipes.json` | `4e1e6f96c57cc91b647c2f8d88cdaa1bf4d3c829c7f9a684a99a78a3314b695d` |
| `run-finite-calibration.py` | `a4d0883bc391e68ed7f5f0ca3f59c11eb876c614a98ee20283911cfe6f584bfa` |
| `static-closeout.json` | `57f23ee17094ac463c746702d366c22ffb650c2de0a4e2952f399d4d815c1736` |
| `packet-freeze.json` | `9b51ab719da7b7b1db62ab35eac8208cf6933251ee35ff32e29928c2ef34303b` |

Independent checks found all 17 packet-frozen artifacts and all 1,415 bound source inputs equal their recorded hashes. The before snapshot is the exact v1 primary. Reconstructing the unified before/after patch reproduced the frozen patch. Only the primary oracle differs from v1 among the bound inputs. All 511 production files retain v1 identity `60d0fa772d95a340042bf3776c67da573cd407ded732dcb4d7f776f5da339a42`.

Before/after comparison preserved the faulty finalizer, its sole actual invocation, own account/reach/prose, faulty cleanup mechanics, original swallow propagation, old helper-only calibration, routes, and run budgets. Some earlier independent span extractions excluded one trailing newline; their before/after contents were equal, so this is not a content discrepancy.

The packet binds successful author-side format, TypeScript, and lint receipts (0.579 s, 13.640 s, and 41.598 s), each with exit code zero and unchanged inputs. This reviewer checked the artifacts; these were not independently rerun. There is no runtime calibration result in this reviewed packet.

## Law and independent expected observation

The governing harness law is ORC-010 in `docs/contributing/oracle-rubric.md`: cleanup must retain the original failure and checkpoint, preserve distinguishable secondary diagnostics, and release resources. A tagged primary with reason `undefined` is still present. Two distinct failure events can carry the same reason identity without becoming one event. An `AggregateError` may retain the primary as its own `cause` and first `errors` member, with each late event separately represented afterward.

The new `checkFinalDrainOutcome` derives that judgment from authored event inputs. It requires rejection, inspectable diagnostics, exact primary presence and identity, and secondary identity with multiplicity. It deliberately allows secondary permutation. It neither uses replay error classification to compute expectations nor calls `checkReplayFinalization`. This calibration is about harness failure fidelity, not the product's replay-error eligibility semantics.

The accepted product account remains unchanged: an operation waiting on a failed replay receives that replay's own earliest still-deciding normalized Error. Shared publication does not impose source-global Error precedence. The earlier R03 counterexample remains a false product RED in the model/comparison, not evidence of a production defect.

## Actual path and checkpoint

The frozen primary is `packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts` in the author worktree.

1. Calibration registers genuinely pending receipts through the existing `observeReentryCommit` observer before the protected try. Only retained reject closures can deliver these authored faults.
2. A tagged primary is thrown inside the existing protected try after preload. This preserves a present `undefined` reason and exercises the driver's normal primary capture.
3. The actual finally block records `final-drain-entry`, then delivers the commit rejections. Existing observers append the rejected reasons to `replayReentryFailures`, and the actual drain waits for them.
4. A cleanup fault comes from the actual marker sync adapter. Public `markers.cleanup()` still reaches the unchanged `.catch(swallow)` path. The observation addition to swallow does not change its faulty propagation.
5. The actual `process.off` and both mock restorations run before `restoration-complete`. The unchanged sole `checkReplayFinalization(primaryFailure, replayReentryFailures)` call follows finally.
6. The test catches that actual driver outcome. Positive phase, delivery-count, cleanup-cause, and restoration checks precede the outcome comparison. The `final-drain-calibration` log payload is emitted immediately before `checkFinalDrainOutcome`.

Cleanup normalization is a real receiving boundary: Collection sync wraps an adapter rejection in `SyncCleanupError` with the raw reason as `cause`, and lifecycle cleanup propagates that single failure. Calibration first verifies that causal link. It then judges retention of the actual public normalized reason's identity. It does not assume that public cleanup rejects with the raw adapter reason.

## Exact finite command and interpretation

From the author worktree's `packages/db` directory:

```text
pnpm exec vitest run tests/query/load-subset-replay-refinement-oracle.test.ts --coverage.enabled=false --maxWorkers=1 --silent=false --reporter=verbose -t "calibrates actual final-drain rejection for"
```

The finite recipe selects 14 structural schedules, each with seed `20261029`, `numRuns: 1`, and `endOnFailure: true`; payload generation uses `fc.anything({ maxDepth: 1 })` and `fc.string()`. The outer timeout is 120 seconds. No broad campaign is admitted by this selector.

The new unexecuted `run-finite-calibration.py finite-calibration` runner rejects any inherited `TANSTACK_DB_ORACLE_*` setting before launch, constructs the inherited/effective environment record before launch, checks the frozen HEAD and all bound input hashes, runs only the frozen command, captures raw verbose output, preserves expected nonzero RED, and records post-run source and process-group state. Its final receipt is persisted after the run; an inherited-environment rejection is persisted without launching a process. Root should bind the packet and runner hashes when admitting the command.

The expected decisive outcomes are:

| Schedule | Intended narrow result on unchanged v1 |
| --- | --- |
| `late undefined` | Driver resolves; fails `final drain failures reject the driver`. |
| `cleanup Error` | Actual public cleanup rejects but swallow loses it; driver resolves; same rejection checkpoint fails. |
| `primary Error before cleanup Error` | Only primary escapes; fails late diagnostic inspectability/multiplicity. |
| `primary and late event share Error identity` | Identity filtering loses a distinct late event; fails inspectability/multiplicity. |
| `undefined primary and late reason` | Tagged primary exists but late reason is discarded; fails inspectability/multiplicity. |

`late Error`, `late null`, and `two late events share Error identity` are expected baseline wiring GREEN cases. The additional primary/null/arbitrary-value and cleanup/shared schedules challenge representation and primary/secondary fidelity. Retain every test name and phase payload when classifying the result. Each intended RED must follow the positive phase checks and reach `checkFinalDrainOutcome`; an earlier setup assertion, unexpected wrapper error, timeout, missing test, or nonzero process status alone is not the required RED. A residual process group must be contained and classified before any later run.

## Later mutant and limits

The frozen planned mutant removes the one actual driver finalizer call, then selects only baseline `late Error`. On the original invocation path, the comparison should observe resolution after restoration and fail. Its patch hash is `50f919e0f3fe1d66aa769e53d6acfa3b4947d3d1eba6a6983b77915dcefd3ee4`. This is a suitable later wiring challenge, but it has not been applied, admitted, or executed by this review.

This review establishes static suitability for one first calibration experiment. It does not establish a runtime RED, a repair GREEN, a killed mutant, bug-class closure, a full oracle-rubric audit, real-provider or framework behavior, a minified receiving path, or native Promise-engine settlement. Generated arbitrary payloads are one bounded sample per schedule, not universal unknown-value coverage. The native observation boundary elsewhere remains the actual Deferred call and immediate pending flags.

All seven v1 findings remain open at this calibration-only stage, in their existing order: `R03-FINALIZER-UNKNOWN-001`, `R03-FINALIZER-WIRING-001`, `R03-CLEANUP-RECHECK-001`, `R03-REACH-LOCAL-001`, `R03-REACH-COMPLETED-CUT-001`, `R03-EPISODE-MAPPING-001`, and `R03-BATCH-ABSTRACTION-001`. The last is an abstraction clarification, not a confirmed forbidden cross-owner result. The earlier umbrella `R03-DRIVER-001` remains confirmed-open. None is repaired or retired by this admission review.
