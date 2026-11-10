# Persisted eager startup: latency and memory

Measured source: `5feb26616a8357853454c2f9ff2ce0b0adb9c908`.
The measurement task is separate from the correctness oracle campaign. It
does not establish a new startup-time or memory contract.

## Experiment

The two source variants differ only in eager snapshot selection for RxDB and
PowerSync. The current variant uses the reviewed source. The prior-selection
variant removes the `persistence !== null ||` operand from each adapter's
selection, matching `origin/main`'s decision. Capability validation, core,
persistence, SDKs, dependencies, and the harness stay identical. This is a
controlled comparison of the PR's snapshot change, not a full main checkout.

The runner bundles current TypeScript sources in production mode and minifies
them. It does not use the test runner, oracle histories, or fixture drivers.
It does not reproduce the Vite package build's private-property mangling.
Each observation starts a fresh Node process. Each source uses its actual SDK:
RxDB memory storage or PowerSync Node SQLite. The wrapped Collection persists
to a second, real file-backed Node SQLite database, using WAL and NORMAL
synchronous mode through the existing SQLite persistence adapter.

Each worker prepares the provider's rows and saved SQLite rows before timing.
It closes and reopens the persisted database and creates a fresh persistence
adapter, so no seeding adapter schema/snapshot cache carries into startup.
The saved baseline is empty or exactly matches the provider. These inputs
avoid the known stale-row defect in the old selection and isolate work costs.
The OS file cache remains warm. Source SDK setup and process import time are
excluded from the elapsed startup interval.

Rows contain a string ID, number, and a 256-byte string payload. Source reads
use a batch size of 1,000. The campaigns cross 1,000 and 10,000 source rows,
empty and matching saved baselines, and a 50,000-row matching-baseline case.
Additional 10,000-row matching-baseline cases hold restore for 300 ms, or use
network-first initial render with a 25 ms deadline while holding the source
for 350 ms. Those are controlled delays, not measured network latency.

Each cell has one discarded process warmup per variant and three measured
processes per variant. The order alternates prior/current then current/prior.
Garbage collection runs once after fixtures are prepared and before timing;
normal GC remains enabled during startup. Team test/build/mutation workers
pause for the final paired runs. No CPU affinity or OS cache flush is used.

The runner records these distinct observations:

- SQLite's full-row restore-read completion.
- The existing `hydrateBaseline()` capability's settlement. Its work may
  include queued source persistence, so it is not a first-paint measurement.
- Public `preload()` fulfillment and first source commit invocation.
- Full initial source result after all its applied receipts settle.
- Source and durable transaction/write/truncate counts.
- Heap, RSS, and external memory sampled at 2 ms intervals, source batches,
  every 512 source writes, commits, and the completion boundaries.
- Process RSS high-water mark before and after the timed startup. This
  lifetime measure also includes fixture preparation and module loading.

Sampled memory maxima are lower bounds on the true instantaneous startup
peaks. The report retains baseline memory and absolute sampled maxima. It does
not subtract process RSS readings and label the difference an allocation count.
Both SDK modules are loaded by the common harness, so absolute process memory
also includes its common module overhead. Final row counts are checked in the
Collection and SQLite after the timed observation.

## Results

### Natural startup

Times are full initial source result applied, in milliseconds. Each entry is
the median and [minimum–maximum] of three processes. Memory is the median of
the three absolute sampled startup maxima, in MiB. It includes retained source
SDK state and common harness modules.

| Adapter | Rows | Saved baseline | Prior ms [range] | Current ms [range] | Prior/current heap MiB | Prior/current RSS MiB |
| --- | ---: | --- | --- | --- | --- | --- |
| rxdb | 1,000 | empty | 37.6 [35.7–41.9] | 30.3 [29.5–35.6] | 50.3 / 47.7 | 161.2 / 159.3 |
| rxdb | 1,000 | matching | 41.4 [39.9–42.7] | 44.6 [42.1–60.8] | 57.1 / 53.3 | 172.7 / 170.2 |
| rxdb | 10,000 | empty | 318.8 [317.8–323.4] | 284.6 [264.3–292.3] | 101.5 / 126.8 | 286.4 / 278.4 |
| rxdb | 10,000 | matching | 423.2 [420.9–491.4] | 428.3 [410.9–453.1] | 144.9 / 127.2 | 335.6 / 343.0 |
| powersync | 1,000 | empty | 40.3 [36.2–48.2] | 28.9 [27.5–33.5] | 47.1 / 44.5 | 268.9 / 265.2 |
| powersync | 1,000 | matching | 38.5 [37.2–45.5] | 38.6 [36.9–41.0] | 53.8 / 50.1 | 273.0 / 270.4 |
| powersync | 10,000 | empty | 182.5 [164.1–184.6] | 198.4 [180.2–198.9] | 72.3 / 89.0 | 321.7 / 347.3 |
| powersync | 10,000 | matching | 274.7 [269.6–283.0] | 320.1 [319.3–327.0] | 118.0 / 109.5 | 413.8 / 407.3 |
| rxdb | 50,000 | matching | 1757.8 [1667.8–1784.5] | 1714.3 [1606.0–1769.7] | 330.9 / 375.1 | 682.1 / 713.0 |
| powersync | 50,000 | matching | 1122.3 [853.0–1174.7] | 1148.1 [1001.3–1362.0] | 214.1 / 285.7 | 672.7 / 716.2 |

### Controlled ordering and network-first fallback

All cases have 10,000 matching saved rows. Values are medians in milliseconds.
The source-first case adds a 300 ms restore-read delay to both variants.
The fallback case holds the source for 350 ms and uses a 25 ms network deadline.

| Adapter | Schedule | Prior/current preload ready ms | Prior/current source applied ms | Prior/current snapshots |
| --- | --- | --- | --- | --- |
| rxdb | source-first | 592.5 / 597.8 | 592.4 / 597.5 | 0 / 1 |
| rxdb | fallback | 55.9 / 56.2 | 626.2 / 615.1 | 0 / 1 |
| powersync | source-first | 529.7 / 543.7 | 529.5 / 543.6 | 0 / 1 |
| powersync | fallback | 43.3 / 46.4 | 542.1 / 541.4 | 1 / 1 |

The final three campaigns contain **112 process observations: 84 measured and
28 warmups across 14 cells**. The accompanying [raw CSV](../../../scripts/bench/persisted-startup-2026-11-10.csv)
also retains 64 observations from the initial warm-adapter diagnostic. Warmups
and diagnostic observations do not enter the final medians above. Every worker
checks its final Collection and SQLite row counts.

### Inference

The snapshot change has measurable costs, with different effects by workload.
At 10,000 matching saved rows, PowerSync source-applied latency rises from
274.7 ms to 320.1 ms (+16.5%, +45.4 ms). All three current samples
(319.3–327.0 ms) exceed all three prior samples (269.6–283.0 ms). The initial
warm-adapter diagnostic also shows a slower median for this cell (364.0 ms to
448.1 ms), but it is a different experiment and is not pooled with the reopen
measurements. The 50,000-row PowerSync timing ranges overlap broadly.

At 50,000 matching saved rows, sampled heap maxima increase from 330.9 to
375.1 MiB for RxDB (+44.2 MiB, +13.4%), and from 214.1 to 285.7 MiB for
PowerSync (+71.7 MiB, +33.5%). Sampled RSS maxima increase by 30.9 and
43.6 MiB, respectively. Those are sampled maxima, not exact allocation counts
or a promise about every device. Smaller cells have mixed memory changes.

The network-first measurements preserve early persisted readiness for the
measured scenario: current medians are 56.2 ms for RxDB and 46.4 ms for
PowerSync, while their source is held for 350 ms. PowerSync selects snapshots
in both variants in that case, giving a same-selection control. These numbers
do not establish a browser first-paint result.

Both variants send N source rows to durable storage. When prior selection is
not already a snapshot, current startup adds a truncate, and PowerSync changes
from batch commits to one snapshot commit.
At 50,000 rows, PowerSync prior selection invokes 51 source commits (50 with
rows plus an empty final batch); current invokes one snapshot. RxDB uses one
full-load commit in both variants. The wrapper's row-read budget remains a
separate correctness/work-oracle obligation; this benchmark does not count it.

The results do not support a blanket performance-preserved claim. A repair
should preserve authoritative replacement and atomic snapshot publication.
Changing user-visible publication to progressive batches would require a
separate contract decision. A possible narrower experiment is to preserve
the snapshot while reducing redundant durable row writes against the existing
hydrated baseline; that is not implemented or measured here.

### Environment and validation

Apple M5 Max, 18 logical CPUs, 64 GiB RAM, macOS arm64, Node v24.19.0.
RxDB 17.6.0, PowerSync Node 0.21.0, and PowerSync common 2.5.0 supply the
local source SDKs. Both variants use the same installed dependency tree.
The source and persistence databases live under the local temporary directory.
No test/build/mutation workers run during the final timed pairs.

The source-control matcher, minified bundle build, all workers, final row-count
checks, and the normal ESLint pass validate the executable harness. The worker
also passes TypeScript with the repository's strict compiler settings and
package-scoped SDK resolution. The benchmark does not enforce a new numeric
performance threshold.

## Reproduction

From the worktree root:

```sh
node scripts/bench/persisted-startup.mjs --rows=1000,10000 --adapters=rxdb,powersync --schedules=natural --repetitions=3 --warmup=1 --out=.review-2367/startup-perf/final-natural.json
node scripts/bench/persisted-startup.mjs --rows=10000 --saved=true --adapters=rxdb,powersync --schedules=source-first,fallback --repetitions=3 --warmup=1 --out=.review-2367/startup-perf/final-controls.json
node scripts/bench/persisted-startup.mjs --rows=50000 --saved=true --adapters=rxdb,powersync --schedules=natural --repetitions=3 --warmup=1 --out=.review-2367/startup-perf/final-large.json
```

The baseline transform fails if it cannot match both snapshot selections.
Changes to those expressions require updating that explicit source control.
Raw JSON and logs remain in the task-local directory. The accompanying CSV
retains measured observations, warmups, and the earlier warm-adapter diagnostic
run, with their experiment labels.

The initial diagnostic reused its seeding adapter and connection. It measured
warm Collection startup rather than an app reopen. It is retained separately
and does not supply the final app-reopen comparison. Smoke and one-repetition
pilots also remain local; they are harness development, not independent samples.

## Limits

This measures a Collection's local eager startup on one desktop with warm OS
file caches. It does not measure process boot, UI paint, browser OPFS, cold
device storage, remote replication, competing tab writers, failure recovery,
or arbitrary row shapes. Three measured repetitions reveal spread, but do not
estimate tail percentiles or prove a universal noise bound. The controlled
selection baseline can retain omitted saved rows; it is a cost comparator,
not a proposed correctness repair.

Both variants use the same local dependency installation. The task's temporary
HTTP-403 recovery overrides remain uncommitted: query-core 5.107.1 → 5.106.0,
fake-indexeddb 6.2.8 → 6.2.7, and tailwindcss/postcss 4.3.5 → 4.3.4. Those
packages do not define the compared SDK or SQLite implementation. The exact
unrecovered lockfile still lacks a local measurement.
