# Hosted browser concurrency experiment

The CP-SAT analysis of PR #2446 predicts completion below twenty minutes with two independent browser processes per adapter runner. That prediction needs a contention measurement on the actual four-core GitHub host.

The experiment runs on `codex/ci-browser-concurrency-experiment`. Its workflow uses two runners. One measures serial then parallel execution. The other reverses that order to expose cache and phase-order effects. Each runner uses the repository's Node 22 version and locked dependencies. Source and tests must match `8be91cd7647647438552edacb694f4a171692632`.

The two process queues are the first pair in the CP-SAT assignment:

- The complete fixed-seed native decoding campaign: 166 selected units.
- Complete TrailBase hydration, Query cross-adapter, Direct shared-client and Direct persisted-demand files: 624 units.

The serial phase runs both queues one after another. The parallel phase starts both queues together. Each command still uses one Vitest worker. Campaign budgets, construction bases, models, drivers and comparisons remain unchanged. Peer files retain their fresh random campaign seeds, so their precise histories can differ. Logs preserve those seeds. Counterbalanced results remain a small experiment, not an empirical P95.

The benchmark requires four Linux CPUs, the repository's Node version, and no replay or multiplier overrides. Each command writes an ordinary Vitest JSON report. Exact passed, total, skipped and failed counts must match the selection. Zero work, missing reports and partial selections fail the experiment. Both phases run even if a selected suite fails, and the final result retains that failure.

Linux `/proc` sampling records aggregate resident memory and process counts once per second. It also records Chromium process counts and host CPU use. Known descendants retain their process-start identity after reparenting. A live recorded descendant after the cleanup grace period invalidates the phase. Cleanup targets only matching recorded identities before the next phase starts. Zombies do not count as live resource owners. Short processes between samples can be missed. This does not inspect individual SharedWorkers inside Chromium.

The artifacts contain metadata, exact commands, complete test logs and reports, resource samples, phase results and a summary. Compare each parallel queue with the same serial queue. The largest queue-time ratio supplies a conservative observed contention factor. Also compare total phase time and each individual suite. A faster critical queue does not establish that every peer keeps its serial performance.

The candidate's additional contention allowance is ten percent, on top of a separate twenty-five-percent duration margin. If measured contention is larger, feed the measured factors back into CP-SAT. Do not claim that the full CI target passed from this microbenchmark. A complete hosted run of the resulting schedule must still measure dispatch, setup and aggregate gates.

The experiment workflow is separate from PR #2446. It changes no existing workflow or required check. Hosted results belong in a follow-up section here after collection.
