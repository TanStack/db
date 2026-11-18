# Persisted eager startup batching, 2026-11-10

This record extends the shared persisted-startup judgment with deterministic
work observations. It does not establish a latency or heap threshold.

## Law and boundary

The maintainer requested preservation of PowerSync's ordinary first-startup
batch commits and RxDB's existing one full-load source commit. Persistence
must not turn those initial loads into a complete storage replacement.
Retained nonempty reloads keep atomic snapshot replacement. Network-first
fallback is still first startup; readiness alone does not identify a reload.

The existing independent set model continues to judge complete public rows,
durable rows, refresh fulfillment and local-only reopen. Its accepted contract
is unchanged. The additive work comparison permits skipping equal source rows.
Source row writes cannot exceed the source input count. Deletes cannot exceed
saved omissions. PowerSync's individual source and omission commits contain at
most the configured B rows. RxDB has at most one row-bearing source commit.
Neither initial path may select snapshot mode or call truncate.

The observation recorder wraps the adapter's begin/write/truncate/commit API
before persistence wraps it. It supplies no writes or readiness. The first
markReady ends the initial work observation; later refreshes cannot change it.
The work comparison runs only after the existing public/durable/reopen checks.

## Pre-edit receiving evidence

Baseline head: `0e86c1fdae85520aff142f141f71ccf46a8ee8bd`. Both adapter sources
remained unchanged throughout the following runs:

| Source | SHA256 |
| --- | --- |
| PowerSync | `d945eb99bff416fc9c7ba041a802fa842072e5cf03a71d02dd2ed214610df408` |
| RxDB | `2dca19cff8bb602b2aa59f46c7635035e49d0f1cda0a2222e1917f6d2eb8aa62` |

The same shared model and composition run on controlled persistence, real
Node SQLite and actual Chromium worker/OPFS. PowerSync uses its real local
SQLite SDK on each host. RxDB uses its real memory-storage SDK. These are local
storage witnesses; they do not establish remote replication behavior.

```sh
pnpm --config.verifyDepsBeforeRun=false --filter @tanstack/powersync-db-collection exec vitest run tests/persisted-startup-conformance-oracle.property.test.ts --coverage.enabled=false -t 'fixed history'
pnpm --config.verifyDepsBeforeRun=false --filter @tanstack/rxdb-db-collection exec vitest run tests/persisted-startup-conformance-oracle.property.test.ts --coverage.enabled=false -t 'fixed history'
```

PowerSync reports 64 intended work violations per Node host (128 total).
RxDB initially reported 26 per host (52 total). A further receiving pass adds
three-omission histories and reports 32 per host (64 total). Every case reaches the existing final set
comparisons before rejection of forced snapshot replacement. PowerSync also
exceeds B=1 in 14 histories and B=2 in four.

The focused actual Chromium receiver runs the expanded 64/32 histories and
reports the same intended work failures, without page errors or leftover OPFS
artifacts. Its effective Vite configuration has `server.watch === null` and an
empty actual watcher inventory. An earlier HMR-enabled attempt and a stock
Playwright server-probe error are setup diagnostics, not this receiving proof.

The PowerSync receiving grammar then adds a source-ID representation axis.
PowerSync's documented schema/deserialization transforms do not require output
IDs to equal provider IDs. A prefixed provider ID deserializes to the same
Collection key used by the independent set model. The driver records the raw
IDs that actually pass through deserialization. The candidate records that
already-deserialized output key, without parsing twice or changing on-demand
raw-ID operation selection.

Identity histories remain intact. Only nonempty sources get a prefixed
counterpart, because encoding an empty source changes no behavior. That gives
104 effective PowerSync histories; an earlier 128-history diagnostic contained
24 inert encoding duplicates and is not the final count. Both Node hosts
reject all 104 at the intended work comparison (208 total). Static Chromium
rejects PowerSync104 and RxDB32, with no page errors or artifacts. The
source-key-transform premise is reached 40 times. Production hashes above
remain unchanged.

The final pre-edit Chromium reach counts are:

| State | PowerSync | RxDB |
| --- | ---: | ---: |
| response-before-restore | 60 | 18 |
| restore-before-response | 44 | 14 |
| network-first-source-result | 36 | 10 |
| network-first-fallback | 24 | 8 |
| empty-result | 24 | 12 |
| empty-baseline | 16 | 4 |
| overlapping-update | 40 | 10 |
| omitted-row | 88 | 28 |
| persisting-mutation | 52 | 16 |
| source-below-batch | 36 | — |
| source-at-batch | 32 | — |
| source-above-batch | 36 | — |
| omissions-above-batch | 12 | — |
| paged-single-source | — | 4 |
| omissions-above-read-batch | — | 6 |
| source-key-transform | 40 | — |

Every new declared state also has a randomized constructed builder in each
Node campaign. Fixed histories include B=1/B=2 and three saved rows omitted by
an empty source, with both restore orders, fallback and mutation variants.
The no-mutation form makes synchronous omission application possible and tests
a proposed live-iterator alternative. Its executed outcome is recorded below.

Raw pre-edit logs and result data are retained in
`.review-2367/startup-perf/batching-preedit-node-final-red.log`,
`batching-preedit-rxdb-node-final-red.log`,
`batching-preedit-opfs-static-red.log` and
`batching-preedit-opfs-static-result.json`. The expanded RxDB run is
`batching-preedit-rxdb32-node-red.log`,
`batching-preedit-opfs-rxdb32-red.log` and
`batching-preedit-opfs-rxdb32-result.json`. Final representation evidence is
`batching-preedit-powersync104-node-red.log`,
`batching-preedit-opfs-transformed104-red.log` and
`batching-preedit-opfs-transformed104-result.json`.

## Repaired receiving evidence

The final source pair was integrated only after the pre-edit receiving failures,
complete-result/work GREEN, retained reload and hydration-lifecycle gates:

| Source | Final SHA256 |
| --- | --- |
| PowerSync | `c4960f0c00aae28400de1811285458995c5b61591bd7ce42353f99ad6ab47068` |
| RxDB | `c78f7409f9e539a6bf575718f36a91309c191b18638be29a7d87b481914e65f7` |

The complete PowerSync startup suite passes 254 tests; RxDB passes 104. These
include both persistence hosts, every fixed history, the unchanged 80-history
fixed/fresh campaigns, constructed states and calibrations. The static actual
Chromium receiver passes PowerSync104/RxDB32, including all required work and
network-first states. Its page errors and remaining OPFS artifacts are empty.
The unchanged retained-reload judgment passes 44 tests per adapter on Node and
24 histories per adapter in actual Chromium. These checks preserve atomic
nonempty reloads and optimistic-overlay observations.

The [hydration-lifecycle record](2026-11-10-persisted-baseline-lifecycle.md)
records the exact final pair's cleanup/reload/terminal-source-error gates and
post-hydration fence mutants on all three hosts. RxDB uses its existing
Subscription's `closed` value rather than another active flag. A rejected
acknowledgment after real application does not authorize abandoning already
accepted work; the production source does not await full visibility before its
omission comparison.

Raw results are `batching-candidate-{powersync,rxdb}-node-green.log`,
`batching-candidate-opfs-green-result.json`,
`batching-candidate-{powersync,rxdb}-reload-node-green.log`, and
`batching-candidate-reload-opfs-green-result.json` under
`.review-2367/startup-perf/`. The PowerSync startup run used Node24.19.0 and the
real SDK's better-sqlite3 implementation. Later Node controls used Node24.22.1,
one fork worker, and that same real SDK. These are separate from the benchmark's
explicit node:sqlite source configuration.

## Authored controls and limits

Each focused control reuses the owning history, production driver and full
comparison. An immutable overlay supplies the mutated source. A runtime
sentinel verifies its exact SHA256; selected-check counts are enforced. Node
uses controlled persistence and real SQLite; Chromium uses actual worker/OPFS.

| Control | Node checks | Actual Chromium checks | Outcome |
| --- | ---: | ---: | --- |
| Skip PowerSync omission deletion | 2 | 1 | Startup row comparison rejects all |
| Skip RxDB omission deletion | 2 | 1 | Startup row comparison rejects all |
| Track raw PowerSync provider IDs instead of deserialized Collection keys | 4 | 2 | Startup row comparison rejects all |
| Delete omission batches while iterating accepted rows, PowerSync | 2 | 1 | Survives |
| Delete omission batches while iterating accepted rows, RxDB | 2 | 1 | Survives |

The last two controls are surviving alternative algorithms, not evidence of a
rejected defect. Deleting yielded Map keys need not skip subsequent keys, and
persistence can queue application. These receiving histories do not demonstrate
an iterator failure. The repair copies omitted keys before commits to keep its
traversal separate from application; no broader necessity claim follows.
Forced replacement is rejected by all pre-edit work runs and the normal
replacement/truncate calibration. A failure to reach a comparison, missing
source sentinel, or zero-test selection is not counted as rejection.

The omission history has three saved rows, an empty complete result, restore
before response, no optimistic mutation, and PowerSync B=2. The raw-ID history
has an empty baseline, three source rows, response before restore, B=2, and the
prefixed-ID transform, crossing default/network-first initial render.
Browser runs have no page errors or remaining OPFS artifacts. A favicon 404 is
an unrelated resource diagnostic. Node results and source manifests are under
`.review-2367/startup-perf/batching-controls/`; each control has its own logs and
`opfs-result.json`. Earlier zero-selected-test diagnostics are explicitly
unreached and excluded. Post-repair measurements remain separate below.

## Source-weight tradeoff

The candidate reuses PowerSync's existing batch-reading loop. One optional
afterRead hook reconciles omissions before the existing source read lock is
released. One optional initial-row hook records the already-deserialized
Collection key. On-demand operation selection keeps its original raw-ID input
and evaluation order. No second load loop or parallel startup state machine is
introduced. RxDB keeps its existing one full-load source commit.

Both candidates retain source keys and copy only omitted keys before deletion
commits. They avoid retaining every source payload batch for a fresh persisted
startup. They do not promise O(B) total memory: key storage remains O(N), and
existing core/persistence queues can retain source work. Retained nonempty
reloads retain their atomic snapshot path.

Unconditional snapshot selection is smaller in shipped code, but the pre-edit
work comparisons and earlier measurements expose its startup cost. A generic
wrapper omission sweep would need a complete-result boundary and scope
authority from each source; the wrapper cannot infer those from an ordinary
commit. A skip-equal diff is a further possible optimization, not part of this
repair. Final source size is measured separately; this record makes no
net-negative code-weight claim.

The final real-path source lint, strict types, formatting and size builds pass.
Against `858c8f0bf`, package gzip/brotli deltas are PowerSync +269/+276 bytes,
RxDB +245/+237, Query +53/+31, TrailBase +71/+69, and core DB zero. The total
is +638/+613 bytes. The representative application changes +58 gzip / -40
brotli bytes. These are build measurements, not an additive application-cost
prediction. Source hashes above are unchanged after these checks.

## Post-repair measurement plan, declared before execution

After the receiving gates and source integration, run 10,000 and 50,000
matching saved/source rows for both adapters. Cross natural startup and
network-first fallback (25 ms deadline, 350 ms source hold). Keep 256-byte row
payloads and a source read batch of 1,000. Each cell has one discarded warmup
per variant and three measured fresh processes per variant, with alternating
variant order: 64 total observations, 48 measured and 16 warmups.

The prior-selection comparator uses SHA-guarded adapter source from
`0e86c1fdae85520aff142f141f71ccf46a8ee8bd`, with only its forced-snapshot operand
removed. The repaired variant captures current adapter source before bundling.
Both variants use the same current core and installed dependencies. This
compares repair cost against prior ordinary startup, not against a full main
checkout. Matching input avoids the comparator's known omitted-row defect.
The JSON records each source input and output bundle SHA256.

```sh
node scripts/bench/persisted-startup.mjs --rows=10000,50000 --saved=true --schedules=natural,fallback --repetitions=3 --warmup=1 --out=.review-2367/startup-perf/repaired-final.json
```

Retain source-applied and preload readiness intervals, sampled heap/RSS maxima,
baseline memory and transaction/write/truncate counts. Pause test/build/mutation
workers during these paired measurements. Report all declared cells and their
spread; do not turn a sampled peak into an allocation claim or create a new
numeric product threshold. Preserve the earlier forced-snapshot measurements
as historical evidence rather than pooling them with repaired-source samples.

## Post-repair measurements completed

The full declared 64-process matrix completed without failures, with final
source hashes unchanged. The [separate measurement record](2026-11-10-persisted-startup-measurements.md#post-repair-experiment)
reports all eight cells, spreads, sampled heap/RSS and work counts. Every
repaired run has zero initial snapshots/truncates. PowerSync retains 11/51
source commits at 10,000/50,000 rows; RxDB retains one. Both still send N durable
row writes. Early fallback readiness remains before the 350 ms held source.

The results are mixed rather than a universal performance-preserved result.
RxDB's 10,000-row natural median rises 7.2 ms and its 50,000-row natural sampled
heap rises 10.7 MiB. PowerSync's 50,000-row medians are lower; its natural sampled
heap rises 2.6 MiB. No threshold or O(B) total-memory claim follows. Raw data is
appended under experiment `repaired-final` in the checked-in CSV, separately
from historical forced-snapshot measurements.
