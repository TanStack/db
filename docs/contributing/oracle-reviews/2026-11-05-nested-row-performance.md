# Nested-row performance repair

Evaluated on 2026-11-05 at `8feab6ea3eaae4456f738da39fa93508ddd5cc01`,
plus this working diff. Sources: [issue 2355](https://github.com/TanStack/db/issues/2355),
the benchmark patch in its body, [PR 2312](https://github.com/TanStack/db/pull/2312),
and the [proposed scan](https://github.com/nathan-muir/tanstack-db/pull/1).
This evaluates and repairs the performance report. It does not establish that
every law or implementation choice in PR 2312 is ready for approval.

## Law and experiment

The maintainer requested restored performance without discarding the callback
metadata boundaries. The accepted value laws remain those in
`packages/db/src/query/live/ARCHITECTURE.md`: callbacks see no compiler state;
projected source views hide reserved row fields; authored inline values retain
their shape; boundary copies preserve descriptors, clean references, symbols
and opaque leaves, without invoking getters during discovery.

The new deterministic work instrument belongs to
`includes-work-counter-oracle.test.ts`. Its independent truth is the authored
document at each tick, with no compiler classification in the expected value.
It requires complete public values, document identity, and zero metadata
descriptor scans of ordinary source payload containers. The grammar varies
0–40 blocks through source, join, QueryRef, union, implicit selection, functional
selection, and functional where/having paths. It observes preload and two
synced replacements. Each input must reach all seven paths; the fixed and
random campaigns each run four examples plus eight generated inputs: 168 path
histories and 504 public checkpoints in total. The examples pin 0, 1, 20 and 40
blocks and use the same driver and comparison as generated inputs.

This is a resource budget for the reported allocation defect, not a universal
latency bound or a complete counter for every way to traverse an object.
Correlated sanitation and nonempty callback-view substitution retain recursive
walks. Their semantics remain under the route-context and virtual-row-input
owners; their work is outside this payload grammar. Hashing, proxy traps,
arbitrary callbacks, provider delivery and framework scheduling are not measured.
The separate elapsed-time benchmark is necessary to detect other expensive
implementations, including a descriptor-free preliminary scan.

Before production edits, the extended property failed at preload with **6 source
payload descriptor scans, expected 0**, shrinking to an empty document
(fixed seed 2355, path `0`; random seed 198567259, path `0:0`). The neighboring
four-file baseline passed 5,258 checks. Thus correct values and the existing
metadata laws had allowed this work regression: the old work owner counted
source rows, not nested payload discovery, and the timing benchmark selected
flat scalar fields under a limit.

The repair uses compilation provenance to choose recursive or root-only
sanitation. Clean roots need no descriptor copy. Roots with occurrence metadata
still get sanitized; recursive paths keep the original descriptor-preserving
walker. Callback substitution does no work when its override list is empty.
Both strip functions share the scope check; no new per-row cache or state is
introduced. An initial shallow-only repair still cost about twice the old cold
time, which motivated removing its clean-root allocation as well.

## Enforcement evidence

From `packages/db`, run:

```sh
pnpm exec vitest run --coverage.enabled=false \
  tests/query/includes-work-counter-oracle.test.ts -t 'nested source payloads'
```

The fixed and random campaigns pass. A direct replay with
`TANSTACK_DB_ORACLE_SEED=2355`, `TANSTACK_DB_ORACLE_PATH=0`, and
`TANSTACK_DB_ORACLE_PROPERTY=includes-work.projection-payload` runs one history
and passes. Replacing only the two changed compiler modules with their HEAD
versions makes that same replay fail with the six-scan assertion; restoring the
repair makes it pass again.

The final neighboring run passes **7,463 checks in seven files**:
`includes-context-transport-oracle`, `virtual-row-fields-input-oracle`,
`includes-functional-projection-oracle`, `public-container-copy`,
`includes-work-counter-oracle`, `virtual-row-fields-oracle`, and
`ordered-work-oracle.property`. These preserve the existing metadata, route,
descriptor, reference-identity and ordered-work comparisons. No budget was
lowered and no semantic comparison was relaxed.

Two added ordinary copy controls reject the proposed scan: a clean enumerable
getter is invoked once, and private state below an enumerable named array
property survives. Both pass with the retained walker. These supplement the
existing descriptor matrix; they do not replace the generated work owner.

## Timing and CI policy

The [36-row measurement table](../../../scripts/bench/nested-row-repair-2026-11-05.csv)
retains all three cold observations and write medians for each nested case and
source variant. All three variants ran the same updated harness, sequentially
without concurrent tests, on an Apple M5 Max with Node 24.19.0, 100 measured
writes and 20 warmups. The archived DB sources are pre-2312 `035a5260` and
current main `8feab6ea3`; all variants use the same current built db-ivm and
installed dependencies. This isolates the DB source change, rather than
reconstructing an entire historical release. Archived runs' raw git metadata
names the containing checkout; the table records the actual source variant.

| 10,000 issues, no manual index | Pre-2312 | Main | Repaired |
| --- | ---: | ---: | ---: |
| Synced cold hydrate | 67.630 ms | 2,097.377 ms | 74.896 ms |
| Synced median write | 0.023375 ms | 0.565792 ms | 0.023083 ms |
| Optimistic cold hydrate | 66.202 ms | 2,090.143 ms | 74.574 ms |
| Optimistic median write | 0.160459 ms | 0.717125 ms | 0.153791 ms |

Across all 12 nested configurations, repaired/main geometric-mean ratios are
0.0397 cold and 0.0951 writes (about 25× and 10.5× faster). Repaired/pre-2312
ratios are 1.228 cold and 1.002 writes. Individual cold ratios against the old
source range from 0.771 to 3.002, so this evidence establishes substantial
restoration, not identical cold timing in every small configuration. The
10,000-row cold case remains about 11–13% above the old source.

The benchmark now checks nested result cardinality and the visible document
after preload, writes and rollback, outside the measured intervals. It runs
the nested case without a limit at every scale, index and mutation mode.

[CI measurements and policy](../../../scripts/bench/README.md) record ten
runtime-identical paired jobs. Same-job query rollups vary by up to +10.0% for
writes and +20.3% cold; isolated cold cases exceed 7×. Every historical pair
passes the actual new comparator. Cross-job identical-base timings differ by
up to 2.76× writes and 1.88× cold overall, so the gate compares within one job.

CI takes three fresh-fixture repetitions on each side and fails a query
geometric mean above +30% writes or +50% cold. It also fails a persistent
single-configuration increase: the fastest candidate exceeds the slowest base
by more than 50% and 0.05 ms writes or 5 ms cold. Other queries cannot cancel
a regression. Missing cases, invalid timings and missing declared repetitions
fail. Artifacts and the summary survive a failed comparison. The 19 CLI
controls pass, and presenting measured main as a regression from the repair
exits 1. Actual CI history with the new repetitions remains unobserved; the
historical reports cannot calibrate the repeated-range policy's false positives.

The minified production comparison adds 58 gzip bytes to DB and 51 gzip bytes
to the typical app. Sharing strip logic removed duplication; dropping root
sanitation would violate occurrence isolation, while retaining the shallow
descriptor allocation left measured cold time around 2× the old source. The
small scope check pays for that allocation removal. Tests and evidence grow
separately from shipped code.

## Loss audit and reviewer assessment

The raw issue and full proposed diff were revisited after the final repair.
The task-local append-only ledger preserves the original claims and proposed
fixes. These are their final independent judgments:

| ID | Technical validity | Action | Durable value and destination |
| --- | --- | --- | --- |
| R1: large regression since 2312 | Confirmed independently; exact external timing ratios are machine-specific. | fixed-now | Generated payload work owner and three-source timing table. |
| R2: up to three recursive walks per output | Confirmed by source and six-scan RED even for zero blocks. | fixed-now | Scope-based sanitation, original-implementation mutant. |
| R3: flat benchmark misses nested whole documents | Confirmed. The supplied fixture/query/update patch is useful. | fixed-now | Nested case, visible-write/rollback validation, repetitions. |
| R4: nested regressions are consistent, other cases noisy | Independently confirmed; external 163→5,535 ms figures are retained as reported evidence, not repeated claims about this machine. | fixed-now | Nested CSV plus historical CI variation CSV and calibrated gate. |
| R5: preliminary scan helps partially; avoid payload traversal for restoration | Direction confirmed. Scan remains proportional to payload and fails descriptor guarantees, so its proposed implementation is unsuitable. | fixed-now with a different repair | Clean-root scope check, empty-override skip, descriptor controls and explicit work limits. |

Raw accounting: **5 items = 5 fixed-now**. Two separately discovered proposal
defects (getter evaluation and named-array-property omission) are addressed by
rejecting the scan and retaining executable controls. No raw item was dropped,
deferred, or treated as authority to narrow the metadata laws. Remaining evidence
limits are named above; whole-PR readiness is not established by this audit.

Reviewer assessment: **hire recommendation: yes**, especially for diagnosis,
reproduction quality, and identifying the missing benchmark dimension. The
report accurately prioritizes a severe and consistent regression. The proposed
scan needs stronger descriptor-contract review and work calibration before it
could be accepted; its own report correctly identifies incomplete restoration.

## Subsequent product-policy exploration

The maintainer then challenged the callback-input guarantee itself, making
latency the priority. The [policy exploration](2026-11-05-metadata-policy-exploration.md)
records the history, rival rules and isolated prototype measurements. It also
reaches a remaining QueryRef-plus-predicate substitution cost and measures
correlated payload work. The scoped repair results above remain valid; they do
not close that broader performance objective. No new metadata law was adopted
and no accepted semantic comparison was changed during the exploration.

## Approved boundary-only implementation

The maintainer subsequently approved boundary-only protection. The
[implementation record](2026-11-05-boundary-only-metadata.md) supersedes this
report's callback-policy and correlated-work limits. The production design
removes dual callback views and uses compiler-known materialization paths.
The fourteen-path work owner now checks both descriptor APIs, including
projected QueryRef predicates and correlated receivers. New whole-suite and
correlated measurements, type contracts, neighboring-regression repairs,
mutants and source bindings are in that record. Earlier measurements and
review judgments above remain historical evidence.
