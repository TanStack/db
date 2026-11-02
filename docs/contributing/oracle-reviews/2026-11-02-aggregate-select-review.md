# Aggregate select review, 2026-11-02

## Contract and implementation state

The nine findings concern test integrity, diagnostics, documentation, and
maintainability. They identify no production defect or new product law.
The reviewer read the diff, did not run the oracle, and verified the original
source hash. This follow-up supplies executed experiments.

Reviewed remote head: `df5353866bbc99aed92e0ae3361901f2007d32c2`.
Current-main integration: `8cb66ee011cb7c484dbdf5cd81c14d48bf09491c`, with parents
`df5353866bbc99aed92e0ae3361901f2007d32c2` and
`9be51e037f6c092bc9625f9b5b4b7e23eb4fa5fe`.
The aggregate source SHA256 for the results below is `630602aebe41bfd39804c482a2c0a7deb60194a34d865ccd467de4f824fc52c7`.
The commit containing this record binds the source, configs, and shared helpers.
Production, dependencies, and the lockfile are unchanged relative to current main.

**Law and authority:** The aggregate owner and the query guide retain their
existing law: compilation follows the select/operator rules, and published
rows equal independent group recomputation, including the documented locale
order. ORC-015 requires declared premises to be reached. ORC-007 requires parity
between fixed and fresh campaigns. It also requires direct replay. A fixed
example cannot supply evidence about a generated history. Diagnostic seed
selection is not execution proof; guarded replay witnesses retain that role.

**Repair:** Each campaign has a structural reach for the 21 initial premises
and a separate generated reach for those same states plus seven successful
mutation/route comparison checkpoints. The 12 structural inputs are complete
histories with no mutation steps, shadowed alias, or union. They are not
prefixes of generated histories. The generated budget remains 160, minima
remain one, and fixed seed 2094 remains. Named history fields replace the
10-slot tuple; campaign callbacks determine structural provenance.

Shared parameter helpers choose and report a fresh seed when no seed is given.
They preserve explicit seeds, path selection, example accounting, replay
reporters, and one-history path replays. The campaign runner reports seed and
counts even on failure. Aggregate statistics run in `finally`, use `=== '1'`,
and clear the current reach after failure. A seed-only replay reruns a reach
campaign; a reach failure after successful comparisons has no shrink path.

## Experiments and inference

Before repairs, all three hostile generator edits passed the fixed campaign:
ordered-lane weight zero, no string terms from the ordered lane, and no runtime
stripping from the generated grammar. The structural histories concealed every
missing premise. The same edits failed an independent generated-reach probe,
then failed the repaired branch at the generated reach assertion. Removing
steps, shadowing, or union from the generated grammar also fails the new
checkpoint assertions. These are coverage failures, not production mismatches.

Changing the structural triple input to a single key fails structural reach
even though generated histories still reach triple groups. Selecting lexical
collation in the driver fails the public row-order comparison. Seed 2094/path
11 reproduces that mismatch directly; restoring the driver makes that replay
pass (one test runs, five stand aside).

The shared declared-reach model first failed against unchanged helpers because
a failing campaign omitted counts and fresh options omitted a chosen seed.
It now checks generated run kinds, exact budgets/examples, replay parameters,
seed diagnostics, and counts on failing campaigns. Removing either fresh-seed
propagation or its diagnostic line fails that owner. Existing replay-reporter
checks retain native failure formatting and cause behavior.

A fresh reach-only failure selected seed `373827046`. Repeating that
seed reproduced the same generated counts and the same missing-runtime state.
With statistics `0`, aggregate counts do not print. With statistics `1`, the
injected reach failure retains both structural and generated counts.

GREEN: 14 focused tests pass across the aggregate owner, declared-reach owner,
campaign helper, and reach helper. Both aggregate campaigns run, plus all four
existing model replays. Another 38 reporting/manifest checks pass; 44 unrelated
child-process replay checks stand aside under an explicit test selector.
Focused TypeScript exits zero with `--listFiles`, which lists the intended
owners and helpers. Local cached Vitest is 3.2.4; repository CI uses 4.1.12.
No install, override, dependency edit, or production edit ran.

**Sibling S01:** A fresh seed is not an explicit replay. Auditing `.seed`
consumers found three sites that used seed presence to select replay behavior:
structural-identity fixed campaigns, layered-publication campaigns, and the
serializer shrink/replay calibration. They now read explicit replay selection
from `readOracleRunConfig`. The calibration keeps seed 20260914 in ordinary
runs. A control-plane probe reproduced the omitted-campaign decision before
repair. All 131 tests in the three affected owners then pass, including fixed
and fresh publication campaigns and the serializer replay calibration. This
preserves the existing contracts, generators, comparisons, and budgets.

## Reproduce from a checkout

These commands use committed configs and resolve the checkout's own source.
They require the repository dependencies already installed.

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 pnpm exec vitest run --config packages/db/vitest.aggregate.config.mjs tests/query/aggregate-select-oracle.property.test.ts tests/declared-reach-oracle.property.test.ts tests/oracle-campaign.test.ts tests/oracle-reach.test.ts
pnpm exec vitest run --config packages/db/vitest.aggregate.config.mjs tests/oracle-replay.test.ts -t 'oracle replay reporting|named oracle replay manifest'
pnpm exec tsc --project packages/db/tsconfig.aggregate.json --noEmit --listFiles
pnpm exec vitest run --config scripts/oracle-diagnostics.vitest.config.mjs
TANSTACK_DB_ORACLE_PROPERTY=aggregate.select-shapes TANSTACK_DB_ORACLE_SEED=2094 TANSTACK_DB_ORACLE_PATH=11 pnpm exec vitest run --config packages/db/vitest.aggregate.config.mjs tests/query/aggregate-select-oracle.property.test.ts
pnpm lint:changed
```

The first command runs the default fixed and fresh campaigns. To replay a
reach miss, set `TANSTACK_DB_ORACLE_SEED` to its `ORACLE_SEED` value and select
the random test with `-t 'random or replayed'`. Do not add a path for a whole
campaign reach miss. The fifth command above demonstrates a path replay, not
a whole-campaign reach check. An empty successful TypeScript output is normal;
record the command and exit status instead of inferring success from its hash.

## Separate reach counts

Final local fresh aggregate seed: `261424648`. The structural columns
count only fixed initial histories. Generated columns exclude them.

| State | Fixed structural | Fixed generated | Fresh structural | Fresh generated |
| --- | ---: | ---: | ---: | ---: |
| bare include: field | 1 | 11 | 1 | 6 |
| bare include: nested | 1 | 12 | 1 | 12 |
| bare include: case | 1 | 9 | 1 | 8 |
| toArray include in a conditional branch | 1 | 11 | 1 | 9 |
| bare group keys without an aggregate | 1 | 17 | 1 | 25 |
| bare group keys beside an aggregate | 1 | 63 | 1 | 70 |
| include() wrap | 1 | 23 | 1 | 25 |
| materialize() wrap | 1 | 22 | 1 | 23 |
| grouping stripped alone: grouped | 1 | 29 | 1 | 20 |
| grouping stripped alone: one group | 1 | 9 | 1 | 9 |
| grouping stripped alone: HAVING aggregate | 1 | 27 | 1 | 22 |
| include runtime stripped | 1 | 13 | 1 | 13 |
| orderBy aggregate stripped beside a select aggregate | 1 | 32 | 1 | 33 |
| an aggregate orders the published rows | 1 | 24 | 1 | 21 |
| a number select field orders the published rows | 1 | 11 | 1 | 9 |
| a string select field orders the published rows | 1 | 2 | 1 | 6 |
| a string field orders A against a lowercase key | 1 | 2 | 1 | 4 |
| two orderBy terms order the rows | 1 | 9 | 1 | 10 |
| an include query orders its rows | 2 | 30 | 2 | 28 |
| two group keys publish several groups | 1 | 7 | 1 | 12 |
| three group keys publish several groups | 1 | 6 | 1 | 7 |
| published after a parent update | — | 33 | — | 36 |
| published after a source insert | — | 32 | — | 31 |
| published after a source update | — | 32 | — | 38 |
| published after a source delete | — | 30 | — | 34 |
| published after a source route move | — | 10 | — | 13 |
| a shadowed child alias publishes rows | — | 15 | — | 11 |
| a union source publishes rows | — | 32 | — | 29 |

## Lossless finding accounting

| ID | Technical verdict and severity | Action and durable value |
| --- | --- | --- |
| R01 | Confirmed test-integrity flaw, high. Structural inputs masked all generated reach. | Fixed: independent generated minima and hostile lane/string/runtime ablations. |
| R02 | Confirmed documentation overclaim, medium. Initial coverage does not establish mutations or routes. | Fixed: exact coverage-map limit and seven generated-only comparison checkpoints. They do not claim a full state-by-mutation cross-product. |
| R03 | Confirmed prose error, low. These inputs have neither suffix nor recorded replay origin. | Fixed: complete structural histories and their exact initial scope. |
| R04 | Confirmed reproducibility gap, medium. An empty TypeScript log alone does not prove a failed command. Version and integration caveats are accurate. | Fixed: repository-relative configs, current integration verification, command/exit/listed-file evidence, and explicit historical evidence. Final CI on Vitest 4.1.12 remains a separate readiness gate. |
| R05 | Confirmed shared diagnostic gap, medium. A final reach failure can follow fast-check success without a reported seed. | Fixed: shared chosen-seed diagnostics, seed/count relation checks, and executed seed-only replay. Direct fast-check callers outside these helpers retain their own diagnostic responsibility. |
| R06 | Confirmed maintainability issue, low. The manual count was correct but duplicated shared policy. | Fixed: `oracleRandomParameters` accounts for examples. The literal budget/seed object remains visible to the existing budget auditor. |
| R07 | Confirmed diagnostic flaw, medium. The post-assert statistics never ran on a reach miss. | Fixed: one aggregate runner prints in `finally`; the shared campaign owner checks failing-campaign counts. |
| R08 | Confirmed consistency error, low. The string `0` enabled aggregate statistics. | Fixed: exact `1` gate, checked with both values. Seed-selection diagnostics are separate from optional statistics. |
| R09 | Confirmed maintainability issue, low. Fixedness was an interchangeable boolean in the generated tuple. | Fixed: named history fields and callback-owned provenance; no dummy constant remains. |

All nine source-order items have dispositions: 9 fixed now, 0 omitted, 0
confirmed open, 0 deferred, and 0 unresolved law decisions. R04 contains an
important qualification, not evidence that the historical TypeScript run failed.
Sibling S01 is also fixed. No production bug is claimed.

## Reviewer assessment and limits

Hire recommendation: **yes** for careful code review. The review correctly
prioritized a false green, connected it to lost replay diagnostics, separated
production defects from test integrity, and proposed idiomatic shared repairs.
Its evidence criticism needed the TypeScript qualification. It supplied no
executed counterexample; the experiments above establish the behavioral claims.

This is a self-review of the repairs. Earlier CodeRabbit coverage of the
original three files does not establish external review of the shared helper
changes. Readiness remains unproven until final pushed-head CI completes.
The controlled boundary is real Collection/live-query code in jsdom. No new
provider or framework-browser coverage is claimed. The structural guarantee
covers initial compilation/publication only. Generated coverage is sampled,
not every law after every mutation, route, or shape. A missed generated state
fails; it is never silently supplied by structural coverage. All existing
shape/type exclusions remain. No full repository campaign, release merge,
publisher, or publication verification ran for this review.

## CI configuration expectation follow-up

At head `a0e323a7750a24621a2668a3c8f2a761865872d2`, CI run `41521949066`,
job `125539942181`, found one stale configuration assertion in `utils.test.ts`.
It expected ordinary options to omit the seed, although the reviewed helper
change now selects one. The focused local reproduction failed at that same
assertion: one failed test, 15 passed, and 116 stood aside under the selector.

The assertion now expects a numeric seed. Exact object equality still rejects
an unexpected path or reporter. The neighboring assertions retain the explicit
seed for another property and the one-run shrink path for its named property.
All 132 tests in `utils.test.ts` pass after this correction. The shared helpers,
oracle models, generated histories, and production code are unchanged from
`a0e323a`. Earlier oracle and mutant results remain source-identical evidence;
they were not rerun for this assertion and wording correction. New-head CI
remains required.

CodeRabbit completed its review of `a0e323a` with 15 selected files and two
similar files skipped. Its one additional comment requested clearer ORC-007
wording above. That wording is corrected. This review did not supply executed
oracle evidence, and its coverage does not establish review of a later head.
