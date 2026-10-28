# Convex integration with main's replay helpers

This record accompanies the merge of main `7e46f81adb3734ba77f209858ffdd8951731a937` into PR head `8be0438c3982fccf5b32a2f1945a359a9bc87c31`.

The two conflicts were in the shared offline test configuration and serializer test imports. Existing serializer properties keep main's registered property selectors. The new opt-in codec property keeps its separate fixed/random reach campaigns and direct `OFFLINE_CODEC_ORACLE_SEED`/`PATH` replay. It stands aside during another property's shared path replay.

No product law, reference model, generated history, production driver, or value comparison changed. Convex campaign budgets now call `oracleRuns`, as main's new lint rule requires. The codec budget uses the same multiplier. The campaign helper carries its validated shrink path as `counterexamplePath`, identifying the recorded history for the lint rule; direct replay still runs once.

## Validation

- All 64 adapter checks, 302 offline tests, and 18 isolated local backend tests passed.
- Both packages passed typecheck. Changed-file lint, targeted ESLint, the oracle run-count checker, and frozen offline lockfile installation passed.
- Seven campaign/reach helper tests passed, including missing random reach rejection and one-history direct replay.
- With `TANSTACK_DB_ORACLE_RUNS_MULTIPLIER=2`, ownership's fixed and random campaigns each reached all 15 declared states in 120 histories, compared with 60 at the default budget.
- Shared serializer replay with property `offline.serializer.mutation-wire`, seed `20260914`, path `0` passed. The fixed campaign and unrelated property campaigns stood aside.
- Direct codec replay with seed `20261022`, path `0` passed. Its reach record reported one replay history without campaign minima.

Commands use `pnpm --filter @tanstack/convex-db-collection test`, `test:e2e`, and `typecheck`; `pnpm --filter @tanstack/offline-transactions test --run` and `typecheck`; and `pnpm --filter @tanstack/db exec vitest run tests/oracle-campaign.test.ts tests/oracle-reach.test.ts`.

## Limits

This is test-runner integration, not a new behavioral repair or expanded product claim. Existing hostile-mutant and behavioral evidence remains in the October 26 review record. The codec and Convex properties retain their named direct replay interfaces; this merge does not claim they are registered in main's shared replay manifest. Backend evidence uses pinned application functions and isolated local backends, not cloud infrastructure. CI must be checked on the resulting merge commit before declaring readiness.
