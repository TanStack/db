# Network-first startup durability across eager adapters

Reviewed oracle head: `3fe76d1484ae17e0fd28f2a35055b1b339cfbe95`. Production is unchanged from
`9c5d7b02a2055d45ede611e23498f3db96146726` throughout this extension. The
following evidence concerns new history and observation coverage, not another
production repair. Review method: self-review against the oracle rubric.

## Law and ownership

The SQLite guide's [Render after SQLite restore](../../guides/sqlite-persistence.md#render-after-sqlite-restore)
promises that network-first may release readiness from nonempty saved rows,
while network sync continues and its later changes apply. The glossary and
persisted-readiness oracle supply the same law. The shared eager-source
READY-3/PUB-7 law still requires complete-result replacement and persistence's
durable acceptance contract still applies. Enabling initial rendering changes
readiness, not the source's ownership or durable result.

The readiness oracle already covers restore/deadline/remote-call ordering, but
its controlled persistence adapter discards writes. The shared startup owner
previously checked durable results on six adapters without enabling this option.
This extension closes that crossing in the existing owner. It introduces no
second lifecycle model and changes no production code.

## Grammar, checkpoints, and independent judgment

The existing three-key set model remains. Histories add network-first enabled
or omitted, and a held response after deadline. Enabled ordinary responses use
`networkTimeoutMs: 60_000`; fallback uses the documented immediate-render value
`0`, while source delivery remains explicitly held. Exact deadline threshold,
empty/failed restore, and remote-failure readiness remain with the readiness
owner. A fallback without the option is excluded by construction. Query's
initial/cache results remain before restore and cannot generate a late fallback.

All previous fixed histories remain. Query now has 20; each other adapter has
12. All use the same model, driver and comparison on both Node hosts and OPFS.
The fixed and random campaigns retain 80 histories each per adapter/host,
1,920 generated histories total, with separate enforced reach in every campaign.

Before source delivery in a fallback history, public and durable rows must equal
the original saved rows, including Query ownership. A source result that omits a
row or changes an overlap distinguishes saved state from source replacement.
An empty source result must remove old rows except for surviving peer support.
The new option and timing axes distinguish immediate fallback from waiting for
the source; removing either loses this integration case. The original membership,
response/restore, peer, and cache-origin axes retain their prior roles and bounds.

After fallback, `preload()` cannot identify source completion. A recorder wraps
the adapter's public sync callbacks before persistence. It forwards all arguments
and returns each original commit receipt. The source's first `markReady()` plus
its applied receipts identify the first complete result. The recorder supplies
no writes and never calls readiness independently. Other histories keep the
original immediate post-preload comparison, so this does not defer that cut.

The first source result is checked publicly and durably before refresh. Refresh
fulfillment, later durable state, and a local-only reopen retain their comparisons.
The startup work check still permits one full row read. It subtracts only the
observer's own explicit durable reads, including the new fallback read.

## Measured generated reach

Minimum required count is one per declared state per adapter, host and campaign.
These counts come from the final normal runs, not the fixed histories or mutants.
The existing response order, empty-result, overlap, omission, peer and origin
states also pass their enforced reach checks.

| Adapter | Host | Campaign | Enabled source before deadline | Enabled fallback before source |
| --- | --- | --- | ---: | ---: |
| query | controlled | fixed | 24 | 7 |
| query | controlled | random | 35 | 8 |
| query | node-sqlite | fixed | 24 | 7 |
| query | node-sqlite | random | 24 | 11 |
| convex | controlled | fixed | 23 | 21 |
| convex | controlled | random | 25 | 27 |
| convex | node-sqlite | fixed | 23 | 21 |
| convex | node-sqlite | random | 23 | 16 |
| electric | controlled | fixed | 23 | 21 |
| electric | controlled | random | 28 | 17 |
| electric | node-sqlite | fixed | 23 | 21 |
| electric | node-sqlite | random | 17 | 22 |
| trailbase | controlled | fixed | 23 | 21 |
| trailbase | controlled | random | 20 | 15 |
| trailbase | node-sqlite | fixed | 23 | 21 |
| trailbase | node-sqlite | random | 18 | 22 |
| rxdb | controlled | fixed | 23 | 21 |
| rxdb | controlled | random | 13 | 24 |
| rxdb | node-sqlite | fixed | 23 | 21 |
| rxdb | node-sqlite | random | 20 | 23 |
| powersync | controlled | fixed | 23 | 21 |
| powersync | controlled | random | 25 | 15 |
| powersync | node-sqlite | fixed | 23 | 21 |
| powersync | node-sqlite | random | 21 | 28 |

## RED, GREEN, and mutant evidence

- **RED on unchanged production:** no new production mismatch. The expanded
  Node and OPFS comparisons pass without any production edit. The earlier
  production repair's RED results remain in the all-adapter evidence record.
- **GREEN:** 208 shared checks: 160 fixed histories, 24 generated campaign
  checks, and 24 calibrations. Real Chromium worker/OPFS receives all 80 fixed
  histories. All six adapters run on controlled and real Node SQLite hosts.
- **Neighboring readiness:** 404 runtime checks pass, including the unchanged
  390-history readiness oracle, with no type errors or unhandled errors.
- **Mutant:** for each adapter and Node host, a receiving-source wrapper drops
  `applyCommittedTx` after real seed/restore, while source rows still publish.
  All twelve executions fail the shared `startupDurable` comparison before a
  refresh. These are assertion failures, not timeouts or setup failures. The
  calibration requires that named checkpoint in the rejected error. Six new
  checker controls also reject lost fallback rows and stale source durability.
- **Replay:** Query seed `2367`, path `0` runs one generated comparison per host,
  with the 46 other registered checks skipped. The new grammar uses the same
  direct replay interface. This replay reaches an initial-disabled source,
  not fallback; normal campaigns supply fallback reach.
- **Static checks:** seven package typechecks, explicit ESLint, Prettier,
  `git diff --check`, and `pnpm lint:changed` pass. No run budget decreases.

The first Node-SQLite mutant attempt spread a class instance and omitted its
prototype methods. It failed adapter validation before comparison. Replacing
that fixture with a forwarding Proxy preserves bound methods, and the final
runs fail only at the intended durable comparison. This setup failure supplies
no mutant evidence. A missing ignored `jose@5.10.0` link in Convex's existing
auth-app fixture was restored locally before its successful typecheck.

## Rubric audit and limits

| Requirement | Outcome |
| --- | --- |
| ORC-001/002 | Public SQLite readiness and durable replacement laws. The model uses set replacement and unchanged saved state, with no production classifiers. |
| ORC-003/005/009 | Literate shared owner, named fallback versus source-result cuts, actual six-adapter receiving paths, exact rows/owners and durable storage. Applied receipts disambiguate source completion from earlier fallback readiness. |
| ORC-004/008 | Prior witnesses reconstruct. New render/timing axes have distinguishing outcomes. Saved-state and complete-result checkpoints need different predictions, without another state machine. Bounds and illegal fallback/cache schedules are explicit. |
| ORC-006/013 | Lost saved rows fail fallback. Dropped durable writes fail startupDurable after a valid fallback. Existing immediate post-preload cuts remain. Exact numeric threshold belongs to readiness, not this receiving witness. |
| ORC-007/010 | Same 80-history fixed/random campaigns and checked direct replay. Existing shared cleanup preserves primary comparison failures and secondary teardown diagnostics. |
| ORC-011 | No new shared-semantic fault requiring an independent second formulation was identified. This is not an exhaustive independence proof. |
| ORC-012/014/015/016 | This record ties evidence to the reviewed head. Both Node hosts and real OPFS receive the same held-source premise and judgment. Every generated campaign enforces both new reaches. Fixed histories and calibrations use shared models/checks, with no separate hand-written expected result. |

The extension retains eager startup, nonempty saved baselines, one persistence
instance, three string keys/numeric values, and no initial-fetch mutation.
It does not establish failed I/O, concurrent writers, every intermediate
publication, on-demand windows, arbitrary metadata, or real remote replication
for the local RxDB and PowerSync receiving paths. Exact deadline and failure
readiness remain under their existing owners. No additional production defect
was found, and no production work, setup, batching, format, or bundle size changes
were needed for this extension.

## Commands

All commands run at the worktree root. Local dependency recovery overrides remain
uncommitted as documented in the original all-adapter record.

```sh
pnpm --config.verifyDepsBeforeRun=false --filter @tanstack/query-db-collection exec vitest run --maxWorkers=2 --coverage.enabled=false tests/persisted-startup-conformance-oracle.test.ts
# Repeat for convex, electric, trailbase, rxdb and powersync with their
# persisted-startup-conformance-oracle.property.test.ts receiving file.
pnpm --config.verifyDepsBeforeRun=false --filter @tanstack/browser-db-sqlite-persistence exec playwright test --config playwright.opfs.config.ts persisted-startup-conformance-oracle.opfs.spec.ts
pnpm --config.verifyDepsBeforeRun=false --filter @tanstack/db-sqlite-persistence-core exec vitest run --maxWorkers=2 --coverage.enabled=false tests/persisted-readiness-oracle.test.ts tests/persisted-readiness.test.ts
env TANSTACK_DB_ORACLE_PROPERTY=query.startup-ownership TANSTACK_DB_ORACLE_SEED=2367 TANSTACK_DB_ORACLE_PATH=0 pnpm --config.verifyDepsBeforeRun=false --filter @tanstack/query-db-collection exec vitest run --maxWorkers=2 --coverage.enabled=false tests/persisted-startup-conformance-oracle.test.ts
pnpm --config.verifyDepsBeforeRun=false --filter @tanstack/db-adapter-conformance exec tsc --noEmit
# Also tsc --noEmit in each of the six receiving adapter packages.
pnpm --config.verifyDepsBeforeRun=false lint:changed
```
