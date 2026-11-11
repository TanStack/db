# Live-query registration migration

This record accompanies the API-only migration of the four top-level DB
live-query cache, preload-indexing, and deferred-acquisition owners. Its source
parent is `76fa851874e85b8de56dfcc69de33809281aadc0`; the verified source
commit is `01bb58a220ad9b2081b6c6be454d77b40381e64f`. Production and shared
semantic models are unchanged. The existing assertion adapter transports each
complete independent helper's judgment, retaining assertion identity, cause,
stack, runtime errors, and cleanup diagnostics.

## Preserved cases and campaigns

| Native property | Preserved language |
| --- | --- |
| `live-query.cache-option-admission` | All 4,320 finite declaration × held/settled × claimant × admission-path cases |
| `live-query.cache-claim-lifecycle` | All 2,160 finite declaration × claimant × phase × pending/replacement-schedule cases |
| `live-query.preload-indexing` | All 459 finite cold/valid-prior × nine declarations × identity cases |
| `live-query.deferred-sibling` | All 32 finite reader × row-count × root/sibling result × release-order cases |
| `live-query.start-handoff` | The original ready/fail/throw × before/during-release × Error/undefined arbitrary, 100 runs, fixed seed 2229 and an unseeded campaign |

All original checker calibrations remain. The broad deferred-acquisition,
pooled, and admission-cleanup matrices remain as the original shared-model
replays. The cache enumerations retain their per-route exhaustive reach gates
with actual-entry counters. Native observations record those same reached
states; they do not invent a second expected answer. The preload and sibling
per-history legacy reach gates become equivalent assertions inside their existing
helpers. Native enum registration adds its standard deterministic repetitions.

Index constructor references remain in the unchanged concrete fixture table.
Data histories carry a fixture index and readable constructor roles; `resolve`
retrieves the original fixture. No constructor function enters a data history
or observation.

The four finite properties are registered as `enumerated-campaign` manifest
entries, with direct Vitest commands and no seed/path promise. The handoff
property retains its original registry ID and seed/path interface. Four native
constructions, all inside its original language, require its six existing
states. No legacy exemption remains for these four files.

## Verification

- Four-owner Vitest run: **7,560 tests passed** with one worker.
- Explicit DB test TypeScript project: passed after removing an unused test import.
- ESLint for all changed source/metadata files: passed after import ordering fixes.
- Registry, literal-owner, cwd, and finite-case manifest checks: **4 tests passed**.
- Guarded handoff replay, seed 2229/path `0`: passed with `executions: 1`,
  witness `numRuns: 1`, and `failed: false`.
- AST comparison-call inventory: all 67 existing `expect` calls and all 17
  shared comparison-helper calls remain. Two added `expect` calls replace the
  equivalent preload and sibling per-history legacy reach gates. A second,
  token-level AST inventory confirms that each original matcher and shared
  comparison call retains its original arguments after unwrapping transport.
- `git diff --check`: passed.
- Full `pnpm lint:changed`: no oracle-rule diagnostic and no budget report for
  this batch. Its nonzero result contains only the same inherited reports for
  the hydration-subset ID split, Preact window-render, and OP-SQLite. The two
  hydration mode campaigns still each retain eight generated runs; this batch
  changes none of those budgets.

The owner command, from `packages/db`, is:

```sh
pnpm exec vitest run tests/live-query-cache-lifecycle-oracle.test.ts tests/live-query-cache-options-oracle.test.ts tests/live-query-preload-indexing-oracle.test.ts tests/live-query-deferred-acquisition-oracle.test.ts --maxWorkers=1 --coverage.enabled=false
```

All pnpm commands set `pnpm_config_verify_deps_before_run=false`. The handoff
replay uses the existing `tests/oracle-replay.ts` guard with the original
property, seed, and path variables. Finite owners use their manifest's direct
Vitest command.

## Evidence boundaries

- **Law:** the existing local declaration admission/lifetime, eager-index
  admission, deferred-demand, and sync-start error-origin contracts, with their
  original authorities retained beside their existing models.
- **Reach:** each finite route's existing required states passed its aggregate
  gate; both handoff campaigns reached all six original states, counted below.
- **RED:** no new production defect is claimed or repaired. This migration
  changes registration and judgment transport only.
- **GREEN:** 7,560 owner tests, explicit TypeScript, lint, four manifest checks,
  and the guarded handoff replay pass as above.
- **Mutant:** all original checker calibrations remain and pass. No new mutation
  campaign, mutation-preservation result, gap closure, or product coverage is claimed.
- **Limits:** the original finite bounds, source schedules, transport, provider,
  framework, and schema-transform limits remain unchanged.

## Handoff campaign reach

| Existing state | fixed seed 2229 | random campaign |
| --- | ---: | ---: |
| failed | 33 | 27 |
| healthy | 30 | 26 |
| own-throw | 22 | 26 |
| prior-crash | 19 | 25 |
| prior-error | 22 | 23 |
| undefined-cause | 53 | 56 |
