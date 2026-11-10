# Persisted eager startup: latency and memory

The first experiment below records the earlier forced-snapshot implementation.
The [post-repair experiment](#post-repair-experiment) measures the final batching
repair separately. Historical and repaired-source samples are not pooled.

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

## Post-repair experiment

This experiment ran after the shared startup, retained-reload and
hydration-lifecycle receiving gates passed on both Node persistence hosts and
actual Chromium OPFS. The [batching record](2026-11-10-persisted-startup-batching.md)
declared its complete matrix before execution. It preserves ordinary first
startup commits and removes initial truncation; nonempty retained reloads keep
atomic replacement. It does not impose a new timing or memory threshold.

The exact repaired sources are PowerSync
`c4960f0c00aae28400de1811285458995c5b61591bd7ce42353f99ad6ab47068`
and RxDB
`c78f7409f9e539a6bf575718f36a91309c191b18638be29a7d87b481914e65f7`.
The working tree's base head is
`0e86c1fdae85520aff142f141f71ccf46a8ee8bd`; these source hashes identify the
uncommitted repair independently of that base head.

The comparator captures immutable adapter source from that base head and
removes only its forced-persistence snapshot operand. Its resulting source
hashes are PowerSync
`d4023262e1073beec841a8ed46aed7b3190141a56fed8ecca4ee632b76f6ca27`
and RxDB
`87e1a38f369b2816218f0cd795cac2bb23854f373c0fa72f07a10d2833daa66b`.
Both variants share current core and dependencies. The final minified bundle
hashes are prior-selection
`d60365cae258e633ea8d3b9ce4f09ce6e0cffd6e57e65b421106758c60690a85`
and repaired
`33b298d1370d0d6e3d80f58a751c216a2f852cbe4fa9b39d865269e5bbcdc0b9`.

This comparison measures repair cost against ordinary prior startup. It is not
a full main-checkout comparison or a direct comparison against the historical
forced-snapshot experiment above. Matching saved/source rows avoid the
comparator's known omitted-row defect. Correctness for changed/omitted rows
belongs to the separate shared oracle evidence.

The declared matrix completed all **64 fresh processes: 48 measured and 16
warmups across eight cells**. It crosses both adapters, 10,000/50,000 matching
saved rows, natural startup and network-first fallback. Every cell has one
warmup and three measured processes per variant, alternating variant order.
Payloads are 256 bytes; source read batches are 1,000. Fallback uses a 25 ms
deadline and 350 ms source hold. Source/import preparation is excluded; the
persisted database and adapter are reopened before timing; OS caches stay warm.
The real PowerSync source uses explicit node:sqlite; the second persisted
SQLite database and real RxDB memory-storage source match the harness described
above. Node v24.19.0, Apple M5 Max, 18 logical CPUs and 64 GiB RAM are unchanged.
Team test/build/mutation workers were paused throughout this timed run.

### Full source result and sampled memory

Times are source result applied in milliseconds, median [minimum–maximum] of
three processes. Heap/RSS are the median absolute sampled startup maxima in
MiB. Sampling and its lower-bound caveat remain as described above.

| Adapter | Rows | Schedule | Prior ms [range] | Repaired ms [range] | Prior/repaired heap MiB | Prior/repaired RSS MiB |
| --- | ---: | --- | --- | --- | --- | --- |
| rxdb | 10,000 | natural | 165.3 [165.3–173.4] | 172.5 [171.5–176.6] | 143.8 / 146.5 | 334.3 / 339.7 |
| rxdb | 10,000 | fallback | 495.6 [494.4–510.6] | 504.8 [497.9–519.3] | 139.9 / 143.0 | 338.5 / 335.3 |
| rxdb | 50,000 | natural | 1114.9 [1048.1–1122.2] | 1092.4 [1045.3–1118.7] | 340.8 / 351.5 | 677.9 / 680.3 |
| rxdb | 50,000 | fallback | 1324.4 [1297.9–1355.2] | 1301.9 [1275.6–1386.4] | 342.6 / 352.9 | 679.6 / 679.4 |
| powersync | 10,000 | natural | 134.9 [133.1–159.1] | 135.5 [135.5–137.7] | 117.2 / 117.6 | 411.4 / 414.7 |
| powersync | 10,000 | fallback | 493.6 [492.3–511.9] | 473.3 [467.1–488.0] | 107.7 / 117.9 | 409.8 / 414.6 |
| powersync | 50,000 | natural | 772.5 [657.9–785.9] | 679.2 [619.2–679.8] | 213.9 / 216.5 | 667.5 / 674.2 |
| powersync | 50,000 | fallback | 1008.0 [958.4–1055.5] | 884.1 [881.0–914.7] | 246.0 / 216.4 | 701.7 / 670.2 |

RxDB's 10,000-row natural median increases 7.2 ms (+4.4%); the sampled ranges
overlap. Its 50,000-row natural sampled heap increases 10.7 MiB (+3.1%), with
2.4 MiB higher sampled RSS. Its 50,000-row timing medians are lower. PowerSync's
10,000-row natural timing is similar; its 50,000-row natural and fallback
medians are lower. These mixed results do not establish a universal
no-regression claim or a noise bound.

PowerSync's 50,000-row natural heap is 2.6 MiB higher in the repaired variant.
Under fallback it is 29.6 MiB lower, where the prior selection already chooses
one snapshot after saved rows become available. This is a paired observation
within this experiment. Differences from the earlier historical experiment
cannot be attributed solely to the repair.

### Network-first readiness and work

Fallback preload fulfills with saved rows before the 350 ms held source in all
measured and warmup processes. The current preload intervals are distinct
from complete source result application:

| Adapter | Rows | Prior preload ms [range] | Repaired preload ms [range] |
| --- | ---: | --- | --- |
| rxdb | 10,000 | 28.9 [27.0–29.2] | 27.5 [27.2–30.0] |
| rxdb | 50,000 | 118.8 [115.9–125.0] | 121.7 [115.7–125.1] |
| powersync | 10,000 | 24.9 [24.8–33.7] | 34.5 [26.6–34.6] |
| powersync | 50,000 | 127.3 [119.0–131.9] | 130.2 [118.4–137.1] |

Every repaired observation has zero initial snapshots and zero durable
truncates. PowerSync preserves 11/51 source commits for 10,000/50,000 rows:
10/50 row-bearing batches plus one empty final batch. Persistence receives 10/50
durable transactions. RxDB preserves one source/durable transaction. Under
fallback the prior PowerSync selection instead uses one snapshot and truncate.

**Both variants still write all N source rows durably**, including matching
saved rows. This repair removes initial truncation and full source-payload
retention across PowerSync batches. It does not implement a skip-equal diff,
O(B) total memory, or fewer durable row writes than ordinary prior startup.
The listed keys and omitted-key array can take O(N) space. All 64 workers check
the final Collection and durable SQLite row counts after the timed interval.

The raw [CSV](../../../scripts/bench/persisted-startup-2026-11-10.csv) appends
these 64 observations with experiment `repaired-final`, retaining warmup flags
and baseline memory. Task-local `repaired-final.json`, `repaired-final.log`,
and `repaired-final-summary.json` retain source/bundle hashes and complete
results. These observations are not pooled with earlier data.

```sh
node scripts/bench/persisted-startup.mjs --rows=10000,50000 --saved=true --schedules=natural,fallback --repetitions=3 --warmup=1 --out=.review-2367/startup-perf/repaired-final.json
```

The earlier environmental and measurement limits still apply: local warm-cache
startup on one desktop, three measured repetitions, no UI-paint, cold-device,
remote-replication or browser-memory claim. The correctness oracle separately
covers actual Chromium OPFS and differing source results.
