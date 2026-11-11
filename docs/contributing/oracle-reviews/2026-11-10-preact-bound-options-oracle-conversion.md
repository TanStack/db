# Preact finite bound-option receiver conversion

Reviewed code: `629c910565db30f89d9f17006c18f4eea80c36c7`.
Pre-conversion code: `6e56f0b1b063146e064589066779f4f0576e7ea4`.
This test refactor changes no production behavior and makes no gap-closure claim.

## Preserved law and receiving path

The shared `live-query-bound-options-oracle.ts` remains the judgment owner.
Its authority is the maintainer's inline-option decision and the framework
query-identity contract. An identity-comparing binding retains its Collection
and configured getKey/schema references on ordinary rerenders and source
publications. Identity replacement binds new option references and keys.

The receiver keeps all six getKey/schema/both × query/queryKey cases, each
with three ordinary rerenders, one source publication and identity replacement.
The production driver uses the same Preact layout-effect probe, native `act`
and settle boundary. It records reference relations rather than function or
Collection objects. Sentinels enact those relations through the unchanged
shared `checkBoundOptions` judgment. Source data and replacement keys retain
the original projections and comparisons.

The model derives published data from the authored source-update input and
replacement keys from the declared option choice. It uses no hook classifier,
query identity helper or production mutation state. Input rows are copied before
production receives them. The cleanup path remains `withOracleCleanup`.

## Finite coverage, states and calibration

`preact.bound-options` is an enumerated `oracleProperty` over the same six
cases. Each case must record all three rerender cuts, source-update and
identity-change cuts, plus its former reach states. All six primary cases
passed those checks. This supplies six checked histories for each common state,
two for each option state and three for each identity state. Calibration and
determinism runs supply additional copies; they are not included in those
primary-case counts.

Every original in-place-replacement control is retained as a property
calibration. Each changes the observed configured-reference relation while
keeping the Collection relation unchanged, and the shared checker rejects it.
All six calibrations pass. The finite campaign also checks determinism.
There was no generated run budget or fixed regression in this receiver, so no
budget or regression was removed. Its legacy baseline entry is removed.

The manifest uses `enumerated-campaign`, with no seed/path coordinates. Its
direct command selects this property's finite cases, calibrations and
determinism check. The command clears inherited replay variables. The seeded
wrapper rejects this target before starting a child and supplies that command.

## Validation

The combined Preact receiver suite passed 141 tests across three files.
The new finite property passed all 13 checks under its direct command, including
when seed/path/property variables were present in the caller. The named replay
manifest group passed 70 tests, including literal source discovery. The seeded
wrapper rejected the enumerated target with the expected direct guidance.
Normal ESLint on the converted file passed. `pnpm lint:changed` reported only
the earlier window property's intentional generic-budget-key replacement,
already explained in the window conversion record; it reported no oracle rule
violation. `git diff --check` passed.

```sh
pnpm --filter @tanstack/preact-db exec vitest run --maxWorkers=2 --coverage.enabled=false tests/window-render-oracle.test.tsx tests/bound-options-oracle.test.ts tests/bound-schema-options-oracle.test.ts
pnpm gap-report --package packages/preact-db --source src/useLiveQuery.ts --seed 2291 --contexts 2 --out /tmp/oracle-preact-bound-options-after
pnpm --filter @tanstack/db exec vitest run --maxWorkers=2 --coverage.enabled=false tests/oracle-replay.test.ts -t 'named oracle replay manifest'
pnpm exec eslint packages/preact-db/tests/bound-options-oracle.test.ts
pnpm lint:changed
```

From `packages/preact-db`, the finite command was:

```sh
env -u TANSTACK_DB_ORACLE_SEED -u TANSTACK_DB_ORACLE_PATH -u TANSTACK_DB_ORACLE_PROPERTY pnpm exec vitest run --maxWorkers=2 --coverage.enabled=false -t 'preact\.bound-options > ' tests/bound-options-oracle.test.ts
```

## Compatible baseline and mutation preservation

The before report is the completed `/tmp/oracle-preact-after/results.json`
from the window conversion. It includes all three Preact legacy/converted
receivers. The production source, e1fb504 oracle pins, worktree and local
fake-indexeddb 6.2.7 override match this run. Subsequent dependency installation
added React/Solid/Svelte dependencies without changing the Preact dependency
versions. Between that report and this conversion, the window receiver only
received import sorting and a proven-equivalent literal registration table;
its model, driver and checker did not change. The enumerated-manifest support
adds no receiving law or Preact history. The coordinator authorized reuse of
this compatible complete baseline.

Both reports have the same 48 stable mutant keys. All 18 prior kills remain
killed, and every outcome is unchanged: 18 killed, 17 crashed, 12 survived and
one unreached. Neither report has nondeterministic tests. Crashes and unreached
paths are not kills. The converted binding checker names `bound options` for
eight mutant observations and `source update rows` for three; law attribution
can overlap on one mutant. The remaining legacy schema receiver still
contributes unnamed kills.

The [comparison data](2026-11-10-preact-bound-options-oracle-conversion.json)
preserves every key, before/after outcome, law attribution and report hashes.
The full after report is
`/tmp/oracle-preact-bound-options-after/results.json` in the shared environment.

## Limits

This evidence covers the original six finite Preact option/identity cases and
its controlled one-row source. It does not establish DbClient admission,
arbitrary source values, SSR, provider behavior, schema transformations or
concurrent rendering. It makes no schema typing claim. It establishes preservation of the mutation sample,
without a claim to close surviving, crashed or unreached mutants. The local-only
fake-indexeddb 6.2.8-to-6.2.7 install workaround remains uncommitted.
