# Original guarded R03: independent replay-count classification

Reviewer: `/root/review_combined_held_cuts`. This review inspected immutable artifacts and existing source only. No replay, test, generator, static toolchain, or source edit was executed. Python was used only for artifact parsing, hashing, and comparison.

**Classification: successful exact guarded replay, with one guarded property invocation and four successful history evaluations.** The observed `numRuns: 4` is legitimate fast-check 3.23.2 behavior for this multi-segment replay path. It does not mean four guarded invocations, and the result must not be rewritten as one history. It is not a 600-run campaign.

The prepared local semantic wrapper incorrectly expected `witness.numRuns === 1`. That is a local recipe-premise defect (`R03-SEMANTIC-GATE-RUNCOUNT-001`), not a failure of the native guarded replay or the product comparison. The original receipt, wrapper, and actual count remain intact. No original rerun is needed. The second semantic command remains held until root accepts this classification.

## Frozen execution

Packet directory relative to coordinator worktree `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items`:
`docs/misfits-repairs/2026-10-29/prep-pr/replay-batch/evaluation/initial-preload-repair-v1/r03-post-account-semantic-gate-v1`.

| Artifact | SHA-256 |
| --- | --- |
| `runs/result-freeze.json` | `850017610179a007df72fbb1e228a7584b49fd4239fb37f0cc570187f371b366` |
| `runs/R01-original-guarded-R03.log` | `0ba9cc3055b8be1898af3d0460e68c03d1911da16e7f9d0787c7629ba6031b32` |
| `runs/R01-original-guarded-R03-receipt.json` | `e271d3f47c65578cdec60533dd929a3bf848617e6ec428ca853d469ed6d6505b` |
| `runs/original-guard.json` | `4aaf517347a3d41e5809ab8f599b3f64b28d834e5caaa895f61eec5eaf178bc1` |
| `runs/closeout.json` | `234d98514432b02327fcb143c32f0d5ce792f93f63ea3fc37313e17808810df2` |
| `runs/guard-fastcheck-semantics-refs.json` | `3998456e5c6b38172a30fd71cd78aea65bb0b13cb4b7bf944177d2162fad28af` |
| `runs/R03-SEMANTIC-GATE-RUNCOUNT-001.json` | `1cf30649df32fb8bc7140c03dbe4657dabb89013b47d1f3bb42468c6092d90d3` |
| source/command `packet-freeze.json` | `765fee394d5aebffc90643e2930cdaf8f8a66dbc71b0196118d4f1777808c1e5` |

Independently checked every hash in the ten-artifact result freeze and the four-artifact command freeze. The receipt's before and after mappings equal the repaired input freeze (`1a825b0699cf597d0540ff4e5b97dce0a871c89102a16a756924b66061450465`), and all 1,415 current source bindings still match. The primary stays `260adf375d0119d4cb8ad54e26d3d546981fe2a56b1efa3bbe1d6bb197b337fc`; production is unchanged.

The receipt records 2.204 seconds, exit zero, exception null, no remaining process group, and no inherited oracle settings. The exact effective environment is:

```text
TANSTACK_DB_ORACLE_PROPERTY=replay.ordered-failed-replay
TANSTACK_DB_ORACLE_SEED=-290401844
TANSTACK_DB_ORACLE_PATH=208:4:3:3:4:3:3
```

The exact argv, independently equal to the original v1 recipe, is:

```text
node --import tsx tests/oracle-replay.ts tests/query/load-subset-replay-refinement-oracle.test.ts --coverage.enabled=false --maxWorkers=1 --silent=false --reporter=verbose
```

The cwd is the author worktree's `packages/db`. The raw log has one Vitest `RUN`, one passing replay-campaign test, 64 skipped tests, no type errors, and exactly one `Oracle replay:` record at raw line 83. That record has the exact property/seed/path, `witnessMode: "async"`, `executions: 1`, and exactly one matching witness with `numRuns: 4` and `failed: false`. The independently parsed raw record equals the frozen `original-guard.json` payload. The native guard's manifest filter selects the named replay lane. The async witness was present, so the guard's synchronous fallback was not taken.

## Why one invocation can report four successful histories

All repository references below are relative to the frozen author worktree `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-replay-latest-main-v3`. The seven sources and all excerpted lines in the frozen semantics-reference artifact were independently verified against actual files. The installed root `node_modules/fast-check` symlink selects 3.23.2.

1. `packages/db/tests/oracle-config.ts:685–695` supplies `numRuns: 1`, the exact path, and the witness reporter. This is an input option, not necessarily fast-check's returned successful-evaluation count for a shrink path. The primary's `failedReplayCampaigns` selection at `4630–4637` selects only `replay`; its property invokes `fc.assert` once with these options at `4951–4998`.
2. In `node_modules/.pnpm/fast-check@3.23.2/node_modules/fast-check/lib/esm/check/runner/Runner.js:52–58`, a path containing `:` selects `maxInitialIterations = -1`, rather than `qParams.numRuns`. Thus this multi-segment path does not impose a one-element cap on the replay source stream.
3. `.../runner/utils/PathWalker.js:13–21` drops the root index, then follows each shrink segment with `values = shrink(valueToShrink).drop(s)`. It returns the remaining final shrink stream. It does not take only the first value at the final path.
4. `.../runner/SourceValuesIterator.js:10–16` advances that stream until exhaustion when initialized with the negative iteration sentinel. `.../runner/Runner.js:26–38` and `.../runner/RunnerIterator.js:16–25,27–46` execute each remaining value and record its result.
5. `.../runner/reporter/RunExecution.js:43–50` increments `numSuccesses` for successful evaluations. Its successful `toRunDetails` branch at `86–103` returns `numRuns: this.numSuccesses` (line 91). The observed four therefore mean four successful property-input/history evaluations in this one replay stream. They are not four reporter invocations. The selected path is the first value of that stream; its remaining tail can also be evaluated after the selected value passes.
6. `packages/db/tests/oracle-replay-witness.ts:27–39` copies `details.numRuns` into one completed witness. It does not normalize that count to the configured option.
7. `packages/db/tests/oracle-replay.ts:105–109` starts in async witness mode and retries synchronously only when the first attempt failed and recorded no witness. Lines `111–117` require exact property/seed/path and **positive** `numRuns`; they do not require equality to one. Lines `119–127` define `executions` as the number of matching completed witnesses. Lines `137–150` require a nonfailed witness and zero child status for success. The raw execution satisfies this existing native contract.

Relevant whole-file hashes independently checked in addition to the frozen reference excerpts:

| Source | SHA-256 |
| --- | --- |
| native guard `oracle-replay.ts` | `3b8125c4edd01d80f7cf338d6ca693e627fcf915840b7f1798bc3315abe796af` |
| witness `oracle-replay-witness.ts` | `c8f80722bd46b2a1439aa4c7f145b18c7c724a281a776169fdd715a27d8aae70` |
| fast-check `Runner.js` | `0f965b485ecb882952d39e395a345073ee36e83d9ccd7bcd1aee1e75a0a7606d` |
| fast-check `PathWalker.js` | `6b74910ebd4792200ba9dedcca1f98185d3d0e7d92125bfd8189418f7abd81f8` |
| fast-check `RunExecution.js` | `b78d27df2c25ac175a7ee83f6c5e6fe495fd537df55824d811fc9847db2d37da` |

## Consequence and limits

The original guarded result meets the native exact positive-witness contract. The local wrapper's stricter `numRuns === 1` premise would falsely withhold the second command even though R01 passed. A minimal successor wrapper can use the native positive count while still requiring this exact single guard record, one matching nonfailed witness, preserved coordinates, zero exit, frozen source, and clean containment. That change belongs to local execution bookkeeping; it requires no production, oracle, replay-guard, or expected-result edit. The actual count four must stay visible.

Root may accept this classification and release the unchanged finite-seven command without rerunning R01. Until root does, this review does not release that hold. No finite-seven receipt existed at independent verification. No campaign, mutant, receiving/minified witness, or class closure follows. The successful guarded replay supports removal of the former model/comparison false RED under the repaired account; it does not turn that historical mismatch into a production defect or prove every replay history.
