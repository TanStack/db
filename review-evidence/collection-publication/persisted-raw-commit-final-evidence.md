# Final stable-source persisted receiver validation

This record supplements the preserved raw-law RED and earlier GREEN records.
ROOT stabilized the core source after repairing the eager no-demand status
failures. This agent made no production, test, model, budget or expectation edit.

SHA-256 of `packages/db/src/collection/subscription.ts` before and after all
runtime/typecheck commands matched:

`31fde05bf653f129cffd5cfe1a2a28db9505921b59674f4ddcf1abc39285c0cb`

Unchanged receiving test:
`07c3d92a221c67f32de3aeb7290e59ad960d1199ef2728c48d782aec060c4c66`.
Unchanged shared model/check:
`7b0e07736adf5f7e8836d5f716ca632f29718b63556131dee7ec3677b84aabf4`.

## Final results

| Command/result | Raw log pair under `review-evidence/collection-publication/` |
| --- | --- |
| Full fixed/random + eight shared examples each: exit 0; two tests passed; 40 histories; 185 ms tests / 2.78 s total; start 11:17:54, 2026-10-30. | `persisted-raw-commit-final-full.{stdout,stderr}.log` |
| Saved seed `30102026`, path `1`: exit 0; one test passed and fixed registration skipped; 16 ms tests / 2.25 s total. | `persisted-raw-commit-final-replay1.{stdout,stderr}.log` |
| Saved seed `30102026`, path `4`: exit 0; one test passed and fixed registration skipped; 20 ms tests / 2.42 s total. | `persisted-raw-commit-final-replay4.{stdout,stderr}.log` |
| Ordinary persistence package `tsc --noEmit --project packages/db-sqlite-persistence-core/tsconfig.json`: exit 0; both logs empty. | `persisted-raw-commit-final-typecheck.{stdout,stderr}.log` |

Runtime commands use the exact installed Node/Vitest executable and W-local
private config recorded in `persisted-raw-commit-evidence.md`, with the same
`collection-public-snapshot-persisted-oracle` filter and
`--disableConsoleIntercept`. Direct replays retain the exact property/seed/path
environment prefixes in `persisted-raw-commit-green-evidence.md`. Only the log
destinations changed to the final names above. Typechecking uses the same
ordinary package command and installed TypeScript executable as the RED report.

## Measured final reaches

| Declared state | Fixed: 20 histories | Unseeded random: 20 histories |
| --- | ---: | ---: |
| Raw truncate applied | 20 | 20 |
| Real wrapped candidate receipt pending | 20 | 20 |
| Real mutex scan held | 20 | 20 |
| Held public observation | 20 | 20 |
| Receipt and mutex progressed | 20 | 20 |
| Quiet failed public observation | 10 | 12 |
| Successful publication observation | 10 | 8 |

Every final history trace records zero failures. Path 1 reaches the first five
states once and successful publication once. Path 4 reaches the first five
states once and quiet failure once. The real receipt/mutex progress and exact
provider-error checks remain unchanged and pass. Raw reads and the full-state
raw subscriber fold agree after each applied authored prefix, including truncate,
candidate application before wrapped receipt completion, and quiet load rejection.

No runtime process remains active for this agent. No source swap, install,
production edit or mutant was performed. The boundary and limits remain those
of the prior reports: the actual persisted wrapper over the existing in-memory
adapter with one retained whole-source subscription and the default coordinator.
ROOT owns broader integration checks and hostile-mutant evidence.

## Final source-event forwarding follow-up: 11:28:04

ROOT's subsequent source-only repair forwards named `sourceApplied` and
`layoutChanged` values through the changes manager, retains empty layout
callbacks, and defaults empty-ready batches to `sourceApplied: false`.
At ROOT's request, this receiver ran one more normal fixed/random campaign.
There was no new driver/model edit, exact replay, typecheck or mutant.

Before/after SHA-256 values matched throughout this run:

- `collection/subscription.ts`:
  `3078838292deff0a5879c7463fdcced5bccd79378a587d246d5df659671430c5`.
- `collection/changes.ts`:
  `f4f76988a427c37e37fcd21ffd5f30176074f92bdf0af31d343d08ba54d245d8`.
- Receiving test and shared model hashes remain the same as above.

The same normal runtime command, config and `--disableConsoleIntercept` flag
used the new output prefix `persisted-raw-commit-source-forwarding-full`.
Result: exit 0, two tests passed, forty histories, 145 ms tests / 1.60 s total.
Both raw stdout/stderr logs are preserved under the evidence directory.

| Declared state | Fixed: 20 histories | Random: 20 histories |
| --- | ---: | ---: |
| Raw truncate applied | 20 | 20 |
| Real wrapped candidate receipt pending | 20 | 20 |
| Real mutex scan held | 20 | 20 |
| Held public observation | 20 | 20 |
| Receipt and mutex progressed | 20 | 20 |
| Quiet failed public observation | 10 | 9 |
| Successful publication observation | 10 | 11 |

All traces contain zero failures. Raw reads and folds agree at every compared
authored application prefix; real receipt/mutex progress and exact rejected-load
error reporting pass unchanged. Runtime is quiescent. Earlier source snapshots,
results and limits remain preserved; this final normal pass supplies the
receiving evidence for the source-event forwarding follow-up.
