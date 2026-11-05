# Incremental query benchmark

Run `pnpm --filter @tanstack/db-ivm build`, then:

```sh
node --import tsx scripts/bench/incremental-update.ts \
  --iterations=100 --warmup=20 --repetitions=3 --outFile=candidate.json
node --import tsx scripts/bench/compare-incremental-update.ts \
  --base=base.json --candidate=candidate.json --failOnRegression=true
node --test scripts/bench/compare-incremental-update.test.mjs
```

Each repetition creates fresh fixtures and queries, times their first preload,
and measures writes after warmup. Reports retain all cold-load times and
per-repetition write medians; displayed statistics are medians across repetitions.
Only the document case populates rich-text document fixtures. Creating those
trees for unrelated queries can move their garbage collection into another
case's timed hydration. The document case retains its complete fixture, and
normal garbage collection remains enabled during every measurement.
The nested-document case joins all open issues to 20-block documents and selects
whole documents without a limit. Synced updates and optimistic updates with
rollback run at all scales and index modes, like the existing flat cases.

CI compares benchmark inputs before installing or measuring. Package versions,
changelogs, and workspace dependency specifiers whose resolved `link:` target
is unchanged do not affect that comparison. Runtime, dependency resolution,
configuration, workflow, and harness changes still run the gate. A manual run
always measures. Input-selection errors fail the job; branch names never grant
an exemption. Run `node --test scripts/bench/inputs-changed.test.mjs` to check
this selection.

When inputs differ, CI runs the same benchmark code on the candidate and merge
base on one runner. It fails for either of these conditions:

- A query's geometric mean across its configurations increases by more than
  30% for writes, or 50% for cold hydration. Improvements in another query or
  metric cannot cancel a regression.
- One configuration's fastest candidate repetition exceeds its slowest base
  repetition by more than 50%, and by more than 0.05ms for writes or 5ms for
  hydration. Both sides must have at least three repetitions. This catches
  persistent localized regressions without failing for one isolated outlier.

The existing red/green per-case flags remain diagnostic: they have lower
thresholds and do not by themselves fail CI. `--threshold` can raise the gate's
relative thresholds. Missing cases, duplicate cases, invalid timings, or missing
CI hydration observations fail instead of silently reducing the comparison.
Reports and the job summary remain available when the gate fails.

The [nested-row repair measurements](nested-row-repair-2026-11-05.csv) retain
three repetitions for the pre-regression, regressed and repaired DB source.
See the [repair evidence](../../docs/contributing/oracle-reviews/2026-11-05-nested-row-performance.md)
for source controls, validation and limits.

## CI variation measured on 2026-11-05

The [measurement table](ci-variation-2026-11-05.csv) contains query rollups from
ten paired runs with no changes to `packages/db/src` or `packages/db-ivm/src`.
GitHub's compare API verified that premise (each response had fewer than its
300-file limit). Download each `benchmark-reports` artifact with
`gh run download RUN --repo TanStack/db --name benchmark-reports`; the table
records the run, both exact reported SHAs, CPU and query. A run's page is
`https://github.com/TanStack/db/actions/runs/RUN`.

Each original report contains 72 cases, 100 writes and 20 warmups, using Node
24.8.0. Within-job query geometric means span 0.895–1.100 for writes and
0.851–1.203 for cold hydration. Individual case ratios are much noisier: cold
outliers exceed 7x even without a runtime change. These ten pairs produced
legacy per-case red flags in eight runs, although every query rollup stayed
below the new gate. This is evidence for pooling and repetition, not a universal
false-positive bound.

Nine of those runs benchmark the identical base `8feab6ea3` on five CPU models.
Across their 36 cross-job pairs, absolute-direction overall ratios reach 2.76x
for writes and 1.88x for hydration. Individual-case ratios reach 5.67x and
4.87x, respectively. Never gate against absolute timings from a different job.

The first remote three-repetition run
[passes](https://github.com/TanStack/db/actions/runs/42087213348). It covers PR
head 066d0dd26 through GitHub merge commit 88544ac64, before later review fixes.
Additional same-code CI history is still needed to calibrate false positives.
The initial 30%/50% query margins exceed every query shift in this sample;
repeated ranges supply a consistency check for localized regressions. Revisit these
margins with additional same-code paired runs, particularly after runner or Node
changes. This finite historical sample does not prove a future noise ceiling.

## Approved boundary-only implementation

The [initial suite measurements](boundary-only-suite-2026-11-05.csv) and
[correlated probes](boundary-only-metadata-2026-11-05.csv) measure the approved
policy implementation against pre-2312 DB sources with current dependencies.
The full-suite geometric means are 0.88× writes and 0.91× cold; the nested
query's are 0.913× writes and 1.019× cold. The
[implementation record](../../docs/contributing/oracle-reviews/2026-11-05-boundary-only-metadata.md)
explains source controls, descriptor-work evidence and remaining fixed costs.
These are measurements of the implementation before the prep-review repairs.
They do not establish zero overhead for every query.

The [final bracketed measurements](boundary-only-prep-bracket-2026-11-05.csv)
retain a pre-2312 run, the reviewed candidate, and another unchanged pre-2312
run, in that order. All use the same current harness and dependencies, 100
writes, 20 warmups and three repetitions across 84 cases. Candidate/base
geometric means are 1.138× writes and 1.354× cold against the first baseline,
then 1.038× and 1.051× against the second. The first comparison fails the
issue-detail cold gate; the second passes. The unchanged baseline itself
shifts by 1.096× writes and 1.288× cold. The nested query's candidate/base cold
ratios are 1.396× and 1.157×. This exposes substantial run drift and leaves
small overhead unresolved; neither comparison is discarded. These diagnostic
baselines use pre-2312 DB sources, whereas CI compares the PR's merge base.
See the [prep-review record](../../docs/contributing/oracle-reviews/2026-11-05-boundary-only-prep-review.md)
for the final source binding, gate outcomes and measurement limits.

The [high-review measurement table](high-review-2026-11-05.csv) retains all seven
later local runs (588 cases with three repetitions per case), including noisy
unchanged controls and every candidate observation. A simplified working tree
before the final pair-key amendment measures 1.00x writes and 0.96x cold against
the third predecessor control, passing the unchanged gate with one diagnostic
write flag. The final pair-key source measures 0.91x writes and 0.80x cold
against the same control, passing with no diagnostic flags. These runs compare with predecessor 708a58098, not pre-2312 or the
PR merge base. The [high-review record](../../docs/contributing/oracle-reviews/2026-11-05-boundary-only-high-review.md)
binds source, work, size and law evidence and preserves all observed limits.

The later [1498a8101 CI run](https://github.com/TanStack/db/actions/runs/42105504239)
measures 0.63x overall writes and 0.51x cold, but fails the localized cold gate
for comment counts at 1,000 rows without indexes in optimistic mode: 7.266 ms
base median versus 17.383 ms candidate. All three candidate samples exceed the
base range and both floors. The [CI table](boundary-only-ci-2026-11-05.csv)
retains both remote pairs (1,008 repetition rows). Thresholds remain unchanged;
the high-review record tracks the repeatability investigation.

The source-identical [f34738e69 repeat](https://github.com/TanStack/db/actions/runs/42106831377)
fails the same case: 8.600 ms base median versus 17.413 ms candidate. All three
remote pairs remain in the CI table (1,512 repetition rows). Local Node 24.8
profiling reproduces the shift and attributes 12.292 ms across three affected
hydrations to garbage collection. A diagnostic collection before hydration,
with the original complete fixtures, reverses that case's median comparison
to 5.618 ms base versus 4.524 ms candidate. This control is diagnostic only;
the committed harness does not force collection or filter samples.

With document fixtures confined to their own query, the full local Node 24.8
[paired measurements](query-fixture-isolation-2026-11-05.csv) pass the unchanged
gate: 0.61x writes / 0.51x cold. The formerly failing case measures 4.149 ms
base versus 3.547 ms candidate. Both sides use the corrected harness, with the
same sources, scales, index modes, write counts and repetitions. The candidate
production sources are unchanged from f34738e69; the base is 8feab6ea3. A new
remote run must verify the corrected harness on CI. These controls identify
fixture-dependent GC scheduling; they do not establish zero production overhead.
