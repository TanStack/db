# Hosted browser concurrency experiment

The CP-SAT analysis of PR #2446 predicts completion below twenty minutes with two independent browser processes per adapter runner. That prediction needs a contention measurement on the actual four-core GitHub host.

The experiment runs on `codex/ci-browser-concurrency-experiment`. Its workflow uses two runners. One measures serial then parallel execution. The other reverses that order to expose cache and phase-order effects. Each runner uses the repository's Node 22 version and locked dependencies. Source and tests must match `7cd1d0a7128c276cea455d190b894e7942e39fbb`. Both timed modes include the same fixture cleanup repair described below.

The two process queues are the first pair in the CP-SAT assignment:

- The complete fixed-seed native decoding campaign: 166 selected units.
- Complete TrailBase hydration, Query cross-adapter, Direct shared-client and Direct persisted-demand files: 624 units.

The serial phase runs both queues one after another. The parallel phase starts both queues together. Each command still uses one Vitest worker. Campaign budgets, construction bases, models, drivers and comparisons remain unchanged. Peer files retain their fresh random campaign seeds, so their precise histories can differ. Logs preserve those seeds. Counterbalanced results remain a small experiment, not an empirical P95.

The benchmark requires four Linux CPUs, the repository's Node version, and no replay or multiplier overrides. Each command writes an ordinary Vitest JSON report. Exact passed, total, skipped and failed counts must match the selection. Zero work, missing reports and partial selections fail the experiment. Both phases run even if a selected suite fails, and the final result retains that failure.

Linux `/proc` sampling records aggregate resident memory and process counts once per second. It also records Chromium process counts and host CPU use. Known descendants retain their process-start identity after reparenting. A live recorded descendant after the cleanup grace period invalidates the phase. Cleanup targets only matching recorded identities before the next phase starts. Zombies do not count as live resource owners. Short processes between samples can be missed. This does not inspect individual SharedWorkers inside Chromium.

The artifacts contain metadata, exact commands, complete test logs and reports, resource samples, phase results and a summary. Compare each parallel queue with the same serial queue. The largest queue-time ratio supplies a conservative observed contention factor. Also compare total phase time and each individual suite. A faster critical queue does not establish that every peer keeps its serial performance.

The candidate's additional contention allowance is ten percent, on top of a separate twenty-five-percent duration margin. If measured contention is larger, feed the measured factors back into CP-SAT. Do not claim that the full CI target passed from this microbenchmark. A complete hosted run of the resulting schedule must still measure dispatch, setup and aggregate gates.

The experiment workflow is separate from PR #2446. It changes no existing workflow or required check. Hosted results belong in a follow-up section here after collection.

The first VM attempt exposed a selector mismatch: the JSON reporter joins names with spaces, while Vitest 5 filters use ` > `. The exact-count gate invalidated that attempt before it could supply timing evidence. A preflight now executes one complete constructed decoder unit through the real Vitest command. Its five bases and comparison remain intact. The timed phase still runs all 166 selected decoder units.


An initial concurrent trial exposed transient OPFS deletion failures after an awaited database close in the Query select-failure and Direct persisted-demand receivers. Their serial controls passed. The receivers now use the existing bounded post-close cleanup helper: retry only an actual `NoModificationAllowedError`, retain retry diagnostics, and propagate other errors or exhaustion. Source behavior and the shared product-law comparisons are unchanged. Failed phases remain invalid timing evidence.

The missing test boundary was deterministic busy-handle injection for these two receivers. Both new Chromium cleanup checks failed against the original receivers. All nine cleanup checks pass after the repair; the eleven existing browser-fidelity controls also pass, including permanent busy failure and preservation of an earlier product mismatch. Command: `pnpm --filter @tanstack/browser-db-sqlite-persistence exec vitest run --config vitest.adapter-oracles.config.ts tests/opfs-fixture-cleanup.test.ts tests/query-rejected-write-cutoff-browser-fidelity.test.ts --maxWorkers=1`. These are fixture calibrations; they do not expand the product-law claim. The timed selections still contain 790 units per phase.


A follow-up calibration found that recording native cleanup retries in Query's product trace made the unchanged determinism check reject variable teardown timing. Query now retains retry diagnostics in the browser log, as Direct does. The calibration injects a retry in one run, performs a second run without injection, and requires the complete received Query results to agree. It fails on the contaminated recorder and passes after the separation. The experiment preflight now runs all nine receiver cleanup checks, in addition to the complete decoder construction. Failed or interrupted pilot trials remain excluded from speedup evidence.


The next source snapshot binds TrailBase hydration's ten calibrations to their declared fixed or generated histories. One missing-state calibration previously executed 33 receiving histories before finding its premise; the bound form executes one. The framework requires that clean history to pass and its corrupted trace to fail the exact named law. All 90 Chromium units and 180 controlled/Node SQLite units pass. The original fixed/fresh budgets, five construction bases, primary histories, models and comparisons remain unchanged. The [calibration review](oracle-reviews/2026-11-25-trailbase-hydration-calibrations.md) records the checker mutant and limits.

The source guard also checks the actual tracked working tree against the declared baseline. A real temporary-repository calibration first showed that comparing only commit IDs accepted an uncommitted source edit. The repaired guard rejects it and still accepts unrelated private diagnostics. Both timing modes must use the same calibration definitions.


## Hosted baseline result

Run [45655864001](https://github.com/TanStack/db/actions/runs/45655864001), head
`2154f876627c75e56b5f94d2aabb90c0f1528541`, passed all 3,160 selected timed
units on Node 22. Both orders passed every exact-count and process-cleanup gate.
This source precedes the calibration binding refactor above.

| Order | Serial | Parallel | Speedup |
| --- | ---: | ---: | ---: |
| Serial first | 22m48s | 17m09s | 1.330× |
| Parallel first | 22m24s | 16m43s | 1.340× |

The paired job took 31.5–32.0% longer than the longest serial queue. Individual
queue slowdown was 29.7–31.4% for decoding and 72.4–74.6% for its peers. Peak
sampled aggregate RSS was 3.36 GiB; shared pages can be counted more than once.
The ten-percent contention assumption is unsupported by this measurement. The
full schedule needs recalculation and a hosted whole-CI run. These two orders
measure one browser pair and are not P95 evidence.
