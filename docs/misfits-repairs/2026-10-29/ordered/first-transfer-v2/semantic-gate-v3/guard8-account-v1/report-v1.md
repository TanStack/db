# Guard8 accounting evidence, C1 Alternative A

The exact joined acknowledgement still stops at attempted request9 under unchanged guard8. The recorder now distinguishes issue time, authored backend revision, applied publication epoch, provider read, receipt, completion and cleanup. This is diagnostic evidence for an open proposed account; it is not a product repair or acceptance of28.

## Source and verification

Source epoch A2 was frozen before controls/replay in `source-epoch-A2-final.json`. Only ordered-work's opt-in recorder and two new test accounting files are in `additive-A2.patch`. Existing production dirty changes predate this continuation. Both production hashes, all132 v4 artifacts, the original reference model, complete old checker/grammar/campaign tail, all old budgets, config, manifest and coverage are unchanged.

Formatting, DB typecheck and lint passed (A07–A09). Checker calibration passed (A12). The eight controls require their intended rejection, with reach counts: repeated certificate4; reversed direction4; tied key progress4; rewritten issue epoch4; omitted initial4; omitted obsolete2; omitted restoration4; omitted following move4. Console output requires `--disableConsoleIntercept`; A10/A11 are preserved earlier green runs without visible console reach.

## Exact bounded replay

From source `packages/db`:

```sh
TANSTACK_DB_ORDERED_CONTAINMENT_RECORD=1 \
TANSTACK_DB_ORACLE_PROPERTY=ordered-work.held-target-overlay-cycle \
TANSTACK_DB_ORACLE_SEED=20261107 \
TANSTACK_DB_ORACLE_PATH=0:1 \
TANSTACK_DB_ORACLE_REPLAY_WITNESS=<absolute G>/A13-replay-witness.jsonl \
pnpm exec vitest run --coverage.enabled=false --typecheck.enabled=false \
 --maxWorkers=1 --disableConsoleIntercept \
 tests/query/ordered-work-oracle.property.test.ts \
 -t 'completes a held target after its overlay ends \(random campaign\)'
```

Exit1, one failed and310 skipped. Seed20261107/path0:1 retains the joined counterexample and Shrunk0. `A13-guarded-replay.log` and its one-line witness are raw evidence. Two emitted executions are preserved verbatim in separate raw JSON files and summarized in `A13-separated-executions-v1.json`.

### Execution1: intended joined acknowledgement

| Call | Issue epoch/revision | Read epoch/revision | Proposed role | Answer IDs |
| --- | --- | --- | --- | --- |
| 1 | 0/0 | 0/0 | prefix | 4 |
| 2 | 0/0 | 0/0 | certificate | 4 |
| 3 | 0/0 | 0/0 | forward | 3 |
| 4 | 0/0 | 0/0 | certificate | 3 |
| 5 | 0/0 | 1/1 | forward | 2,1 |
| 6 | 1/1 | 1/1 | certificate | 1,2 |
| 7 | 1/1 | 1/1 | forward | 0 |
| 8 | 1/1 | 1/1 | certificate | 0 |
| 9 | 1/1 | none | forward attempt | none: guard rejected |

Call5 keeps its cost in issue epoch0 despite reading backend revision1 after the authored root update is applied as epoch1. At event27 the backend revision changes; event28 separately observes the authored base change applied. Call9 requests after rank0, offset5, limit1. It never reads, submits, settles a receipt or runs its provider. All nine acquisition signals are observed aborting during cleanup; this does not invent a provider execution or adapter unload callback.

No target completion, marker restoration, following-window completion or completed public comparison occurs in execution1. The account reports no recording or proposed-hypothesis violation in this bounded prefix, but leaves call5's cross-epoch charge proof and call9's absent executed progress open; complete=false. Absence of a prefix violation does not prove the multiplicities or28.

### Execution2: separate source-shaped execution

This execution has six calls; held call3 issues0/0 and reads1/1. Target rows[2,1,0] and following-window rows[1] are observed before driver return. They belong to this separate execution only. It is not the retained joined counterexample and cannot close that trace. The log does not identify the purpose of this additional FastCheck execution; Shrunk0 records no accepted shrink.

The recorder prints before the external public comparison, and both records keep completedComparisons empty. The second account remains incomplete because its crossing call requires a charge proof. Aggregate reach counters, including next-window completion, must not be attributed to execution1.

## Error and limits

The visible primary boundary is guard rejection9; the source guard throws `optimistic ordered loading did not stop`. The outer error is `AggregateError: History and cleanup failed`, which proves a primary error and at least one cleanup error under `withHistoryCleanup`. Vitest text does not serialize the nested entries. Source cleanup includes target settlement and requests<=8. Their exact emitted error list is not established by this log, and no extra diagnostic run was used to infer it.

C1 remains confirmed-open. No suffix diagnostic, larger cap, production change, commit, push or PR occurred. The finite recorder/checker does not establish an injective charge proof for crossing revisions, a completed acknowledged domain, the original product N+2P law, the existing initial6>5 failure, or a policy for held-target publication priority. R1's model extraction and receiving construction remain unimplemented pending review and root authorization.
