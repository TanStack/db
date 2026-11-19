# Query startup receiving gaps

This evidence concerns PR #2394's Query startup and direct-write receiving
extensions. It does not establish whole-PR readiness. The source under test is
`packages/query-db-collection/src/query.ts`, SHA256
`1a794774e60d3c1dbacd515d0350b048557714adf80d6e3b9d42e7250841754b`.
The before-repair source was
`6bbf1542e6daa38f33315445c5bb0ae3fbbf90d907cd388cb5d13f41c3b37cc5`.

## Laws and ownership

The primary owner is
`packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts`.
The receiving extensions reuse its independent
`mergeDirectWritesOverFetch` model for values. They add a small metadata
projection and a synchronous creation checkpoint; they do not copy Query's
fetch generations, retained-baseline classifier or observer state machine.

- **Direct-write ordering:** a complete physical fetch that starts after an
  accepted direct write replaces that row's earlier value. A result from an
  earlier fetch preserves the accepted write. Authority: the Query guide's
  **Direct Writes and Query Sync** and the primary direct-order law.
- **Direct-row ownership:** a new direct insert infers no subset owner. An
  update or upsert of an already-owned row preserves its established owners.
  A later complete physical fetch can claim or remove the row. Authority:
  the same guide section and the primary direct-row-lifetime law, which
  preserves public values and persisted owners through direct writes.
- **Immediate materialization:** fresh nonpersisted eager `initialData` and
  exact-key cached data materialize rows and readiness when synchronous
  `createCollection({startSync:true})` returns. Existing cached data suppresses
  the initializer; a disabled fresh Query starts no request. Authority: the
  guide's **Initial Data** section and the existing cached-query immediate-read
  receiver in `query.test.ts`.

`query.persisted-direct-ownership` owns the controlled and real Node SQLite
receivers. `query.persisted-direct-ownership.chromium-opfs` executes the same
model, grammar and comparison in real Chromium with worker SQLite/OPFS.
`query.immediate-eager-materialization` and its `.chromium-opfs` receiver
share the immediate-materialization judgment. Each receiving path constructs
its own histories and reach-obligation ledger. The registry and replay
manifest name all four executing owners separately.

## Histories and observations

The direct grammar crosses raw/derived responses, retained/unretained saved
baselines, direct writes before fetch or after fetch starts, legal insert/upsert,
returned/omitted source keys, distinct/overlapping saved and direct keys, and
independent numeric saved/direct/source values. Overlap uses upsert because
inserting an existing key is illegal. A dedicated construction forces a
retained distinct saved baseline, an earlier direct write, a returned direct
key and differing values. Another forces saved/direct overlap where the
fetched value equals the saved value after an intervening direct upsert.
The 13 declared states have 12 constructors. Each campaign runs 40 generated
histories plus its required constructions. The 96 fixed input fixtures replay
the same model, production driver and comparison; they are not claimed to be
96 behaviorally distinct cases. `keepsSaved` is irrelevant when the saved and
direct keys overlap.

The production driver uses a real QueryClient, accepted direct writes, an
explicit source-response gate and applied source commit receipts. At `first`
and `firstDurable`, it compares public rows and persisted rows including exact
source-owner metadata. It waits for the public refetch fulfillment when that
operation exists. The after-cleanup durable scan is diagnostic, not a stronger
cleanup or publication promise.

The immediate grammar crosses initialData/cache, raw/derived documents,
literal/function initialization and empty/nonempty unique numeric rows.
Its eight states have eight constructors; each campaign runs 40 generated
histories plus required constructions, with 16 additional fixed inputs.
The driver copies rows, readiness, source-call count and initializer-call count
at `creation-return`, before its first await.

Both judgments compare available product prefixes before requiring completion.
Empty or truncated normal returns fail at the unrecorded `completed`
checkpoint. The framework preserves an original driver error when that missing
checkpoint was never recorded, and preserves an observed product mismatch
before later cleanup failure. Detached browser diagnostics remain secondary
to a product or required-reach mismatch. A transported cleanup error retains
both its original diagnostics and detached page errors.

## RED before the production repair

Before source changes, the shared direct property failed on controlled
persistence, real Node SQLite and actual Chromium/OPFS. Seed `563`, path
`15:0:0:0:0:0` reaches a retained distinct saved baseline, an accepted direct
insert `x=0`, and a later physical response `x=1`. Query cache holds `x=1` and
the source's applied receipt completes, but public and durable rows remain
`x=0`. The comparison rejects `first` / `direct row value`.

The missing distinction was a same-run direct key absent from the retained
persisted baseline. The first source result added that key to its prior-owned
set, but its diff had no old value and skipped the update. The repair reads
accepted rows when the persisted entry is absent:

```ts
const oldItem =
  persistedBaseline?.get(key)?.value ?? currentSyncedItems.get(key)
```

The saved/direct overlap and equal-to-saved returned value remain generated
neighbors. Their receiving controls passed before the repair, so their model
was not weakened to match the new output.

## GREEN and reach

The normal Node package configuration, including its typecheck collector,
passed **279 tests in four reported files**, with no type errors (19.70s).
The command selected the three new runtime receiver/control files; the extra
reported file is the ordinary control file's typecheck collector.

```sh
pnpm_config_verify_deps_before_run=false pnpm --filter @tanstack/query-db-collection exec vitest run --coverage.enabled=false \
  tests/persisted-direct-ownership-oracle.test.ts \
  tests/immediate-eager-materialization-oracle.test.ts \
  tests/query-receiving-fidelity.test.ts
```

The complete normal Chromium suite passed **153 tests in two files**
(395.33s), including all fixed inputs, fixed/fresh generated campaigns,
checker calibrations and determinism controls.

```sh
pnpm_config_verify_deps_before_run=false pnpm --filter @tanstack/browser-db-sqlite-persistence exec vitest run --config vitest.adapter-oracles.config.ts \
  e2e/query-persisted-direct-ownership-oracle.browser.test.ts \
  e2e/query-immediate-cache-oracle.browser.test.ts
```

Each direct column is one receiving path and one complete generated campaign.
Fixed seed is `563`; fresh campaigns use the seed recorded by the runner.

| Declared state | Controlled fixed/fresh | Node SQLite fixed/fresh | Chromium fixed/fresh |
| --- | ---: | ---: | ---: |
| raw | 26 / 30 | 26 / 30 | 26 / 26 |
| derived | 26 / 22 | 26 / 22 | 26 / 26 |
| retained | 25 / 21 | 25 / 28 | 25 / 30 |
| no-retention | 27 / 31 | 27 / 24 | 27 / 22 |
| before-fetch | 32 / 24 | 32 / 26 | 32 / 27 |
| after-fetch-start | 20 / 28 | 20 / 26 | 20 / 25 |
| source-includes-direct | 31 / 29 | 31 / 29 | 31 / 36 |
| source-omits-direct | 21 / 23 | 21 / 23 | 21 / 16 |
| no-retention-direct-after-fetch | 13 / 19 | 13 / 16 | 13 / 14 |
| retained-direct-before-returned-key | 7 / 6 | 7 / 6 | 7 / 12 |
| overlapping-saved-direct-key | 23 / 16 | 23 / 25 | 23 / 20 |
| distinct-saved-direct-key | 29 / 36 | 29 / 27 | 29 / 32 |
| returned-value-equals-saved-after-direct-change | 2 / 2 | 2 / 3 | 2 / 3 |

Immediate reach, fixed seed `1468`:

| Declared state | Node fixed/fresh | Chromium fixed/fresh |
| --- | ---: | ---: |
| initialData | 20 / 23 | 20 / 16 |
| cache | 28 / 25 | 28 / 32 |
| raw | 18 / 25 | 18 / 25 |
| derived | 30 / 23 | 30 / 23 |
| empty | 13 / 14 | 13 / 10 |
| nonempty | 35 / 34 | 35 / 38 |
| function-initializer | 25 / 25 | 25 / 31 |
| cache-precedence | 28 / 25 | 28 / 32 |

Scoped strict TypeScript and ESLint checks passed on the receiving models,
drivers, wrappers, host and host fidelity fixture.
The normal Node run also passed its configured typecheck collector.

## Static receiving host and calibration cost

An earlier full Chromium attempt completed its generated campaigns but then
received a Vite reload after a neighboring agent edited an imported startup
helper. That run was interrupted and is excluded from GREEN evidence. The
receiving server now disables HMR and sets `server.watch = null` in a resolved
config hook. An inline null is insufficient because Vite's file-config merge
discards it. A temporary-file browser fidelity fixture positively loads v1,
checks the actual watcher inventory is empty, edits an imported file to v2,
and checks the loaded page still has v1 and its original identity. This proves
stability after the page has loaded; it is not universal bootstrap-byte
immutability. An immutable watch-enabled fixture control fails the watcher
assertion. The final focused clean run passed one selected test (2.78s); the
other three tests in that ordinary file were outside that selector. Both the
clean fixture and its control ran without swapping a live production module. The host also accepts optional Vite source plugins for
immutable receiving controls; its default is empty, and its isolation plugin
runs last. After that seam was added, the same focused static fixture passed
again (1.97s), with helper ESLint and scoped TypeScript checks clean.

The fixed input identities now receive the same independently authored
reach obligations as their history predicates. This lets a missing-state
checker calibration fail on an early eligible fixed history instead of
replaying the entire fixed corpus first. Independent review checked each
composite predicate against the real receipt-cut recorder. No fixed input,
generated budget, constructor, or production observation was removed. The
supplemental completion controls use fresh clones to isolate their intended
comparison from fixed-identity obligations.

## Mutants and calibration

All four immutable source controls were rejected at their intended assertions
on controlled persistence, Node SQLite and actual Chromium/OPFS. Every mutant
run guarded the fixed source SHA and exact span, recorded its transformed SHA,
and logged that the transformed module actually executed. No live source file
was swapped, and no setup error or unapplied mutant was counted as a kill.
All four Node and all four Chromium controls were rerun after the
fixed-input obligation and watch/HMR isolation changes. A sandboxed rerun first failed
to bind its localhost fixture (`listen EPERM`); those outputs are preserved as
`*.listen-denied` and excluded. The authorized local-browser rerun reached all
four intended assertions with source-application logs.

| Control | Witness | Rejection |
| --- | --- | --- |
| Restore the old retained-baseline-only oldItem expression | seed563/path `15:0:0:0:0:0` | `first` / `direct row value`, expected x1 versus x0 |
| M563: replace the baseline helper's `unownedDirectWritePositions.has(rowKey)` with `undefined` | shared structural replay 12 | `first` / `direct row ownership`, expected no owner versus source owner |
| M1468: change the persistence conjunction in needsPersistedBaseline from `&&` to `||` | seed1468/path `0:0:0` | `creation-return` / `immediate eager materialization`, expected ready versus loading |
| M1469: change its eager-mode conjunction from `&&` to `||` | same seed/path | same readiness assertion |

Initial immutable runs also tested the instrument. The first M563 attempt
stopped at a mutation-span uniqueness guard because the same expression occurs
elsewhere; its rerun anchors the original operator at offset 57583 under the
fixed source SHA. The first M1468/M1469 attempts exited green without a
source-applied log because module caching bypassed the transform. These are
unapplied controls, not survivors or kills. Setting `fsModuleCache:false` in
the temporary immutable runner and rerunning produced the intended assertion
failures with source-application logs. Their initial outputs are retained as
`*.initial-unapplied` beside the final control logs. The temporary calibration
progress run was interrupted after establishing progress and is not claimed
as another passing campaign.

The repaired-source transformed SHA256 values are:

- Old value defect: `81767f463428171dfa9746d60c4bf67978c7f78732899a995425dd25adb29c3b`.
- M563: `cabaa8d8b47a98f5d141f6bda6c150f1c4b757f0378790bb52bce430bf5e2e4e`.
- M1468: `355db31625b3051173346d32fd3d6444b9a93afedad41de56267e33d18f99abf`.
- M1469: `93a3e0b1199b190694e72962985bc7d48abd929f4162521b8df7ca6bf1d0178c`.

Generated-only reach omission was separately checked before the production
repair. Direct seed563/path `12` and immediate seed1468/path `8:8` select
constructed outputs absent from all seeded constructions. Their clean exact
replays pass; suppressing only their required reach fails `constructed states`
/ `constructed reach`. The direct witness runs on both controlled and Node
SQLite receivers. The framework's seeded constructions alone therefore cannot
satisfy the factory's fresh-output obligation ledger.

Three finite existing-history controls also check empty/truncated returns,
product failure before missing completion, simultaneous product/page-error
diagnostics and cleanup/page-error transport. They pass without adding another
product model or an unregistered generated campaign.

## Execution limits

This extension covers one successful first eager response, one saved row and
one accepted insert/upsert, bounded numeric values and raw/derived envelopes.
It does not claim arbitrary optimistic histories, peers, concurrent writers,
failed I/O, arbitrary source protocols, or cross-client cache provenance. Those
remain with their primary owners. The QueryClient and persistence hosts are
real; source responses are controlled finite inputs, not a claim about a
particular remote service.

Normal pnpm commands first attempted its automatic dependency preflight and
failed before any test. The final normal runs used the pnpm package commands above with dependency
preflight disabled. No dependency recovery or lockfile edit was performed.
The existing local install-workaround hashes remained
`ef167cca76c028d75a96818c987373ef213c8fff152ae4ff5aa43da3adea79b5`
(pnpm-workspace.yaml) and
`597c414dc296075582b34c76d10e71caac19d57a33b81a97f74f79ec10b225e1`
(pnpm-lock.yaml). Set `pnpm_config_verify_deps_before_run=false` for package
wrapper smoke commands in this local installation.
