# TrailBase browser oracle-property integration

Reviewed base: `0e86c1fda`. This is the author's integration record. TrailBase
production remains unchanged; the new files convert and receive existing laws.
An immutable audit also captured snapshot `c4c00b2`. Subsequent cleanup in
this integration changed import ordering and erased TypeScript fixture annotations only.
No production guard, row law, comparison checkpoint, or run budget changed.

## Law, ownership, and receiving paths

Cleanup retires a sync run's authority. Late old list or persisted-hydration
work cannot change a cleaned-up Collection or a replacement's public/durable
rows, reader, readiness, or errors. A complete eager result replaces saved rows.
Authorities remain TrailBase's [lifecycle contract](../../../packages/trailbase-db-collection/tests/ORACLE.md),
the glossary's cleanup/sync-run terms, the shared complete eager-result law,
and the SQLite guide's "Render after SQLite restore" readiness contract.
The shared eager-source judgment separately owns field fidelity, publication,
initial readiness, health, restart and resource-release laws.

The [hydration suite](../../../packages/trailbase-db-collection/tests/lifecycle-hydration-oracle-suite.ts)
retains the independent row-set model and shared three-cut comparison. Controlled
storage, real Node SQLite, and real Chromium WASQLite/OPFS call the same
production driver. The [eager suite](../../../packages/trailbase-db-collection/tests/eager-live-source-oracle-suite.ts)
uses the original shared model/check at every original checkpoint; its plain
RecordApi supplies the same native stream in Node and Chromium. Expected rows
never come from production commit counts or classifiers.

Nine hydration builders return fresh randomized histories and retain their
required states in a WeakMap. Five eager builders each require all 23 states,
preserving minimum-five reach. Both seeded constructions and objects produced
by the generated arbitrary are checked. The primary lifecycle/page conversion
retains 50/40 runs and seeds 714203/205917. Its boundary grammar is enumerated:
all 51 original histories (16 early demand, 28 one-page races, 4 held pages, 2 stream
endings, 1 fresh run); it has no random campaign or shrink path.

## Normal command results

From `packages/browser-db-sqlite-persistence`:

```sh
pnpm --config.verifyDepsBeforeRun=false test:oracles:adapters-browser \
  tests/trailbase-hydration-oracle.test.ts \
  tests/trailbase-eager-live-source-oracle.test.ts \
  tests/trailbase-browser-fidelity.test.ts --maxWorkers=1
```

**159/159 checks GREEN** across 3 files in 358.01 seconds: 119 eager, 37 hydration, and 3 recorder
controls. Eager runs 600 fixed seed 2118 plus 600 fresh; hydration runs 50 fixed
seed 728159 plus 50 fresh, its 24 fixed histories, calibrations and determinism.
Counts below include the framework's seed-derived constructions as well as
its generated runs; literal fixed histories do not discharge required reach.

From `packages/trailbase-db-collection`:

```sh
pnpm --config.verifyDepsBeforeRun=false test:oracles \
  --coverage.enabled=false --maxWorkers=1
```

**410/410 checks GREEN**, 3 files, 112.12 seconds, zero type errors. This includes the full
primary lifecycle/page/finite-boundary suite, both persisted-hydration hosts,
the 600-run eager campaigns, and shared persisted-startup receiving paths.
The first integration attempt failed setup on bare scratch import aliases in
the primary lifecycle file; correcting them to relative imports repaired setup.
That failed attempt is not credited as product evidence.

### Persisted hydration reach

| Declared state | Controlled fixed | Controlled fresh | Node SQLite fixed | Node SQLite fresh | Chromium fixed | Chromium fresh |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| empty-replacement | 14 | 16 | 14 | 8 | 14 | 7 |
| hydration-held-cleanup | 34 | 31 | 34 | 27 | 34 | 30 |
| late-list-rejection | 25 | 28 | 25 | 32 | 25 | 29 |
| new-row-outside-old-list | 18 | 20 | 18 | 20 | 18 | 18 |
| nonempty-replacement | 45 | 43 | 45 | 51 | 45 | 52 |
| old-row-omitted | 23 | 15 | 23 | 14 | 23 | 17 |
| resume-cleaned-up | 23 | 13 | 23 | 23 | 23 | 19 |
| resume-replacement-loading | 16 | 25 | 16 | 21 | 16 | 19 |
| resume-replacement-ready | 20 | 21 | 20 | 15 | 20 | 21 |

### Shared eager-source reach

| Declared state | Node fixed | Node fresh | Chromium fixed | Chromium fresh |
| --- | ---: | ---: | ---: | ---: |
| change-batch | 412 | 433 | 412 | 415 |
| failure-after-ready | 377 | 405 | 377 | 372 |
| failure-before-ready | 380 | 393 | 380 | 394 |
| field-removed | 301 | 322 | 301 | 308 |
| first-ready | 456 | 488 | 456 | 449 |
| malformed-before-ready | 350 | 360 | 350 | 364 |
| multi-change-batch | 356 | 375 | 356 | 358 |
| restart | 413 | 424 | 413 | 400 |
| restart-after-failure | 339 | 354 | 339 | 336 |
| value:array:change | 320 | 339 | 320 | 326 |
| value:array:load | 337 | 376 | 337 | 338 |
| value:boolean:change | 323 | 337 | 323 | 324 |
| value:boolean:load | 336 | 363 | 336 | 343 |
| value:float:change | 314 | 336 | 314 | 316 |
| value:float:load | 325 | 347 | 325 | 344 |
| value:integer:change | 321 | 338 | 321 | 323 |
| value:integer:load | 340 | 364 | 340 | 349 |
| value:null:change | 316 | 347 | 316 | 328 |
| value:null:load | 338 | 372 | 338 | 338 |
| value:object:change | 313 | 337 | 313 | 319 |
| value:object:load | 339 | 370 | 339 | 335 |
| value:string:change | 319 | 342 | 319 | 321 |
| value:string:load | 344 | 365 | 344 | 338 |

### Primary lifecycle and page reach

| Declared state | Fixed | Fresh |
| --- | ---: | ---: |
| cleanup-during-list | 30 | 28 |
| cleanup-during-subscribe | 32 | 28 |
| list-rejected | 14 | 20 |
| metadata-absent | 42 | 46 |
| metadata-present | 21 | 17 |
| replacement-before-retired-delivery | 13 | 11 |
| stream-buffered-close | 9 | 6 |
| stream-cleanup | 8 | 12 |
| stream-close | 17 | 7 |
| stream-immediate-cleanup | 18 | 9 |
| stream-parse-error | 5 | 6 |
| stream-read-error | 8 | 11 |
| subscribe-rejected | 15 | 13 |

| Declared state | Fixed | Fresh |
| --- | ---: | ---: |
| cursor-paging | 25 | 31 |
| delete-first-page-in-flight | 6 | 6 |
| event-in-transit-across-page | 10 | 12 |
| insert-new-key | 6 | 6 |
| offset-paging | 22 | 16 |
| overlapping-loads | 17 | 26 |
| update-between-pages | 10 | 9 |

## Browser failure fidelity

The generic [Chromium host](../../../packages/browser-db-sqlite-persistence/tests/adapter-chromium-host.ts)
starts Vite on a random local port and launches real Chromium (local Chrome,
CI's installed Chromium, or the existing PLAYWRIGHT_CHANNEL override). Its
page uses actual WASQLite workers/OPFS and closes/removes artifacts per history.
It supplies cross-origin-isolation headers and a single Query SDK alias for the
shared Query receivers. No browser premise is simulated.

The receiver preserves the full raw product result. Shared judgments report a
product mismatch under its original law/checkpoint and retain browser errors
as secondary diagnostics. Only an otherwise clean product result emits
`detached-browser-error` at checkpoint `browser`. An append-only error recorder
with a consumed cursor checks each diagnostic once, including errors arriving
between histories. Attribution is by arrival, not a hidden source sync run.
Errors during host startup reject acquisition and preserve their cause through
cleanup.

The ordinary [recorder controls](../../../packages/browser-db-sqlite-persistence/tests/trailbase-browser-fidelity.test.ts)
use the same shared checks. For both receiving paths they combine a product
mismatch with a real page error, check a clean result plus a page error, deliver
another error between histories, then require the following clean history to
pass. A real bootstrap page error separately rejects host acquisition. These
3 controls pass in the 159-check run. After import/type-only cleanup, the normal
command restricted to this control file passes 3/3 again in 4.71 seconds.

## Generated-only reach RED and replay

A scratch recorder transform suppresses the required reach label only for a
constructed output unequal to every seed-derived construction at seed 728159.
Seeded constructions are explicitly exempt. Production rows, the raw final
observation, the independent model and the comparison stay unchanged. Thus the
failure exercises the local WeakMap obligation on the generated branch rather
than the framework's seeded-construction map.

The fixed campaign shrinks to seed 728159, path `9:0:0:0`, with an empty
saved/old/replacement set, completed old list, default rendering, and resume at
cleaned-up. It fails at `reach`, law `constructed builder reach`, difference
`generated construction omitted hydration-held-cleanup`.

The durable named owner's guarded replay also reproduces that exact RED using
an immutable external Vitest transform. The replay witness records one
execution with `failed:true`. The identical clean guarded replay passes with
one execution and `failed:false`. Commands from the repository root:

```sh
TANSTACK_DB_ORACLE_SEED=728159 \
TANSTACK_DB_ORACLE_PATH=9:0:0:0 \
TANSTACK_DB_ORACLE_PROPERTY=trailbase.lifecycle.persisted-hydration.controlled \
pnpm --config.verifyDepsBeforeRun=false exec node --import tsx \
  packages/db/tests/oracle-replay.ts \
  --config /private/tmp/pr2394-trailbase-integration-evidence/guarded-missing-state.config.ts \
  packages/trailbase-db-collection/tests/lifecycle-oracle.property.test.ts
```

Remove only the `--config` argument for the clean guarded replay. This is a
calibration of generated reach enforcement; it is not a kill of M151. The
permanent suite also rejects all 9 individual hydration state omissions and lost
replacement rows. The eager conversion separately records its generated-only
RED/clean replay and 115 builder/state omission controls.

The durable Chromium owner also passes the same seed/path through guarded
replay: one completed execution, `numRuns:1`, `failed:false`, 4.30 seconds.
From `packages/browser-db-sqlite-persistence`:

```sh
TANSTACK_DB_ORACLE_SEED=728159 \
TANSTACK_DB_ORACLE_PATH=9:0:0:0 \
TANSTACK_DB_ORACLE_PROPERTY=trailbase.lifecycle.persisted-hydration.chromium-opfs \
pnpm --config.verifyDepsBeforeRun=false exec node --import tsx \
  ../db/tests/oracle-replay.ts --config vitest.adapter-oracles.config.ts \
  tests/trailbase-hydration-oracle.test.ts
```

The sandboxed attempt could not bind the temporary localhost server (`EPERM`)
and recorded no execution. The permitted unsandboxed run above is the credited
result. It verifies browser replay routing; the reach-mutant RED above uses the
controlled storage owner.

## Integration checks and retained witnesses

Browser package `tsc --noEmit` passes after the final cleanup. Scoped ESLint
passes for all owned TS/config files. `vitest list --config vite.config.ts
--filesOnly` excludes all 3 Chromium files from both default runtime and Vitest
typecheck discovery while retaining ordinary tests. Package TypeScript still
includes these files. The dedicated config and browser CI step execute them
with an installed browser; both browser owners have compatible replay config
mappings. These are receiving-path routing changes, not disabled comparisons.

The final branch-wide `pnpm --config.verifyDepsBeforeRun=false lint:changed`
run exits 1. It reports stale `legacyCampaigns` entries for the converted Query
ownership, TrailBase lifecycle, and TrailBase eager files. It also reports the
TrailBase eager property budget as removed (previously 600): the scanner does
not resolve its new registration helper. The helper still registers 600 fixed
and 600 fresh histories, as the normal Node and Chromium runs above demonstrate.
No run budget was reduced. Central legacy-entry cleanup and this scanner report
remain integration work; scoped ESLint passing does not imply branch-wide lint
passes. The exact output is in `lint-changed-final.log`.

All old Playwright spec/page/HTML files remain. The new hydration receiver
supersedes only the branch of 24 TrailBase histories in the broader eager-gap portfolio of 226 histories;
it does not replace its Query precedence/scoped/cached-claim or RxDB/PowerSync
reload receivers. The persisted-startup portfolio, including 103 Query histories,
other adapters, fallback/capabilities and repeated same-origin startup, also
remains. No broad Playwright file can retire on this narrower evidence.

## Remaining M151 gap and work distinction

The post-`hydrateBaseline()` cancellation return in `trailBaseCollectionOptions`
remains intact. Deleting it produced no public/durable mismatch in the bounded
persisted composition, because retired callback authority is fenced downstream.
That is not dead execution: deletion continues through accepted synced entries.
For N applied rows and P projected keys the walk costs O(N+P); G omitted keys
allocate an O(G) array and cause one old begin, G write attempts and a commit.
The guard avoids that CPU and temporary memory work when an old continuation resumes
against a large replacement.

Recommendation: retain this useful cancellation optimization. No promise that cleanup stops all internal work was invented to force a kill. Under current policy the anchored
M151 gap remains **open pending an oracle kill or explicit maintainer allowance**.
The bounded public equivalence result and this report do not close it.

## Limits and artifacts

RecordApi behavior and decoded events remain controlled; no deployed TrailBase
service or SDK fetch/SSE wire claim is made. Hydration uses three string keys
and numeric values, one retired/replacement run, three resume cuts, and default
versus network-first rendering before its 60-second deadline. Shared startup
coverage separately owns network fallback. No arbitrary concurrent mutation,
I/O failure, unbounded row count or every intermediate publication is proved.

Scratch logs, immutable controls, replay delta and preserved conversion drafts
moved from the checkout to `/private/tmp/pr2394-trailbase-integration-evidence`.
Relevant logs: `durable-browser.log`, `durable-node-oracles-final.log`,
`durable-fidelity-final.log`, `durable-types-final.log`, `durable-lint-final.log`,
`default-discovery-final.log`, `durable-guarded-generated-red.log`, and
`durable-guarded-generated-clean.log`, `durable-guarded-chromium-clean.log`, plus
`lint-changed-final.log`. They are local supporting artifacts;
this versioned record retains the verdict-critical results and limits.

## Integration amendment: tracked budgets and separate browser job

After the normal campaigns above, the registration helper now accepts
`{ property, defaultRuns: 600 }` from each receiving wrapper. The helper uses
that count for the same property and both campaigns. This makes the existing
600-run property budget visible to the static scanner. No history, model,
comparison, calibration, identifier, or run count changed.

`node scripts/check-oracle-run-counts.mjs` and `pnpm lint:changed` now pass
without the earlier removed-budget report. The new Chromium receivers run in
a separate `adapter-browser` E2E matrix group with its own Chromium installation.
The existing browser group keeps its 35-minute timeout and existing campaigns.
The aggregate E2E check requires the new group to succeed too.
