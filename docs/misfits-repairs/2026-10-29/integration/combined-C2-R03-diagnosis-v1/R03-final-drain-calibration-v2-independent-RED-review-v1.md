# R03 final-drain calibration v2: independent RED classification

Reviewer: `/root/review_combined_held_cuts`. Scope: the single admitted finite calibration execution against unchanged v2 source. This reviewer executed no tests, static toolchain, campaign, or mutant; Python was used only to parse frozen artifacts, hash files, and compare input bindings.

**Verdict: ACCEPTED as the intended harness calibration RED.** The raw execution demonstrates eight comparison failures at the intended `checkFinalDrainOutcome` checkpoint, with six GREEN controls. It is not a product RED and does not close a bug class.

Root directly authorized the grouped seven-finding repair and one execution of the same 14-case GREEN calibration plus static checks, conditional on this accepted classification. This review satisfies that condition. Root and author were directly notified before this record was frozen. No additional runtime permission was inferred: the original R03 replay, seven semantic cases, broader campaigns, receiving/minified paths, and mutants remain unadmitted.

## Bound evidence

Runtime directory, relative to the coordinator worktree:
`docs/misfits-repairs/2026-10-29/prep-pr/replay-batch/evaluation/initial-preload-repair-v1/r03-final-drain-calibration-v2/runtime-runs-v1`.

Coordinator worktree: `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items`.

| Artifact | SHA-256 |
| --- | --- |
| `result-freeze.json` | `f5b3e544e433845e190be1246df88e9a61e67ce9d6181152ee167a906cc7a9bb` |
| `C01-actual-final-drain-calibration.log` | `6370a4b143aeb1342b4518451ad693fe5da9f80ce6ae6c365d144a43fd04d149` |
| `C01-actual-final-drain-calibration-receipt.json` | `307301c539bdd0aa4419b8d047a8cdf05d3c500426b1108cf3de30e7e13d6bc2` |
| `per-case-classification.json` | `de21ce69b806bdbb3b5e573e2996508e9487e73d6f450585d38e6128bb1d7af7` |
| `closeout.json` | `38983deea0c89a2de042d44fc8390e536328cdfbbcfc37516d1cda1492d64b9d` |
| `execution-controls.json` | `5f20d34d707a201d73209d50d399c4702833ac10777e3b149a96d2077f69853d` |
| `preflight.json` | `87848ccabc3d226cff2dd07b09cc5c4bff94d9d07a516432254277bd8fb408fe` |

All eight result-frozen artifacts match their hashes. The runtime result binds source packet freeze `9b51ab719da7b7b1db62ab35eac8208cf6933251ee35ff32e29928c2ef34303b`. The reviewed primary source remains `d6a7d4ba896078cb2252be3fa04cb798ffee3f48a932ee267a0487a4a8565cfd`, matching the preceding independent admission record `3701b5d8fd5511d2e5d0012d05e687f0e2cf2e84fd25b90305bd8484cee6f285`.

Independently compared receipt `before`, receipt `after`, and `input-freeze.json`: all 1,415 bindings are identical. All 1,415 actual author-worktree files still matched at review time, before the acceptance notification that released the conditional repair. The unchanged production set is 511 files, with identity `60d0fa772d95a340042bf3776c67da573cd407ded732dcb4d7f776f5da339a42`.

The receipt records exactly the admitted finite command, empty inherited and effective `TANSTACK_DB_ORACLE_*` environments, exit code 1, exception `null`, no remaining process group, and 2.590 seconds. The raw summary is 8 failed, 6 passed, 70 skipped, with no type errors. There is no timeout or outside-comparison failure in this result.

## Independent raw-log classification

The classification below was reconstructed from raw `final-drain-calibration` JSON lines and the adjacent verbose reporter blocks, rather than accepted from the author's per-case labels. Every full payload name occurs exactly once. Truncated reporter names map uniquely to the full JSON name.

| Schedule | Payload line | Reporter line | Result and checkpoint |
| --- | ---: | ---: | --- |
| late undefined | 7 | 42 | RED: resolved result, rejection requirement at `3018:66` |
| late null | 10 | 56 | GREEN control |
| late Error | 13 | 57 | GREEN control |
| late arbitrary value | 16 | 58 | GREEN control |
| two late events share Error identity | 19 | 59 | GREEN control |
| primary and late event share Error identity | 22 | 60 | RED: late diagnostic inspectability at `3025:5` |
| undefined primary and late reason | 25 | 77 | RED: late diagnostic inspectability at `3025:5` |
| cleanup undefined | 28 | 94 | RED: resolved result, rejection requirement at `3018:66` |
| cleanup Error | 31 | 123 | RED: resolved result, rejection requirement at `3018:66` |
| primary Error before cleanup Error | 109 | 137 | RED: late diagnostic inspectability at `3025:5` |
| null primary before late value | 112 | 154 | GREEN control |
| arbitrary primary before late Error | 115 | 155 | GREEN control |
| cleanup arbitrary value | 118 | 156 | RED: resolved result, rejection requirement at `3018:66` |
| primary with shared commit and cleanup reasons | 121 | 170 | RED: late diagnostic inspectability at `3025:5` |

All eight failure reporter blocks state one failed test, seed `20261029`, shrink path `0`, `endOnFailure: true`, and zero shrinks. The bounded generated sample is `[1.7976931348623103e+308, "ar"]`. Four failures are `final drain failures reject the driver: expected 'resolved' to be 'rejected'`, with the stack at `checkFinalDrainOutcome` source line 3018. Four are `late failures remain separately inspectable`, with the stack at source line 3025: three receive only `Error: ar`, and one receives `undefined`. Those exact line meanings were checked against the frozen source snapshot.

The underlying faulty v1 driver therefore demonstrably resolves after a late undefined commit failure or after actual public cleanup rejection, and throws only its primary in the shared-primary or lost-cleanup cases. These are the intended failure-fidelity defects. The result does not misclassify a fixture setup error or a cleanup wrapper's unexpected representation as a successful calibration kill.

## Path and preceding-primary controls

Every payload's phases exactly equal `final-drain-entry`, one `commit-rejection` per authored commit fault, `adapter-cleanup-rejection` followed by `caught-final-drain` when cleanup is authored, then `restoration-complete`. Every payload's event count equals authored commit faults plus the actual public cleanup rejection. All 14 traces end at restoration.

In the frozen source, the payload is emitted only after checking entry into the actual driver finally, absence of early fault delivery, exact commit delivery count, and restoration completion. A cleanup payload also follows the assertions that the actual adapter rejected, public cleanup reached the existing swallow exactly once, and its normalized Error's `cause` retained the authored raw reason. Thus all payloads and actual comparison stacks together establish those premises at this execution's checkpoint. They do not merely show entry into a direct helper test.

The six GREEN controls independently demonstrate that the selected command exercises the comparison without invariably failing. `late Error`, `late null`, and two shared late events preserve ordinary late diagnostics. Null-primary and arbitrary-primary controls reach all primary presence, cause identity, first-member identity, and late multiplicity comparisons. In the failing primary schedules, inspection fails at the earlier aggregate requirement, exactly where the unchanged v1 behavior loses the distinction.

## Consequence and limits

This is the required before-repair RED for the calibrated final-drain defects. It permits the next actions already conditionally authorized by root: grouped seven-finding source repairs, static checks, and ONE run of the same 14 structural calibration cases. It does not establish that the other reach/prose/account findings have runtime witnesses, and it does not retire any finding. The author closeout's `rootFurtherAdmissionRequired: true` records the state before root's subsequent conditional authorization and this accepted classification; its immutable evidence has not been rewritten.

The missing-actual-finalizer-call mutant remains planned and unexecuted. R03 remains a model false product RED. No native Promise-engine settlement, broader replay law, receiving/minified path, or class closure is established. One generated payload per schedule is bounded evidence, not universal unknown-value coverage.
