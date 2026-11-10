# Preact window oracle conversion

Reviewed code: `ed38996b8165ebc41e83e5aae1a7c3f274918b03`.
Before code: `9a5214f2801c2c7918f6fd21ac5add317559322a`.
This is a test refactor. It changes no production behavior and makes no gap-closure claim.

## Preserved judgment

The authority remains the shared framework contract's query-identity and
window-commit laws and the maintainer's 2026-10-30 decision for #2291.
A committed finite outer-window move retains the live-query Collection and
exposes the ordered selected rows. A rejected Preact render keeps the last
committed page and starts no acquisition. The real Preact error boundary,
layout-effect recorder, native `act` settle, and retained public subscriber
remain the receiving path.

The same sort/filter/slice model and shared `checkWindowObservation` judge the
initial, committed, and aborted cuts. The production driver snapshots selected
fields and public identity relations before cleanup. Identity sentinels in the
check represent only those recorded relations. Exact error identity and the
positive aborted-render count remain required premises. Cleanup uses the
unchanged `ScenarioLifetime`; the property runner preserves named violations.

## Histories, reach, and run budgets

All 12 cells remain: eager/on-demand × derived/keyed × offset/limit/both.
Each cell now has its own `preact.window-render.<cell>` property. Each retains
six generated histories, fixed campaign seed 2291, a random campaign, and the
same fixed regression. The original offset and width intervals remain.

Every member of this history grammar commits one move and rejects the next.
The required construction therefore retains the generated parameters instead
of substituting a literal page. Both declared states, `committed move` and
`aborted move`, reached seven non-fixed histories in every cell and campaign.
The fixed regression does not supply required reach. The eight width
calibrations still reject an aborted width change through the shared checker.

The run-budget checker reports removal of the generic `preact.window-render`
key, formerly six. This is an identifier migration: 12 separate keys now each
carry six, preserving all 12 former six-run receiving cells. No campaign's run
budget was reduced. The old generic replay selector is replaced by 12 exact
selectors; each guarded seed-2291/path-0 replay executed one requested random
campaign and one history.

## Validation

Commands ran from the isolated framework worktree. Vitest used at most two
workers; each gap command used two contexts and ran alone.

```sh
pnpm --filter @tanstack/preact-db exec vitest run --maxWorkers=2 --coverage.enabled=false tests/window-render-oracle.test.tsx
pnpm gap-report --package packages/preact-db --source src/useLiveQuery.ts --seed 2291 --contexts 2 --out /tmp/oracle-preact-before
pnpm gap-report --package packages/preact-db --source src/useLiveQuery.ts --seed 2291 --contexts 2 --out /tmp/oracle-preact-after
pnpm --filter @tanstack/preact-db exec vitest run --maxWorkers=2 --coverage.enabled=false tests/window-render-oracle.test.tsx tests/bound-options-oracle.test.ts tests/bound-schema-options-oracle.test.ts
pnpm lint:changed
```

The unchanged window file passed 24 tests. The converted file passed 56 tests,
including determinism and calibration checks. All three Preact receivers passed
140 tests. All 12 guarded replays passed. The replay command, from
`packages/preact-db`, was the following with each cell's property ID:

```sh
TANSTACK_DB_ORACLE_PROPERTY=preact.window-render.eager-derived-offset TANSTACK_DB_ORACLE_SEED=2291 TANSTACK_DB_ORACLE_PATH=0 node --import tsx ../db/tests/oracle-replay.ts --maxWorkers=2 --coverage.enabled=false tests/window-render-oracle.test.tsx
```

`pnpm lint:changed` reported only the intentional generic run-budget key
replacement explained above. It reported no oracle rule violations.
Normal ESLint on the oracle, registry, manifest and baseline passed after an
import-order correction. Targeted `pnpm lint:changed` also passed. The full gap
comparison preceded that import-only correction. `git diff --check` passed.
Local installation used a local-only override from
`fake-indexeddb` 6.2.8 to 6.2.7 after an HTTP 403. The override and lock changes
remain uncommitted.

## Mutation preservation

Both reports contain the same 48 stable mutant keys. All 18 previously killed
mutants remain killed; no outcome changed. Each report has 18 killed,
17 crashed, 12 survived, and one unreached mutant. Crashes and unreached paths
are not kills. The converted window checker names `ordered window rows` for
four mutant observations and `outer window retains Collection` for three;
legacy receivers still contribute unnamed kills. Both baselines reported no
nondeterministic tests.

The [comparison data](2026-11-10-preact-window-oracle-conversion.json) preserves
every key and before/after outcome, law attribution, and report hashes. Full
reports are `/tmp/oracle-preact-before/results.json` and
`/tmp/oracle-preact-after/results.json` in the shared local environment.

## Limits

This evidence covers finite synchronous eager/on-demand source Collections,
real Preact error-boundary rendering, and the original bounded page grammar.
It establishes preservation of this mutation sample. It does not establish
Suspense, concurrent scheduling, asynchronous provider settlement, or closure
of the surviving, crashed, or unreached mutants. No semantic law, comparison,
production path, or fixed regression was retired.


## Literal registration follow-up

Final reviewed code: `6e5dec8fc7e336d164ff76c89c7ddad7130be874`.
The shared manifest's source-discovery test exposed a missed integration gate:
computed IDs did not appear as literal property names in the receiving file.
The focused test failed with the first missing Preact property. An explicit
12-tuple registration table now supplies the same ID/source/key/move cells.
No oracle law, grammar, model, production driver, comparison, or budget changed.
A separate tuple comparison verified all 12 entries against the original
Cartesian registration, including the association of each ID with its flags.

The full named replay-manifest group passed 69 tests after the change; the
Preact window suite passed all 56 tests with seven histories reaching each
declared state per campaign and cell. The guarded on-demand/keyed/both
seed-2291/path-0 replay again executed exactly one requested history. Normal
ESLint, targeted oracle lint, and `git diff --check` passed. The mutation report
comparison was run at `3b492829777c871d8769742ddfdce150df7a5b60`, before this
registration-only change and the import-order correction. Its evidence is
unchanged; no additional mutation run is claimed.

```sh
pnpm --filter @tanstack/db exec vitest run --maxWorkers=2 --coverage.enabled=false tests/oracle-replay.test.ts -t 'named oracle replay manifest'
pnpm --filter @tanstack/preact-db exec vitest run --maxWorkers=2 --coverage.enabled=false tests/window-render-oracle.test.tsx
pnpm exec eslint packages/preact-db/tests/window-render-oracle.test.tsx
pnpm lint:changed packages/preact-db/tests/window-render-oracle.test.tsx
```
