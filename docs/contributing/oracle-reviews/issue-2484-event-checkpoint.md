# Persisted lifecycle event checkpoint

This record covers implementation commit `6891a4b31e8e4deed75a600785e5e0e795e423ef`, following
`d10c215d2203ac96c333e048f25911a089130327`. It records a test-driver repair;
no published production function changed.

## Finding and law

[Issue #2484](https://github.com/TanStack/db/issues/2484) records the
[collections-4 failure](https://github.com/TanStack/db/actions/runs/45887697998/job/140142436994).
The controlled PowerSync property failed at seed `239467`, path `22:7`, with
`previous=7`, `old=6`, `replacement=2`, `batchSize=2`, reload and default rendering.
Its difference was `afterEvent: replacement source authority` at `lifecycle`.
The aggregate Test job propagated that failure.

The exact replay, the complete fixed-seed generated unit, and a 96-history
campaign pass locally. Those passes do not refute the CI observation. A probe
through the same `observeBaselineLifecycle` and independent lifecycle judgment
reproduces its exact difference when an empty commit applies while event delivery
remains held. The public rows and durable rows still contain only the replacement.
PowerSync's `flushDiffRecordsWithContext` can commit an empty operation list.

PUB-3/FID-4 and the existing lifecycle `afterEvent` judgment require the source
batch's result after that batch applies. A backend write and an unrelated applied
receipt do not establish that cut. The repair records which sync transaction
writes the event's unique row, then awaits that transaction's applied receipt.
The row/lifecycle judgment, comparisons, and existing receiving paths stay intact.

## Scope and generated evidence

The new instrument receiver uses the existing independent lifecycle judgment.
Its controlled provider changes backend state, applies one to three empty source
transactions, and delivers the event after one to four task turns. The real
Collection and persistence wrapper perform application. Generated histories vary
saved, old and replacement memberships over three keys (masks 0..7).

The fixed regression reconstructs the CI memberships and reload, with one empty
commit and three delivery turns. The grammar rejects zero empty commits or zero
delivery turns for this required held-after-empty premise. Removing empty commits
removes the decoy receipt. Removing delayed delivery lets a wrong count-based
wait observe an event that already applied. Freezing memberships would omit empty,
overlapping and omitted-row replacements. These bounded samples are not exhaustive.

- **Law:** observe the event after its own applied receipt; authority above.
- **Reach:** `source-event-held-after-empty-commit` reaches five constructed and
  24 generated histories in each fixed and random campaign. Builders return fresh
  objects and preserve all generated memberships, commit counts and task turns.
- **RED:** on the original driver, seven of twelve registered instrument tests
  fail at `lifecycle`, with `afterEvent: replacement source authority`. This
  includes both generated campaigns, both constructions and the fixed regression.
  The two calibration failures have failing clean premises, not mutant kills.
- **GREEN:** all twelve instrument tests pass both gap baselines, without
  nondeterminism. The unchanged SDK receiving suites pass: PowerSync 116 tests,
  RxDB 132 tests, and Chromium OPFS 124 tests for both providers.
- **Mutants:** accepting an unrelated earlier receipt fails the lifecycle law.
  Losing the completed observation fails `event checkpoint execution`. The
  targeted report records two authored mutants, two kills and zero targeted gaps.
- **Other checks:** 70 replay-manifest checks, conformance TypeScript, ESLint,
  oracle lint, Prettier and run-budget checks pass. Dependencies were built before
  typecheck; an initial missing-built-types failure supplied no behavioral evidence.
- **Limits:** the new receiver judges the shared instrument's observation cut,
  not SDK implementation or internal work. The original CI log omits row values,
  so it does not reconstruct every SDK scheduling detail. Existing real receivers
  supply separate sampled integration evidence. This is not a full mutation audit.

A preliminary one-mutant sample reported an uncovered receipt-retirement premise
branch. That branch is outside this instrument's reload/event schedule; no broad
lifecycle-driver mutation closure is claimed. Another sample lost the final
observation and crashed the judgment. The model now rejects a missing completed
observation, and the authored version of that mutant is killed above. No product
function changed, and no existing product law or comparison was narrowed.

## Commands

The temporary config merged the package's `vite.config.ts` with:

```ts
{ test: { include: ['**/persisted-baseline-checkpoint-oracle.test.ts'],
  coverage: { enabled: false }, maxWorkers: 2 } }
```

From the repository root, using Node 22.13.1:

```sh
pnpm exec oracle-gaps --package packages/db-adapter-conformance \
  --source tests/persisted-baseline-lifecycle-driver.ts \
  --config vitest.checkpoint-investigation.config.mts \
  --seed 239467 --env-prefix TANSTACK_DB_ORACLE --contexts 1 \
  --mutants <authored-directory> \
  --only authored:unrelated-receipt-as-event,authored:lost-lifecycle-observation

pnpm --filter @tanstack/powersync-db-collection exec vitest run \
  tests/persisted-baseline-lifecycle-oracle.test.ts \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2
pnpm --filter @tanstack/rxdb-db-collection exec vitest run \
  tests/persisted-baseline-lifecycle-oracle.test.ts \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2
pnpm --filter @tanstack/browser-db-sqlite-persistence exec vitest run \
  --config vitest.adapter-oracles.config.ts \
  tests/persisted-baseline-lifecycle-oracle.test.ts \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2
pnpm exec tsc --noEmit -p packages/db-adapter-conformance/tsconfig.json
pnpm lint:changed
node scripts/check-oracle-run-counts.mjs
```

The authored JSON files name source `tests/persisted-baseline-lifecycle-driver.ts`:

| ID | Find | Replace |
| --- | --- | --- |
| `unrelated-receipt-as-event` | `await untilStartup(() => eventReceipt !== undefined)` | `await untilStartup(() => replacementReceipts.length > 0)` |
| `lost-lifecycle-observation` | `return observation` | `return undefined` |

For RED, retain the new instrument but restore the original driver's receipt-count
wait and run the first command with `--sample 1` instead of authored flags.
Temporary configs and probes are not part of the branch. The first gap command
used a config include that discovered no oracle file; it was a setup refusal,
then corrected to the glob above before any RED claim.

## Rubric audit

| Requirement | Evidence or limit |
| --- | --- |
| ORC-001 | Existing PUB-3/FID-4 and lifecycle authority; instrument-only scope. |
| ORC-002 | Reuses the primary independent row/lifecycle judgment, not adapter logic. |
| ORC-003 | Contract, controlled schedule, shared model, real receiving paths and comparison cut are explained beside the code. |
| ORC-004 | Reconstruction, axis ablation, bounded ranges and excluded non-premise forms are above. |
| ORC-005 | Real Collection/persistence apply controlled writes; original SDK and Chromium paths also pass. |
| ORC-006 | Two bound calibrations and two executed authored kills; assertion failures distinguished from setup and crashed judgments. |
| ORC-007 | Same 24-history fixed/fresh campaigns; original seed/path replay executed, with its passing result stated honestly. |
| ORC-008 | No reference-model state changed. |
| ORC-009 | The instrument and production driver are distinct from the sync adapter; source event delivery differs from backend commit. |
| ORC-010 | Driver cleanup remains intact; controlled delivery task is awaited and the real host is closed. |
| ORC-011 | No new second-formulation claim or concrete shared semantic fault identified; shared judgment is deliberate. |
| ORC-012 | Exact implementation anchor, evidence and unresolved scope are recorded here. This is a self-review. |
| ORC-013 | Held event plus unrelated commits distinguishes an event-specific receipt from a count-based wait. |
| ORC-014 | Existing PowerSync/RxDB Node and real Chromium OPFS receivers pass through the same driver and judgment. |
| ORC-015 | Declared/constructed state, measured five-plus-24 reach, and a bound missing-state calibration. |
| ORC-016 | The instrument registers only through oracleProperty; its fixed regression and calibrations use the same driver/model/check. |
