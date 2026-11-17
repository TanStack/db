# Query receiving properties: campaign API conversion

This additive record reviews the conversion on merge base
`29de8a92e3aae74dc4c1c2c2d2d47e6edd44dc86`, which merged `origin/main`
`caa936d5a`. It uses the exact `@tanstack/oracles` and lint packages at
`e1fb504`. Query production is unchanged. Its `src/query.ts` SHA256 remains
`6bbf1542e6daa38f33315445c5bb0ae3fbbf90d907cd388cb5d13f41c3b37cc5`.

This record supersedes campaign counts and replay coordinates in the
[precedence](2026-11-10-persisted-precedence-gaps.md) and
[scope/provenance](2026-11-10-retained-scoped-hydration-gaps.md) records for
these converted runners. Those earlier experiments remain historical evidence.
It does not reclassify the full-package CLI audit or establish PR readiness.

## Preserved laws and receiving paths

The conversion retains three independent judgments and their authorities:

- `query.persisted-write-precedence`: an older result preserves newer accepted
  direct writes and removes omitted saved rows; a later physical fetch may
  replace those writes. Authority: Query guide, **Direct Writes and Query Sync**
  and **Individual Write Operations**.
- `query.retained-scoped-hydration`: on-demand restore exposes demanded saved
  rows; complete omission is local to its certified scope. A limited result
  cannot certify an ownerless direct row absent. Authority: SQLite guide,
  **Persist a collection**, and Query guide, **QueryFn and Predicate Push-Down**.
- `query.cached-peer-claim`: cached first acquisition cannot replace a
  continuously owned value from a later physical fetch. A subsequent physical
  fetch may replace it. Authority: Query guide, **Direct Writes and Query Sync**.

The independent computations remain a keyed write overlay, set selection over
two authored scopes, and three authored values in causal order. Extracting
`expectedPersistedPrecedence` and `expectedCachedPeerClaim` exposes the existing
expectations to the framework; it changes no expected rule. The precedence
arbitrary changes from mapped tuples to records with the same language and
branch weights, so fixed and constructed objects have a valid shrink context.

The real QueryClient, Query Collection, persistence wrapper, controlled storage,
and real Node SQLite paths remain. Optional recorder callbacks capture existing
public, durable and cache observations at their original cuts. Prefix comparisons
run before completion checks, preserving an earlier row mismatch if later work
fails. Existing error-preserving cleanup still closes collections and hosts.

The first framework run exposed an observation determinism error: the old
precedence snapshot spread retained an unjudged virtual `$collectionId`.
Explicit `{ id, value }` projection fixes that capture error. The previous law
already excluded virtual properties; no judged field was removed. That initial
392/394 result supplies no clean GREEN evidence.

Chromium continues to use the same shared histories, drivers and comparisons
through actual worker SQLite/OPFS: 104 precedence histories and 50 scope/cache
histories within the parent's 226-history receiving run. The earlier parent run
passed in 50.6 seconds. The parent owns the final post-conversion browser rerun;
this record does not claim that later execution.

## Campaigns and enforced reach

Both Node hosts register each property through `oracleProperty`. Each normal
registration has a fixed-seed and random campaign with identical machinery and
run budget. Fixed histories run separately and provide no required reach.

| Property | Base budget per campaign | Fixed seed | Fixed histories per host | Randomized builders | Histories counted per campaign |
| --- | ---: | ---: | ---: | ---: | ---: |
| persisted-write-precedence | 80 | 2394 | 104 | 15 | 95 |
| retained-scoped-hydration | 60 | 1481 | 48 | 12 | 72 |
| cached-peer-claim | 60 | 1376 | 2 | 4 | 64 |

Each builder preserves random neighboring dimensions and returns a fresh object.
Each state has one builder and a minimum of one constructed entry per campaign.
Every builder has its own missing-state calibration. Because the pinned framework
does not associate generated construction outputs with their `enters` obligations,
a local WeakMap retains those obligations. The shared check rejects an output
whose production-driver trace omits its required state. This also covers builders
invoked during generated runs, rather than only their seed-derived constructions.

The final normal run passed **400/400 tests in 25.76 seconds**. These are test
registrations, not 400 histories. `C` means controlled storage; `N` means Node
SQLite. Fixed-seed counts agree between hosts. Random counts are independent.

| Precedence state | Fixed C/N | Random C | Random N |
| --- | ---: | ---: | ---: |
| after-read | 18 | 16 | 24 |
| before-fetch | 15 | 15 | 6 |
| before-read | 27 | 25 | 27 |
| before-restore | 19 | 22 | 28 |
| before-result | 16 | 17 | 10 |
| cached-result | 30 | 27 | 34 |
| delete | 24 | 12 | 12 |
| derived | 49 | 50 | 55 |
| during-baseline | 45 | 41 | 51 |
| fetched-result | 65 | 68 | 61 |
| insert | 26 | 33 | 30 |
| later-fetch | 55 | 47 | 51 |
| raw | 46 | 45 | 40 |
| update | 13 | 14 | 10 |
| upsert | 32 | 36 | 43 |

| Scoped hydration state | Fixed C/N | Random C | Random N |
| --- | ---: | ---: | ---: |
| empty-result | 17 | 23 | 14 |
| first-a | 37 | 31 | 38 |
| first-b | 35 | 41 | 34 |
| limited | 37 | 43 | 37 |
| limited-ownerless-restored | 20 | 17 | 16 |
| no-ownerless | 18 | 22 | 20 |
| nonempty-result | 55 | 49 | 58 |
| omitted-owned-row | 37 | 35 | 33 |
| ownerless-first | 30 | 24 | 28 |
| ownerless-other | 24 | 26 | 24 |
| unbounded | 35 | 29 | 35 |
| unrequested-saved-rows | 52 | 56 | 48 |

| Cached claim state | Fixed C/N | Random C | Random N |
| --- | ---: | ---: | ---: |
| different-cached-value | 61 | 60 | 61 |
| later-value-change | 61 | 62 | 60 |
| manual | 35 | 33 | 33 |
| older-fetch | 29 | 31 | 31 |

## Preserved mutation sensitivity and guarded replay

An immutable per-process transformer validates the original operator and source
position, logs the applied SHA, disables filesystem module caching, and assigns
each operator a distinct plugin/cache identity. It never edits production files.
The same seven stable operators rejected before conversion still fail the
intended public or durable law after conversion:

| Operators | Wrong design | Property | Seed | New shrink path |
| --- | --- | --- | ---: | --- |
| M558/M559 | Delete an ownerless restored row from a limited empty result | retained-scoped-hydration | 1481 | `0:1:1:1:1:2` |
| M1481 | Publish the unrequested saved scope through full baseline hydration | retained-scoped-hydration | 1481 | `2:1:0:1:1` |
| M1376/M1377 | Let stale cached first acquisition replace the later-fetched value | cached-peer-claim | 1376 | `0:0:1:0:1` |
| M1748 | Skip derived-select baseline reconciliation, retaining an omitted saved row | persisted-write-precedence | 2394 | `1:1` |
| M1793 | Let a cached old result overwrite a newer direct write | persisted-write-precedence | 2394 | `3:1:1` |

Every mutant's guarded replay records the intended `OracleViolation` and two
failed execution witnesses, one per host. Clean production passes those same
five distinct coordinates with two successful execution witnesses each. Tests
selected by `fixed seed|random seed|fixed history` run 320 law registrations and
exclude 80 framework calibration/determinism registrations in the final suite.
Historical pre-calibration logs correctly report their earlier counts.

The three previous bounded survivors, M563/M1473/M1794, still pass these two
receiving runners. They remain open mutant gaps under the new policy. The prior
bounded-equivalence arguments are explanations, not closure or maintainer
allowances. Prior full-package timeouts M1468/M1469 finish GREEN in these
receivers in 7.9/8.2 seconds; that does not reclassify the earlier 173-second
full-package timeouts, whose ownership suites differ.

This is a selected stable-operator before/after check, not a newly complete CLI
score. The global audit owns those classifications and remaining gaps.

## Generated-construction enforcement controls

Three immutable controls suppress only one reach observation, leaving real row
observations correct. Each chosen history is absent from that campaign's
seed-derived constructions. Therefore rejection specifically demonstrates the
local generated-output obligation check, beyond the framework's seeded check.

| Property | Generated history distinction | Missing state | Seed | Shrink path |
| --- | --- | --- | ---: | --- |
| persisted-write-precedence | derived/upsert, before fetch, value -8, no later fetch | before-fetch | 2394 | `16` |
| retained-scoped-hydration | first a, unbounded, empty saved masks, next mask 3, ownerless other, value -8 | nonempty-result | 1481 | `13:7` |
| cached-peer-claim | manual cache 9, current -1, later 9 | manual | 1376 | `7:9` |

All three controls fail **constructed reach** at **constructed states** on both
hosts. Their guarded replays retain that law/checkpoint and two failed witnesses.
Clean replays at all three coordinates record two successful witnesses. The
per-builder missing-state calibrations also pass in the normal 400-test run.
Separate public and durability-only wrong-observation controls prove neither
channel can be ignored. An initial scratch-config escaping error is retained
separately and supplies no rejection evidence.

## Commands and evidence

From the worktree root, the normal run is:

```sh
pnpm --config.verifyDepsBeforeRun=false --filter @tanstack/query-db-collection exec vitest run --maxWorkers=2 --coverage.enabled=false --typecheck.enabled=false tests/persisted-precedence-oracle.test.ts tests/retained-scoped-hydration-oracle.test.ts
```

From `packages/query-db-collection`, guarded clean replay uses the property ID,
campaign seed and new path from either table:

```sh
TANSTACK_DB_ORACLE_SEED=2394 TANSTACK_DB_ORACLE_PATH=1:1 TANSTACK_DB_ORACLE_PROPERTY=query.persisted-write-precedence node --import tsx ../db/tests/oracle-replay.ts tests/persisted-precedence-oracle.test.ts tests/retained-scoped-hydration-oracle.test.ts --maxWorkers=2 --coverage.enabled=false --typecheck.enabled=false
```

Logs remain in `.review-2367/gap-fill/`: `query-property-green-final.log`,
`query-property-M*.log`, `query-property-M*-replay.log`,
`query-property-*-clean-replay.log`, and
`query-property-generated-omit-*-replay.log`. Exact generated histories live in
`query-property-generated-choices.json`. Typecheck logs are
`query-property-types.log` and `query-property-browser-types.log`.
Final Query/browser TypeScript, scoped ESLint, Prettier, `lint:changed` and
`git diff --check` all pass. Their final logs use the `query-property-*-final`
prefix. No run budget was lowered and no legacy exemption was added.

## Review scope and remaining obligations

ORC-001/002/003 retain the documented laws, independent judgments and literate
roles. ORC-004 retains the grammar domains, reconstruction and ablation witnesses
in the prior reports; constructed outputs must also belong to that language.
ORC-005 retains the real receiving paths and original public observation cuts.
ORC-006 preserves seven assertion kills and distinct public/durable calibrations.
ORC-007 has parity campaigns and guarded RED/GREEN replay. ORC-008's stateful
model change trigger does not apply. ORC-009 preserves existing vocabulary and
declared projections. ORC-010 compares captured prefixes before completeness
and retains cleanup diagnostics. No concrete shared semantic fault requiring
an ORC-011 alternate formulation was identified; this is no claim that none
exists. This record supplies ORC-012 evidence. ORC-013 retains nearby scope,
window, causal-order and omission distinctions. ORC-014 retains actual SQLite
and the shared Chromium receiving path, with the final browser rerun assigned
to the parent. ORC-015 now enforces both seeded and generated construction
obligations with missing-state controls. ORC-016 keeps fixed histories and
calibrations within the shared judgments, without standalone expected examples.

The receiving grammars remain finite: one cold eager reopen and one direct
write, two disjoint on-demand scopes, or one continuously owned overlapping key;
successful I/O and numeric values. Arbitrary overlapping predicates, peer
writers, failed I/O, optimistic transactions in these added receivers, and all
intermediate publications remain outside their evidence. Existing ownership,
startup, recovery and direct-write-window owners retain their separate laws.
Their legacy campaign conversions are not discharged by converting these two
new runners. No production repair or global bug-class closure is claimed here.
