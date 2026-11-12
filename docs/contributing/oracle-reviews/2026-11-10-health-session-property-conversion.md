# Source-health, metadata session and SSR stream registration migration

Source heads: `a15c153e4` (SSR stream) and `b56442c92` (source health and metadata session). The shared assertion adapter's `rejectAt` is supplied by `49cd9856f` and is not duplicated here.

This is an API-only campaign migration. Existing laws, models, production drivers, comparisons, action languages, fixed histories and observation checkpoints remain. There are no production changes or new closure claims. Authored assertions and explicit session mismatch errors retain their original objects, messages, causes and stacks through the shared native judgment adapter. Runtime and cleanup failures remain driver failures.

## Campaigns and reach

| Property | Preserved base budgets and seeds | Preserved reach enforcement |
| --- | --- | --- |
| `ssr.stream-record-lifetime` | Fixed seed 2229 and random, 100 each | Eleven existing states; four legal native constructions reach them. Pending+cleanup stays excluded. |
| `source-health.history` | 60 random histories | Same 26 measured states and shared aggregate gate. |
| `source-health.required-history` | Fixed seed 20261029 and random, six suffixes each | Every existing prefix still runs against each suffix, in the same join/nested contexts; each campaign retains its aggregate minimum of one. |
| `source-health.on-demand` | 60 random histories plus the existing examples | Same seven states, aggregate minimum one and fixed-example coverage gate. |
| `source-health.lazy-demand` | 100 random histories plus the existing examples | Same 21 states, aggregate minimum one and fixed-example coverage gate. |
| `source-health.request-errors` | 100 random histories | Same independent failure-list comparison. |
| Six `sync-metadata-session` main campaigns | Fixed seeds 2220001–2220006; fixed 100 except seeds=150 and nested-conflicts=450; random 100 each | All 28 grammar/state obligations retain their fixed-campaign minimums of eleven or five. |
| Session hold invariance, key independence and seed order | 50 fixed and 50 random per existing receiving grammar; fixed seed offsets +100/+200 unchanged | Same independent paired formulations. |

The source-health examples still execute before each normal generated campaign, through the same helpers, with the same option values. Scoped `beforeEach` hooks preserve their schedule without changing the generated arbitrary's distribution. Path replay omits those examples and runs its selected generated history once. Explicit aggregate counters count each state once per constituent history; native `measured` observations retain the original state names. The required structural campaign still counts each prefix as its own history at the aggregate gate, while native reporting counts the enclosing suffix batch.

The pinned runtime reads `histories.runs` at campaign execution. A scoped metadata `beforeEach` selects the original fixed budget of 150 or 450 where applicable, leaving the random budget at 100. This does not add or widen a campaign. Fixed examples and the native determinism check do not supply metadata's fixed-campaign reach minimums.

[Recorded reach counts](2026-11-10-health-session-property-reach.json) contain every state from the successful normal runs, including source-health aggregate counts that include its examples. SSR reached every state at least 24 times in its fixed campaign and 23 times in its random campaign. Required structural batches reached every state in all six fixed and all six random suffixes. All original aggregate gates passed.

## Validation

From `packages/db`, with `pnpm_config_verify_deps_before_run=false`:

- `pnpm exec vitest run tests/ssr-stream-record-wait-oracle.test.ts --maxWorkers=1 --coverage.enabled=false`: 3 passed.
- The same command for `source-health-oracle.test.ts`: 511 passed.
- The same command for `sync-metadata-session-oracle.property.test.ts`: 91 passed.
- `pnpm exec tsc --noEmit -p tsconfig.test.json`: passed after the final edits.
- Four focused manifest/owner/replay checks in `oracle-replay.test.ts`: passed.

Guarded path-0 replays passed for all five source-health IDs, SSR stream lifetime, and metadata seeds, nested-conflicts, flat hold invariance, flat key independence and seeds seed order. Every guard reported exactly one execution, one history and `failed:false`.

An AST audit compared the original head `63e685bcb` with the migrated source, removing only assertion markers and TypeScript non-null assertions. It preserved all 87 source-health, 52 session and 19 SSR distinct comparison expressions, including the same matcher/helper arguments. All 79 pre-existing semantic function bodies remain structurally identical after marker removal; only the obsolete session registration reach helper was retired. The request-error callback became a named helper without changing its body.

Scoped ESLint has zero errors. Its two existing source-health `no-shadow` warnings concern the model's local `query` and the driver's local `sourceNode`. `git diff --check` passes. `pnpm lint:changed` completes with only the same three inherited budget reports: the old hydration-subset-handoff ID (split into two preserved eight-run campaigns), the old Preact window-render ID (six), and OP-SQLite fixed seed 165903 (twenty). These reports are outside this source batch; this batch adds none.

## Evidence limits

The authoritative models and coverage limits remain in the owners and their directly named shared modules. No new RED or mutant campaign was run: the task preserves existing coverage while changing campaign registration. The successful runs establish registration, existing judgment execution, retained reach gates and direct replay at the listed seeds and paths. They do not establish new product behavior or expand any owner's contract.
