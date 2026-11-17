# Preact mutation-schema receiver conversion

Reviewed source: `8318e90be49507bd11faf68dc3fb01c05db4e60e`; pre-conversion source: `8160dc1ee350020eb3eeb67a876505a2c2d151ee`.
This is a test refactor. It changes no production behavior and makes no survivor-gap closure claim.

## Law and receiving path

Identity-comparing bindings retain the configured mutation schema until query identity changes. A held client update exposes that schema's transformed rows and handler payloads. Settlement restores authored source rows; sync publications remain raw. Authority remains the shared bound-options owner, the schema guide's TInput/TOutput contract, the optimistic-history contract and the maintainer's inline-option decision.

The Preact receiver retains all 72 absent/trim/uppercase × query/queryKey × same/new key × padded-input cases. Each still performs twelve raw-source, held, settled and later-next-use cuts. Its real useLiveQuery hook, native act, committed render probe, immediate update-call read and cleanup schedule remain in place. Collection entries, host state/data, handler original/modified/changes and reference relations remain separately representable.

The existing independent schema model and strict Vitest comparisons judge recorded observations. The recorder computes no expected schema output. Authored source rows and later source labels are now history inputs, copied before production receives them. Only unspecified row order is normalized; missing/duplicate rows, wrong keys, extra own undefined fields and wrong payloads fail the same comparison.

The shared legacy React driver is retained byte for byte; its new Preact recorder is additive. This deliberately keeps the React receiving path unchanged while that receiver remains legacy. The ordinary and Suspense React schema suite still passes 216 checks.

## Finite coverage, replay and review repair

`preact.bound-schema-options` enumerates the same 72 cases. Each requires all twelve comparisons and exact reach entries, giving 864 checked reach cells. No generated run budget or fixed regression existed in this finite receiver. Its legacy baseline entry is removed. The replay manifest names an enumerated campaign and a direct finite command, with no seed/path claim. The seeded wrapper rejects the target with that command; the direct command clears caller seed/path/property variables and passes 79 checks.

Six permanent calibrations reject a missing replacement-followup cut, early handler settlement, retained-binding replacement, duplicate public cut, and binding/handler-hold violations followed by a later driver error.

Independent review found S1 in the first draft: the checker required all later cuts before judging an earlier recorded binding mismatch. A later driver error could therefore replace the named binding-law rejection. The real native recording path reproduced RED: the calibration surfaced the raw `later retained update failure`. The repair judges recorded observations chronologically before checking completeness. The same binding control and adjacent raw-row/held-immediate controls now pass three framework calibrations, requiring the named binding/rows/mutation laws before the later errors. The [independent review](2026-11-10-preact-schema-options-independent-review.md) records the source hashes, finding, repair and rubric audit. Its probe/configuration and RED/GREEN logs are preserved in the comparison JSON.

An explicit full-project compiler also found an earlier bound-options callback inference error that Vitest's static collector missed. Adding `history: History` to its calibration callback resolves the inferred-never error without changing runtime code or its law.

## Mutation preservation and provenance

The compatible baseline is the committed complete 48-key comparison from the prior [bound-options conversion](2026-11-10-preact-bound-options-oracle-conversion.json). Its reviewed source 629c91056 and this conversion's starting source 8160dc1ee have identical tracked Preact package, DB/IVM production, shared schema helpers, native render probe, owner layout, configuration and committed dependency pins. The e1fb504 package pin, Preact 11.2.0, Vitest 5.1.0, fast-check 4.10.2 and local fake-indexeddb 6.2.7 workaround remain the same.

The original raw baseline reports were lost during the host restart. The committed complete comparison, report hashes and recorded compatibility evidence survived. The reconstructed tracked-tree manifest and current package metadata are preserved; this is not a claim of whole-environment byte identity.

The final repaired-source AFTER uses seed 2291 and the same TANSTACK_DB_ORACLE prefix, through the unchanged `pnpm gap-report` wrapper. Its run has 48 exact stable keys and preserves every one of 18 prior kills through at least one named law. Every classification remains unchanged: 18 killed, 17 crashed, 12 survived and 1 unreached. Crashes and unreached paths are not kills. The full census reused zero cached evidence units, computed 123 units, and reported no nondeterministic tests. Source freeze hashes matched through completion.

The [comparison JSON](2026-11-10-preact-schema-options-oracle-conversion.json) retains every stable key, old/new classification and law attribution, report hashes, dependency provenance, final source hashes and review controls. The final raw report remains in `.oracle-gaps-recovery/preact-schema-final-after/results.json` within the author worktree. The earlier draft AFTER also preserved outcomes, but it predates S1's repair and is not final-source evidence.

## Validation

```sh
pnpm --filter @tanstack/preact-db exec vitest run --maxWorkers=2 --coverage.enabled=false tests/window-render-oracle.test.tsx tests/bound-options-oracle.test.ts tests/bound-schema-options-oracle.test.ts
pnpm --filter @tanstack/react-db exec vitest run --maxWorkers=2 --coverage.enabled=false tests/bound-schema-options-oracle.test.tsx
pnpm exec tsc --noEmit --project packages/preact-db/tsconfig.json
pnpm --filter @tanstack/db exec vitest run --maxWorkers=2 --coverage.enabled=false tests/oracle-replay.test.ts -t 'named oracle replay manifest'
pnpm gap-report --package packages/preact-db --source src/useLiveQuery.ts --seed 2291 --contexts 1 --out .oracle-gaps-recovery/preact-schema-final-after
pnpm lint:changed
```

The suites passed 148 Preact, 216 unchanged React and 70 manifest checks. Full-project TypeScript, targeted ESLint and diff whitespace checks pass. Commands used `pnpm_config_verify_deps_before_run=false` for the linked local installation.

`pnpm lint:changed` reports only the earlier window conversion's removed generic preact.window-render budget key. Its twelve concrete properties each retain the same six-run budget, as the committed window evidence already explains. This schema conversion removes no generated run budget and introduces no oracle-rule report. The fake-indexeddb 6.2.8-to 6.2.7 local installation override and lockfile changes remain uncommitted.

From packages/preact-db, the direct finite command is:

```sh
env -u TANSTACK_DB_ORACLE_SEED -u TANSTACK_DB_ORACLE_PATH -u TANSTACK_DB_ORACLE_PROPERTY pnpm exec vitest run --maxWorkers=2 --coverage.enabled=false -t 'preact\.bound-schema-options > ' tests/bound-schema-options-oracle.test.ts
```

## Limits

Evidence retains the original finite synchronous-schema, scalar-row, explicit-string-key and settled-before-replacement boundary. It establishes neither typed-schema behavior nor async/invalid schemas, default getKey, mutations spanning replacement, initial Suspense, SSR, arbitrary concurrent rendering or real provider behavior. The census demonstrates preservation of the existing mutation sample; it does not close surviving, crashed or unreached mutants.
