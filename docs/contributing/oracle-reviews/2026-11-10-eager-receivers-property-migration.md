# Eager receiver registration migration

Source parent: `ec3fc367e4829cc49bc7a1e6a47bbaba906a66ae`. This record accompanies the receiver-registration
commit. It extends the earlier [reference/RxDB migration record](2026-11-10-eager-reference-rxdb-property-migration.md).

Electric, Convex, PowerSync, TrailBase, and the separately run vendored Neon
receiver now use `oracleProperty` and the same shared eager-source property
adapter as reference and RxDB. Five legacy-campaign exceptions are removed.
The independent product model, driver implementations, capabilities, fixed
regressions, and refinement comparison are unchanged.

The governing READY, HEALTH, PUB, FID, LIFE, EVID, RETRY, RECON, and RENEW laws
remain beside `packages/db-adapter-conformance/src/eager-live-source-oracle.ts`.
Their authority is the sync callback contract, glossary, and dated maintainer
decisions recorded there. The production driver still compares each supported
delivery, wait, failure, restart, and cleanup checkpoint through that judgment.

Every receiver retains seed 2118. TrailBase retains 600 histories per campaign;
Electric, Convex, PowerSync, and Neon retain 400. Their existing timeout values
stay. Five constructed histories per declared state supplement generated
histories through the already converted shared recipes. Actual production
entries supply reach; construction declarations do not count as observations.
Electric's no-on-error path and Convex's React and wrapped-client paths now have
named fixed/fresh campaigns and direct replay selectors. Their earlier fixed
campaigns are retained at the same seed and run budget.

The receiver Vitest configurations inline `@tanstack/oracles`, so registrations
use the active worker's Vitest API. Property IDs, manifest owners, and replay
patterns cover all receiver variants. The source test checks the finite Convex
client variants as well as literal variant IDs.

## Validation

The [companion result record](2026-11-10-eager-receivers-property-migration.json)
preserves every observed state count, commands, source hashes, and log hashes.
All runs use the normal package configuration, one worker, and coverage disabled.

| Check | Result |
| --- | --- |
| Convex, all three client variants | 9 passed; no type errors; 163.32 s |
| Electric, both error-handler variants | 6 runtime tests passed; command exit 1 from 23 source type/setup errors; 225.94 s |
| TrailBase | Setup failure before tests: missing `@tanstack/store`; 2.76 s |
| PowerSync | Setup failure before tests: missing `@powersync/node`; 0.432 s |
| Neon, separate baseline | 3 failed on existing READY-4/HEALTH-1 laws; 3.96 s |
| Replay manifest | 69 passed, 47 unrelated skipped; no type errors; 1.32 s |
| ESLint, `pnpm lint:changed`, `git diff --check` | clean |

Convex's six completed campaigns reached all 54 declared states for the normal
and React clients, and 52 for the wrapped client. Their minimum counts are
34, 36, 34, 37, 44, and 40. Electric's four completed campaigns also reached
every declared state; exact counts are in the companion record. These runs
establish the exercised receiving paths only.

Electric's source type/setup errors include missing package self-resolution,
`pg`, `@standard-schema/spec`, and `@tanstack/query-core`, followed by dependent
query-source type errors. TrailBase and PowerSync did not reach a comparison.
Canonical installation/build checks remain required centrally. No private
installation configuration or dependency override is committed.

Neon's fixed campaign rejects READY-4 (status); its fresh campaign rejects
HEALTH-1 (health error cause). Its additional determinism check rejects READY-4. These are the already
documented failure-channel baseline. No expectation is relaxed.

## Limits

This is a registration migration. No production behavior or product expectation
changes, and no new gap-closure or mutation-census claim is made. Existing model
and receiving-boundary limits remain in the coverage map and receiver prose.
The vendored Neon adapter remains outside the default conformance test command;
its documented READY-4/HEALTH-1 failure baseline is not repaired here. Controlled
provider checks do not establish arbitrary real-provider timing. PowerSync uses
its existing real local database receiving path, without a remote sync-service
claim. The earlier RxDB mutation pair remains scoped to its recorded source.
