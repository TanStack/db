# Release CI repair, 2026-11-05

This record binds the oracle source hash below to the commit containing this
record. Parent/main: `bfb660a1e8074064cd1fd93a645273c17aaec98c`.
Release PR #2359 originally held `3525bc0bc92af65754ab90ec636bad3a345b7a16`.
Oracle source: `packages/db/tests/query/aggregate-select-oracle.property.test.ts`,
SHA256 `818b6ad798ad4caae9be4f084b6c1d50427a2dc0b47d465202f123f279ffcc4c`.
The repair changes test instrumentation and CI only; it adds no shipped JavaScript.

## Failure and repair

**Law and authority:** The existing aggregate-select law, architecture's
aggregate-select contract, and query guide's “Ordering by SELECT Fields” and
“Multiple Column Ordering” stay unchanged. Published rows match independent
aggregate recomputation; explicit string ordering uses `en-US` collation.
ORC-015 requires the declared premises to be reached.

**RED:** [DB shard 2](https://github.com/TanStack/db/actions/runs/42122151300/job/127587486662)
reported seed `411440032`, 14,845 passing tests, one failure, and no type errors.
Every query comparison passed. The final generated reach failed:
`a string field orders A against a lowercase key (0)`.
Replaying that seed on unchanged main reproduced the same reach failure.
The existing twelve structural histories reached it, but could not satisfy the
separate generated reach. The earlier November 2 repair documented that limit.

**Repair:** Each campaign retains its twelve structural examples and all 160
broad random histories. It adds twelve required histories generated from the
structural families: varied literals and order directions, parent/source writes,
optional shadowing and union, and zero to two tail mutations. The string-ordered
triple-group family forces shadowing and union, so mutation and receiving
checkpoints cannot depend on a lottery. Each required history runs the existing
independent model, production driver, and comparisons. `fc.sample` uses the
campaign seed; appending its results to fast-check examples preserves direct
seed/path replay and the twelve old structural indices. These randomized
examples are not independently shrunk. Broad histories retain ordinary shrinking.
No model rule, comparison, reach minimum, fixed seed, or broad budget changes.

**GREEN:** The captured seed passes all six tests, as do the normal fixed seed
2094 and fresh seed -1074795262. Full DB TypeScript checking reports no errors.
A diagnostic that temporarily ran only the structural and required prefixes
also passed with seed 411440032. The broad budget was restored immediately;
that diagnostic supplies the final table column, not normal campaign evidence.

**Mutant:** Changing the driver-supplied string collation from `locale` to
`lexical` fails the published-row comparison at
`initial: top-level rows in orderBy position 0`, seed 2094/path 11. This is an
assertion failure at the intended checkpoint, not a setup failure or timeout.
Restoring collation makes the same direct replay pass (one test, five replay
skips). The comparison and model were never changed to accept that mutant.

Reproduce from the repository root:

```sh
TANSTACK_DB_ORACLE_SEED=411440032 pnpm --filter @tanstack/db exec vitest run \
  tests/query/aggregate-select-oracle.property.test.ts \
  --coverage.enabled=false --maxWorkers=1
TANSTACK_DB_ORACLE_STATISTICS=1 pnpm --filter @tanstack/db exec vitest run \
  --config vitest.aggregate.config.mjs \
  tests/query/aggregate-select-oracle.property.test.ts --disableConsoleIntercept
TANSTACK_DB_ORACLE_PROPERTY=aggregate.select-shapes \
TANSTACK_DB_ORACLE_SEED=2094 TANSTACK_DB_ORACLE_PATH=11 \
pnpm --filter @tanstack/db exec vitest run \
  tests/query/aggregate-select-oracle.property.test.ts \
  --coverage.enabled=false --maxWorkers=1
```

## Measured reach

The normal run uses twelve structural plus 172 generated histories per campaign.
Structural counts are identical in both campaigns. Every generated count
includes only generated histories, never structural observations.

| State | Structural (each campaign) | Fixed generated | Fresh generated | Prefix only, captured seed |
| --- | ---: | ---: | ---: | ---: |
| bare include: field | 1 | 12 | 9 | 1 |
| bare include: nested | 1 | 13 | 15 | 1 |
| bare include: case | 1 | 10 | 6 | 1 |
| toArray include in a conditional branch | 1 | 12 | 9 | 1 |
| bare group keys without an aggregate | 1 | 18 | 27 | 1 |
| bare group keys beside an aggregate | 1 | 64 | 68 | 1 |
| include() wrap | 1 | 24 | 33 | 1 |
| materialize() wrap | 1 | 23 | 32 | 1 |
| grouping stripped alone: grouped | 1 | 30 | 16 | 1 |
| grouping stripped alone: one group | 1 | 10 | 13 | 1 |
| grouping stripped alone: HAVING aggregate | 1 | 28 | 20 | 1 |
| include runtime stripped | 1 | 14 | 18 | 1 |
| orderBy aggregate stripped beside a select aggregate | 1 | 33 | 25 | 1 |
| an aggregate orders the published rows | 1 | 25 | 22 | 1 |
| a number select field orders the published rows | 1 | 12 | 9 | 1 |
| a string select field orders the published rows | 1 | 3 | 8 | 1 |
| a string field orders A against a lowercase key | 1 | 3 | 5 | 1 |
| two orderBy terms order the rows | 1 | 10 | 9 | 1 |
| an include query orders its rows | 2 | 32 | 31 | 2 |
| two group keys publish several groups | 1 | 8 | 14 | 1 |
| three group keys publish several groups | 1 | 7 | 7 | 1 |
| published after a parent update | — | 37 | 28 | 4 |
| published after a source insert | — | 36 | 32 | 4 |
| published after a source update | — | 36 | 35 | 4 |
| published after a source delete | — | 34 | 36 | 4 |
| published after a source route move | — | 12 | 9 | 2 |
| a shadowed child alias publishes rows | — | 16 | 16 | 2 |
| a union source publishes rows | — | 34 | 30 | 4 |

## Grammar controls and limits

Reconstruction preserves the twelve original structural histories verbatim and
rebuilds their families with generated literals, direction and legal writes.
Removing the required prefix reproduces the captured reach miss on the parent;
removing broad sampling still reaches all 28 generated requirements. Literals
and direction vary expression results and ordering; source and parent writes
exercise incremental publication; route moves, shadowing and union distinguish
receiving paths. Omitting the string family removes the prefix's string witness.
Literals use the existing bounded domain, directions are ascending/descending,
route targets are `b`/`A`, and tail length is zero through two. Existing broad
histories retain their wider grammar. Union plus a nested include stays excluded
from required histories because it is rejected before compilation; the broad
grammar continues to check that rejection.

**Limits:** These are settled, controlled-core observations at the existing
initial and after-write checkpoints, not real-provider or framework scheduling
claims. Required premises are covered, but every operator × mutation × route
combination is not guaranteed. The existing unsupported ordering domains in the
coverage map remain open under the aggregate-select owner. No new product
mismatch or missing-input hypothesis was identified.

ORC-001/002/003/005: authority, independent model, literate responsibilities,
production paths and comparisons are unchanged and named in the executable
owner. ORC-004 controls are above. ORC-006/013: the A/lowercase ordering witness
and lexical mutant distinguish the promised collation. ORC-007: normal fixed
and fresh campaigns share grammar/check/budget; direct replay was verified.
ORC-008/009: no model states or vocabulary change. ORC-010: no cleanup or
failure-capture changes; statistics remain in `finally`. ORC-011: no new
shared-semantic-fault hypothesis; this is a reach repair. ORC-014: the claim
stays at the controlled-core boundary. ORC-015: measured counts above and both
reach assertions remain. ORC-016: all inputs use the shared model/driver/check;
no separate expected answers were added. This record supplies ORC-012 evidence.

## Benchmark failure

[Benchmark run 42122151381](https://github.com/TanStack/db/actions/runs/42122151381)
compared the release merge `c0a13e3af` with main `bfb660a1e`. Overall ratios were
1.02x writes and 1.03x cold hydration. The 1,000-row manual/synced document case
failed the persistent cold gate: base median 7.346ms, candidate median 16.005ms.
All three candidate repetitions exceeded the base range and both gate floors.
The release changed no runtime, harness, or resolved dependency input. This
establishes a false positive for this pair; it does not establish a noise ceiling.

CI now compares inputs before measuring, ignoring package versions, changelog
text, and changed workspace specifiers only when the resolved `link:` path
stays equal. External dependency specifiers/resolutions, code, build/config,
workflow and harness changes remain significant. Manual runs always measure.
An input-read failure fails CI. The real main-to-release comparison returns
`changed=false`; pre-2356-to-main returns `changed=true`. Three selector tests
and all nineteen existing regression-gate tests pass. Gate thresholds and
repetitions remain unchanged. Identical-input pairs add no regression evidence;
noise on changed-input pairs remains a calibration limit.
