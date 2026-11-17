# Observer snapshot campaign registration migration

This changes campaign registration to `oracleProperty`. It does not change
production, the accepted laws, the independent judgments, or the comparison
checkpoints. The source parent is `c2df39e00450d885e1100cfa2d40df3731068cf1`.
The existing assertion adapter preserves authored assertion objects, causes,
and stacks; setup, runtime, and cleanup failures retain their original path.
Only data judgments and actual per-history reach states enter the native trace.

## Campaigns and preserved domain

| Property suffix | Base runs per campaign | Fixed seed | Retained domain |
| --- | ---: | ---: | --- |
| retained-snapshot | 40 per receiving cell | 2043 | ordered/single × attached/detached; 1..24 commands and at most 30 deferred reads |
| snapshot-health | 80 | 695 | 1..24 weighted report/healthy/write/ownership/read commands |
| row-container-sharing | 40 | 1101 | both modes, attachment cuts, 0..3 initial rows, 1..12 commands |
| capture-paths | 40 | 2346 | ordered/single, both modes, hydration, attachment, 2..3 rows, 1..2 deferrals, 1..12 generated commands |
| record-shape | 40 | 234602 | plain/class/null record shapes, four carriers, both modes, source and projected query receivers |
| sparse-array | 20 | 234603 | the unchanged shared positional grammar and all 24 carrier/mode/projection/attachment cells |

Every registration runs its original fixed seed and an unseeded campaign.
Retained-snapshot keeps the base replay ID and runs all four receiving cells
for each generated pair; its eight qualified reach names preserve the two
getter obligations independently for each cell. Five checked health constructions
preserve the old minimum of five histories per state, now in each campaign.
The constant-object capture and health commands use equivalent records so
freshly constructed commands remain members of the arbitrary's shrink language.
Their values and weights are unchanged.

All original fixed cases remain. Row-container and record-shape examples are
native fixed histories. Capture-path examples retain all thirteen commands as
direct shared-driver replays: they remain outside the twelve-command generated
language, rather than widening it or dropping a command. Legal constructions
with generated suffixes supply native declared reach. The sparse driver still
runs every receiving cell with `Promise.allSettled` and retains aggregate causes.

The health campaign now has its previously documented ID in the replay registry
and manifest. The other five IDs remain unchanged. Obsolete test-name filters
and the completed snapshot legacy exemption are removed.

## Verification

- Focused owner: **79 tests passed**, including the original lazy-read checker calibration.
- Explicit `tsc --noEmit -p tsconfig.test.json` from `packages/db`: passed.
- ESLint on the four changed source/metadata files: passed.
- Replay registry/source/cwd checks: **3 tests passed**.
- All six IDs replayed with their fixed seed and path `0`; each guarded report
  records `executions: 1`, witness `numRuns: 1`, and `failed: false`.
- `git diff --check`: passed.
- `pnpm lint:changed`: no oracle-rule diagnostics and no new snapshot budget
  report. Its nonzero result contains the same three inherited removed-budget
  reports: the hydration-subset ID split (both eight-run mode budgets remain),
  Preact window-render, and OP-SQLite. This commit does not change their budgets.
- An AST inventory confirms all 62 authored `expect` calls in the eight
  mature comparison helpers remain, together with every existing `checkRead`
  and shared `checkSparseArray` call.

Commands use `pnpm_config_verify_deps_before_run=false` and one Vitest worker.
The owner command is:

```sh
pnpm exec vitest run tests/live-query-observer-snapshot-oracle.property.test.ts --maxWorkers=1 --coverage.enabled=false
```

The guarded replay command, from `packages/db`, is:

```sh
TANSTACK_DB_ORACLE_PROPERTY=live-query-observer.PROPERTY TANSTACK_DB_ORACLE_SEED=SEED TANSTACK_DB_ORACLE_PATH=0 node --import tsx tests/oracle-replay.ts tests/live-query-observer-snapshot-oracle.property.test.ts --maxWorkers=1 --coverage.enabled=false
```

## Evidence boundaries

- **Law:** the existing point-in-time snapshot, stable identity, health-frame,
  row-container, capture/layout, record-shape, and sparse positional contracts;
  their original authorities remain beside their independent helpers.
- **Reach:** every declared state reached in both native campaigns; counts below.
- **RED:** no production defect or changed product behavior is claimed. An
  initially omitted record-shape registration callback failed native constructed
  reach at path `0`; restoring the original callback repaired the migration.
- **GREEN:** the owner, explicit TypeScript, lint, manifest, and six guarded replay checks above.
- **Mutant:** the existing live-Collection lazy getter calibration remains and
  passes by rejecting the wrong answer. No new mutation campaign or mutation
  preservation result is claimed for this mechanical migration.
- **Limits:** all original domain, scheduling, provider, and framework limits
  remain. These checks verify registration, reach transport, replay, and existing
  judgments; they do not establish new product coverage or bug-class closure.

## Observed per-history reach

Fixed examples do not contribute to these native campaign counts. Constructions
are generated from each campaign's seed and checked against the same helper.

### `live-query-observer.retained-snapshot`

| Declared state | fixed seed 2043 | random campaign |
| --- | ---: | ---: |
| client-getter-ordered-attached | 41 | 41 |
| client-getter-ordered-detached | 41 | 41 |
| client-getter-single-attached | 41 | 41 |
| client-getter-single-detached | 41 | 41 |
| server-getter-ordered-attached | 41 | 41 |
| server-getter-ordered-detached | 41 | 41 |
| server-getter-single-attached | 41 | 41 |
| server-getter-single-detached | 41 | 41 |

### `live-query-observer.snapshot-health`

| Declared state | fixed seed 695 | random campaign |
| --- | ---: | ---: |
| attached-read-after-health-change | 53 | 51 |
| detached-read-after-health-change | 54 | 55 |
| read-across-attach-after-health-change | 51 | 50 |
| read-with-several-failures | 53 | 51 |
| unchanged-tree-read | 67 | 58 |

### `live-query-observer.row-container-sharing`

| Declared state | fixed seed 1101 | random campaign |
| --- | ---: | ---: |
| attach-granular | 6 | 19 |
| attach-wholesale | 14 | 7 |
| attached | 35 | 36 |
| detach-granular | 11 | 16 |
| detach-wholesale | 13 | 6 |
| detached | 36 | 35 |
| empty | 9 | 15 |
| equal-revision-reenrichment | 28 | 33 |
| granular | 14 | 26 |
| health-only | 29 | 38 |
| noop-granular | 14 | 26 |
| noop-wholesale | 29 | 17 |
| reattach-granular | 5 | 17 |
| reattach-wholesale | 11 | 6 |
| status-only | 43 | 43 |
| value-only | 31 | 29 |
| wholesale | 29 | 17 |

### `live-query-observer.capture-paths`

| Declared state | fixed seed 2346 | random campaign |
| --- | ---: | ---: |
| discarded-move-granular-attached | 11 | 11 |
| discarded-move-granular-detached | 8 | 9 |
| discarded-move-wholesale-attached | 8 | 7 |
| discarded-move-wholesale-detached | 12 | 8 |
| discarded-write-granular-attached | 9 | 12 |
| discarded-write-granular-detached | 8 | 9 |
| discarded-write-wholesale-attached | 6 | 10 |
| discarded-write-wholesale-detached | 11 | 4 |
| hydrated-ordered | 17 | 21 |
| hydrated-single | 17 | 15 |
| initial-attached-granular | 13 | 15 |
| initial-attached-wholesale | 11 | 13 |
| initial-detached-granular | 10 | 10 |
| initial-detached-wholesale | 14 | 10 |
| layout-only-granular-attached | 4 | 8 |
| layout-only-granular-detached | 3 | 11 |
| layout-only-wholesale-attached | 11 | 6 |
| layout-only-wholesale-detached | 13 | 6 |
| metadata-ordered-granular | 5 | 10 |
| metadata-ordered-wholesale | 12 | 10 |
| metadata-single-granular | 10 | 10 |
| metadata-single-wholesale | 4 | 5 |
| nested-discard | 32 | 31 |
| ordered-granular | 10 | 14 |
| ordered-wholesale | 17 | 12 |
| single-granular | 13 | 11 |
| single-wholesale | 8 | 11 |

### `live-query-observer.record-shape`

| Declared state | fixed seed 234602 | random campaign |
| --- | ---: | ---: |
| array | 13 | 11 |
| class-plain | 30 | 26 |
| map | 12 | 9 |
| plain-class | 31 | 26 |
| plain-null | 30 | 26 |
| query-granular | 23 | 23 |
| query-wholesale | 25 | 25 |
| record | 9 | 14 |
| same-shape-copy | 38 | 39 |
| set | 14 | 14 |
| source-granular | 23 | 23 |
| source-wholesale | 25 | 25 |

### `live-query-observer.sparse-array`

| Declared state | fixed seed 234603 | random campaign |
| --- | ---: | ---: |
| defined-hole | 21 | 21 |
| direct | 21 | 21 |
| hole-defined | 21 | 21 |
| hole-undefined | 21 | 21 |
| query-granular-attached | 21 | 21 |
| query-granular-detached | 21 | 21 |
| query-wholesale-attached | 21 | 21 |
| query-wholesale-detached | 21 | 21 |
| record | 21 | 21 |
| set | 21 | 21 |
| source-granular-attached | 21 | 21 |
| source-granular-detached | 21 | 21 |
| source-wholesale-attached | 21 | 21 |
| source-wholesale-detached | 21 | 21 |
