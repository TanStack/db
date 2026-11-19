# Persisted startup oracleProperty conversion

This record evaluates `29de8a92e3aae74dc4c1c2c2d2d47e6edd44dc86` plus the
conversion files below, with `@tanstack/oracles` at
`e1fb5048c6d33e958643360d87e168c302e03bd1`. Production is unchanged. The shared
set model, comparisons, adapter drivers, storage hosts and Chromium receiver
remain the accepted product instrument.

| Converted file | SHA-256 |
| --- | --- |
| `packages/db-adapter-conformance/tests/persisted-startup-oracle-suite.ts` | `4616fecfbfe811338003197706b3e3839e911a55c6402ce21c63b5893f5a031a` |
| `packages/db-adapter-conformance/tests/persisted-startup-oracle.ts` | `ec7671a2cf02b0d6330a647a19c0b7deec66a103d8787fd9f0451f32fcbb9281` |
| `packages/query-db-collection/tests/persisted-startup-conformance-oracle.test.ts` | `c53a3cdcbaaea95965ae438fc3a3b248ece57235f6971bce0eb24bd9881b526a` |

## Preserved law and paths

A complete eager source result replaces its persisted baseline; a scoped source
retains an omitted peer-owned row. An omitted ownerless direct row is removed.
The first result is durable before a later refresh. Network-first fallback
retains the saved public and durable snapshot until source delivery. Authority:
READY-3/PUB-7, Query's “Direct Writes and Query Sync” and “Initial Data” contracts,
the glossary's network-first initial-render contract, and the maintainer's
shared-owner decision on 2026-11-09.

The model remains `expectedPersistedStartup` / `expectedStartupFallback` in
`persisted-startup-oracle.ts`. `persistedStartupViolations` and the immediate-cut
checks still invoke that model. The framework adapter's model return adds only
constructed-state obligations; it does not create another product model.

All six adapters retain controlled and real Node SQLite receiving paths. The
same composition driver compares fallback public/durable rows, the first
source result, its durable state before refresh, rows inside refresh
fulfillment, durable rows afterward, and local-only reopen. Scoped Query also
compares ownership. The one-full-row-read work law and Query's source-origin
premises are unchanged. Source response / restore ordering is proved before
recording reach.

Each host keeps the 80-history fixed-seed campaign at seed `2367`, the same
80-history fresh campaign, and every fixed input: 116 for Query and 26 for each
other adapter. New mandatory constructions add one seed-derived example per
state in each campaign: 16 for Query, nine elsewhere. The same constructors
also participate in generated and shrunk histories.

`fc.chain` cannot admit context-free fixed/constructed inputs through
`canShrinkWithoutContext`. The two startup generators therefore use direct
records with the same legal language. Sampling weights and the exact seed
stream change; no mask, schedule, optional action, provenance, origin or fixed
history is removed. The legal bounds remain masks `0..7` over three string
keys. Peers require saved rows; ownerless provenance requires saved rows;
cached/initial Query answers precede restore; an after-deadline source requires
network-first and a nonempty saved baseline. Removing any constraint admits an
invalid history. Removing a named axis loses its corresponding required state
or ownership/omission distinction.

## Validation and calibration

All final normal runs pass, including type checking: Query 280 tests; Convex,
Electric, TrailBase, RxDB and PowerSync 86 tests each (710 total). Commands run
`vitest run --coverage.enabled=false` on each package's existing
`persisted-startup-conformance-oracle` runner. The three converted files pass
ESLint. The local filtered install initially lacked unrelated `pg` declarations;
the final clean runs occur after that workspace dependency was linked.

The existing calibration judgments are retained: a stale first durable result
cannot be repaired by later refresh; losing the saved fallback fails; retaining
fallback as the first source's durable result fails; and dropping source
persistence before restore or after timeout fails at `startupDurable`.
Persistence loss wraps both outer and hydration-scoped adapters. The latter
fault must actually run for the RxDB/PowerSync real SQLite before-restore
witness. A clean candidate that fails cannot certify the fault; the framework
must find a passing clean trace and the named rejection, or fail calibration.

Each builder returns a fresh object. A WeakMap records its declared state on
every invocation, including fresh generated/shrunk constructions. The shared
check enforces that obligation after product comparisons. One missing-state
control per state proves that the shared check rejects a construction whose
state observation is removed. These controls run through the same model,
driver and comparison; they do not depend on the framework's seed-only
history-to-builder association. Product mismatches retain their original cut
before the driver's structured throw. Missing completion and construction
obligations use unrecorded checkpoints so a prior driver error stays primary.

This explicit replay ran one history per host, with two tests passed and 278
skipped; it did not run either normal campaign first:

```sh
TANSTACK_DB_ORACLE_PROPERTY=query.startup-ownership \
TANSTACK_DB_ORACLE_SEED=2367 TANSTACK_DB_ORACLE_PATH=0 \
../../node_modules/.bin/vitest run --coverage.enabled=false \
  --typecheck.enabled=false tests/persisted-startup-conformance-oracle.test.ts
```

## Reach

Every required state has a minimum of one randomized construction per host and
campaign. Fixed literals supply no required-reach credit. Counts below include
the 80 generated histories and the mandatory constructions. `Fixed` is the
same count on both hosts. `Fresh C` and `Fresh SQLite` are separate fresh
campaigns.

### Query

| State | Fixed C / SQLite | Fresh C | Fresh SQLite |
| --- | ---: | ---: | ---: |
| `cached-disabled` | 17 | 10 | 7 |
| `cached-pending` | 12 | 8 | 8 |
| `empty-baseline` | 3 | 2 | 1 |
| `empty-result` | 55 | 50 | 51 |
| `fetch` | 50 | 49 | 58 |
| `initial-disabled` | 10 | 16 | 15 |
| `initial-pending` | 7 | 13 | 8 |
| `network-first-fallback` | 19 | 11 | 11 |
| `network-first-source-result` | 70 | 79 | 69 |
| `omitted-row` | 73 | 79 | 76 |
| `overlapping-update` | 34 | 29 | 36 |
| `ownerless-baseline` | 65 | 51 | 58 |
| `peer-owner` | 39 | 60 | 51 |
| `persisting-mutation` | 75 | 79 | 80 |
| `response-before-restore` | 73 | 82 | 77 |
| `restore-before-response` | 23 | 14 | 19 |

### Collection-wide sources

Each cell is `fixed both hosts / fresh controlled / fresh SQLite`.

| State | Convex | Electric | TrailBase | RxDB | PowerSync |
| --- | --- | --- | --- | --- | --- |
| `empty-baseline` | 8 / 10 / 15 | 8 / 13 / 14 | 8 / 18 / 9 | 8 / 15 / 12 | 8 / 18 / 14 |
| `empty-result` | 46 / 46 / 57 | 46 / 52 / 41 | 46 / 50 / 56 | 46 / 43 / 54 | 46 / 49 / 48 |
| `network-first-fallback` | 29 / 21 / 18 | 29 / 25 / 23 | 29 / 18 / 27 | 29 / 21 / 16 | 29 / 16 / 22 |
| `network-first-source-result` | 56 / 60 / 59 | 56 / 55 / 58 | 56 / 64 / 50 | 56 / 55 / 60 | 56 / 61 / 56 |
| `omitted-row` | 69 / 67 / 60 | 69 / 66 / 62 | 69 / 60 / 67 | 69 / 60 / 63 | 69 / 59 / 64 |
| `overlapping-update` | 30 / 27 / 23 | 30 / 23 / 28 | 30 / 28 / 23 | 30 / 31 / 24 | 30 / 25 / 27 |
| `persisting-mutation` | 77 / 74 / 75 | 77 / 74 / 74 | 77 / 78 / 79 | 77 / 76 / 76 | 77 / 73 / 72 |
| `response-before-restore` | 48 / 55 / 55 | 48 / 49 / 52 | 48 / 60 / 48 | 48 / 53 / 51 | 48 / 55 / 54 |
| `restore-before-response` | 41 / 34 / 34 | 41 / 40 / 37 | 41 / 29 / 41 | 41 / 36 / 38 | 41 / 34 / 35 |

## Rubric and limits

ORC-001–003 retain the existing authority, independent set model and named
companion boundaries. ORC-004 retains the legal language and all fixed
reconstructions; the record filters state the exclusions above. ORC-005 retains
the six real adapter paths and original public/durable cuts. ORC-006 retains
the wrong-result and scoped dropped-write controls and adds missing-state
controls. ORC-007 uses the constructor's equal-budget fixed/fresh campaigns and
the checked direct replay. ORC-008 changes no product-model state. ORC-009
preserves canonical state names and identifies construction obligations as
instrument metadata. ORC-010 retains original cut verdicts, partial-trace
failure priority and the existing cleanup. ORC-011 has no new shared semantic
fault in this pure conversion; no second product model is introduced. This
record supplies ORC-012 evidence. ORC-013 retains the existing neighboring
replacement/fallback cuts; it adds no deadline-threshold claim. ORC-014 keeps
both hosts and the unchanged Chromium receiver. ORC-015 has a constructed
builder and missing-state control for every declared state, with fresh-output
obligations and the measured counts above. ORC-016 replaces manual registrations
with fixed inputs and reusable calibration judgments; it adds no example-based
expected answers.

The conversion does not change or broaden the shared owner's limits: eager
startup, three keys, one source and optional peer, a disjoint persisting
mutation, and local-only reopen. It proves no on-demand, concurrent-writer,
failed-I/O, remote-replication, or every-intermediate-publication law. The
Chromium receiver remains a separate unchanged receiving witness, not a native
Vitest constructor conversion. Gap-retention results belong to the separate
same-seed before/after audit; these green runs alone do not close any surviving
production gap or grant a maintainer allowance.
