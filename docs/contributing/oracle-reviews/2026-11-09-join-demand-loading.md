# Ready joined demand loading

Status: regression verified; proposed upstream fix.

Reviewed against `a86aa4304` with the sole production change in
`CollectionConfigBuilder.beginDemand`: track its participant through
`trackSubsetLoadPromise` instead of `trackSubsetLoadOperationPromise`.
This record accompanies that change and its oracle in the same commit.

## Law and scope

A ready live-query Collection reports `isLoadingSubset` while any current
joined demand is pending. Settling or retiring one demand removes only its own
contribution. Collection readiness remains ready. Authority: the
[public property](../../reference/interfaces/Collection.md#isloadingsubset)
and the [live-query architecture](../../../packages/db/src/query/live/ARCHITECTURE.md)
source cancellation and status laws.

The boundary is controlled core sync callbacks, one or two sibling lazy joins,
after graph and promise callbacks drain. The original witness starts an empty,
ready query, then inserts a root whose child load is held. No provider response
is needed to observe the wrong flag. Adjacent witnesses replace or remove the
root while transports are held, settle obsolete work, and settle one sibling
while another remains pending. The existing source-readiness refinement oracle
owns initial readiness; this oracle owns the public post-ready loading flag.

## Evidence

RED, before editing production, and GREEN, after the one-line change:

```sh
pnpm --filter @tanstack/db exec vitest run --coverage.enabled=false tests/query/join-demand-loading-oracle.test.ts
```

RED failed both campaigns at the loading comparison: expected true, received
false. The fixed campaign seed was 291107, shrink path `0:0:0:0`.
The reduced history was width 1 with replacement, retirement, reverse order,
rows, and rejection all false. GREEN passed both campaigns.

Restoring the original production line rejects the same reduced history at the
same comparison, rather than failing setup. Direct replay runs one campaign
and skips the fixed campaign:

```sh
TANSTACK_DB_ORACLE_PROPERTY=query.join-demand-loading TANSTACK_DB_ORACLE_SEED=291107 TANSTACK_DB_ORACLE_PATH=0:0:0:0 pnpm --filter @tanstack/db exec vitest run --coverage.enabled=false tests/query/join-demand-loading-oracle.test.ts
```

The broader run passed 1,119 tests across seven files, with no type errors:

```sh
pnpm --filter @tanstack/db exec vitest run --coverage.enabled=false --silent=false tests/query/join-demand-loading-oracle.test.ts tests/query/load-subset-source-readiness-refinement-oracle.test.ts tests/query/load-subset-join-dedupe.test.ts tests/query/includes-temporal-oracle.test.ts tests/query/ordered-demand-retirement.test.ts tests/live-query-collection.test.ts tests/source-health.test.ts
```

Reach is counted in histories, each campaign having 100. The random seed in
this broader run was -325027783.

| Declared state | Fixed | Random |
| --- | ---: | ---: |
| One pending join | 53 | 51 |
| Two pending joins | 47 | 49 |
| Replacement while pending | 54 | 56 |
| Retired pending demand | 62 | 55 |
| Current failure | 21 | 18 |
| Current rows | 11 | 16 |
| Current empty result | 6 | 11 |
| Obsolete settlement | 80 | 84 |
| Settlement with another pending join | 22 | 32 |

Test TypeScript compilation and targeted ESLint passed. Bundle comparison with
`pnpm size:compare --packages db --rebuild` against the base above reports
109,551 gzip bytes both before and after (zero growth), and 47 fewer Brotli
bytes. Measurements used Node 26.11.1 and pinned pnpm 11.1.0. The full monorepo
suite was not run.

## Oracle review

- ORC-001–003: authority and limits are above and beside the independent
  `expectedLoading` model. `declareOracle` identifies model, grammar, checker
  and production owner. Expected state uses input actions, not production state.
- ORC-004: the grammar crosses width 1/2 and five Boolean dimensions. Width
  distinguishes single-load clearing from aggregation; replacement and removal
  distinguish demand lifetime from transport lifetime; order exposes obsolete
  settlement; rows and rejection distinguish successful empty, populated, and
  failed loads. All requests are acquired before explicit settlement. Removing
  any dimension removes that corresponding distinction. The minimal original
  history remains representable; these are sampled histories, not an exhaustive
  enumeration or proof for arbitrary query graphs.
- ORC-005: real Collections, indexed lazy joins, and sync writes exercise
  `beginDemand`. Request counts are checked before observations; held requests
  are never awaited to obtain a pending observation. No concrete missing-input
  hypothesis was identified: core has the demand and its participant promise.
- ORC-006–007: RED, restored-line mutant and direct replay above calibrate the
  checker. Fixed and random campaigns have equal budgets and share one driver.
- ORC-008–009: current demand keys and settled transport keys are separate sets.
  Retirement requires the former distinction; partial settlement requires the
  latter. This deliberately abstracts production demand generations into unique
  keys per acquisition, without reproducing its queues or counters.
- ORC-010: failure is captured before cleanup; shared `finishCleanup` preserves
  primary and cleanup failures. Shrinking and direct replay retain the same
  false-versus-true mismatch at the pending checkpoint.
- ORC-011: no concrete shared semantic fault requiring a second formulation was
  identified; the model is set membership over explicit current obligations.
- ORC-012: this versioned record supplies the review evidence for the accompanying
  production and oracle changes.
- ORC-013: removing the last root while its transport remains held distinguishes
  current-demand loading from all-transport loading. Settling one of two current
  joins distinguishes aggregate loading from last-settled-request loading.
- ORC-014: not triggered; no controlled premise is promoted to a real-provider
  or framework claim.
- ORC-015: `createOracleReach` declares and asserts every state listed above.
- ORC-016: all cases use the generated-history model/driver/comparison; no
  ordinary example or concrete type assertion is placed in the oracle file.

## Limits

This does not establish provider timing, framework rendering, nested includes,
ordered windows, replay, or callback-time reentrancy. It does not change or
claim transactional snapshot consistency. Those boundaries retain their
existing [coverage owners](../oracle-coverage.md). No known counterexample
remains within the stated controlled post-ready sibling-join boundary.

## Upstream merge validation, 2026-11-11

Merged `origin/main` at `8cd8627c6` without rewriting the published branch.
The conflicts were additive entries in the coverage map and replay registry;
both upstream additions and this property's entry are retained. The production
diff against this base remains the same one-line tracker change.

Upstream removed the standalone reach helper in its oracle framework migration.
The test now uses `oracleProperty`: the same six-dimensional scenario grammar,
current/settled set model, controlled Collection driver, and status checkpoints
feed a recorded-trace comparison. The model predicts the status sequence from
the scenario before comparing public observations. It checks every recorded
prefix before completeness, so a later setup error cannot hide a loading
mismatch. Fixed and random budgets remain 100 each. Nine constructed histories
now guarantee the declared states while retaining generated dimensions; the
original minimal regression is a named history through the same driver and
comparison. The framework supplies determinism, reach accounting, and replay.
This supersedes the original `declareOracle`/`createOracleReach` registration
and replay mechanics described above, without changing the law or limits.

The seven-file command above passed **1,121 tests**, including the named
regression and framework determinism check. The fixed seed remains 291107;
the random campaign seed was -575196917. Reach counts include the framework's
constructed examples (109 histories per campaign):

| Declared state | Fixed | Random |
| --- | ---: | ---: |
| One pending join | 50 | 43 |
| Two pending joins | 59 | 66 |
| Replacement while pending | 68 | 60 |
| Retired pending demand | 48 | 49 |
| Current failure | 29 | 25 |
| Current rows | 21 | 20 |
| Current empty result | 11 | 15 |
| Obsolete settlement | 88 | 81 |
| Settlement with another pending join | 43 | 43 |

Restoring the original tracker call still fails the named history at `status 1`
under law `current demand loading`, expected loading true and observed false.
The fixed production call was restored before the passing seven-file run.
Replay the named history with:

```sh
pnpm --filter @tanstack/db exec vitest run --coverage.enabled=false tests/query/join-demand-loading-oracle.test.ts -t 'ready empty query acquires its first joined demand'
```

The bundle comparison against the exact new base used
`pnpm size:compare --packages db --exact-base --rebuild`: package gzip remains
109,576 bytes; Brotli grows 34 bytes. The typical app remains 95,783 gzip bytes.
No new production state or helper was added; this is the existing tracker call
substitution, so the small compression delta does not justify extra machinery.
