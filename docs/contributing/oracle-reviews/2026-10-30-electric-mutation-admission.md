# Electric mutation admission evidence

Reviewed implementation and tests: `10fe53ec642e738625daf6dba8a2672eb0f63fc6`.
Parent: `9cfa11fc712866f8f276e85762865ebb8bd49cbe`.

This proposes the on-demand admission contract described in the Electric
collection guide: optimism is immediate; dispatch waits for all current stream
positions. This is a new ordering guarantee, not a claim that prior documentation
already required it. Handler confirmation remains a separate obligation.

## RED, GREEN, and mutant

Run from `packages/electric-db-collection`:

```sh
pnpm exec vitest run tests/electric-sdk-delivery-oracle.property.test.ts \
  -t 'admits cold mutations' --coverage.enabled=false --typecheck.enabled=false
```

The generated extension ran before production edits. On the parent both
campaigns fail `no write before baseline: direct`: expected0, observed1.
The smallest history has an empty name and `reverse=false`.

After the initial repair, review added a persisted receiving witness before
changing the wrapper. It failed `admission remains live: persisted` with
`StreamAbortedError` while metadata was still held. The final composition waits
for source entry and propagates the exact storage failure.

The final fixed and random campaigns pass. Each runs8 histories through all11
paths: direct, explicit transaction, multi-collection, reset, retirement,
rollback, abort, persisted success/failure/cleanup, and materialized descriptor
reuse after the original owner retires. Each path reaches8 times per campaign;
`createOracleReach` enforces reach. Payloads are strings of length0–8; release
order varies. Removing the second source loses the all-participants rule;
removing the held echo loses the admission/confirmation distinction. Existing
row admission, invalid missing-key updates, backend retries, native SQLite,
and arbitrary schedules are outside this grammar.

Replacing the final `guards.every(...)` with unconditional dispatch fails the
`replacement cursor still held` assertion (observed1, expected0). It is an
assertion failure at the intended checkpoint, not a timeout or setup failure.
Direct replay was verified against that mutant and restored production:

```sh
TANSTACK_DB_ORACLE_PROPERTY=electric.sdk-mutation-startup \
TANSTACK_DB_ORACLE_SEED=20261030 TANSTACK_DB_ORACLE_PATH=0:0 \
pnpm exec vitest run tests/electric-sdk-delivery-oracle.property.test.ts \
  --coverage.enabled=false --typecheck.enabled=false
```

The mutant fails one replay; restored production passes one replay. Other
campaigns stand aside. The final startup campaigns also pass after the loop's
lint-only change from `while (true)` to `for (;;)`. No budgets were lowered.

## Review against the oracle rubric

| Requirements | Evidence or limit |
| --- | --- |
| ORC-001–003 | Proposed authority and limits are stated above and beside the shared checker. The independent rule relates dispatched writes to supplied stream boundaries, without inspecting production preparation state. |
| ORC-004 | Eleven legal paths reconstruct the reported cold trace, multi-source reset, persistence failure, and descriptor reuse. Payload and release order vary; comments describe the axes and exclusions. |
| ORC-005 | Real `createCollection`, explicit transactions, installed ShapeStream, and managed-persistence wrapper receive controlled HTTP/storage. Dispatch, transaction settlement, error identity, and final rows are observed at held boundaries. |
| ORC-006 | Original premature-dispatch failure and stale-guard mutant are rejected at their intended assertions. |
| ORC-007 | Same property and budget run fixed/random; seed/path replay verified as above. No command-model replayPath applies. |
| ORC-008–009 | No second production lifecycle model is introduced. The checker uses external admission boundaries; Collection, sync run, retirement, and settlement retain glossary meanings. |
| ORC-010 | Existing `sameViolation` and `withElectricCleanup` preserve the first mismatch and secondary cleanup failures. Resources are released for each history. |
| ORC-011 | No additional shared-semantic-fault hypothesis requiring a second independent formulation was identified. Generated success alone is not a universal proof. |
| ORC-012 | This versioned record identifies the reviewed source/test commit and bounded evidence. |
| ORC-013 | Held versus released baseline and reset versus replacement-baseline boundaries distinguish early dispatch. A held echo distinguishes admission from confirmation. |
| ORC-014 | Claim ends at installed SDK plus controlled HTTP and managed persistence. It does not establish live-service framing, native SQLite, prompt cancellation of held storage I/O, or arbitrary reconnect schedules. |
| ORC-015–016 | Declared reaches cover every path. The existing SDK oracle owns one shared generated checker; no standalone example expectations were added as separate oracle tests. |

## Broader validation and production weight

- 38 adapter test files:1,132 tests pass, no type errors. Four files using
  `node:sqlite` fail to load under local default jsdom/Vite; the same setup
  failure occurs on unchanged parent. Those files were excluded from this run.
- Eight focused core transaction/ownership/GC suites:534 tests pass.
- Adapter and persistence package `tsc --noEmit` pass.
- Oracle lint, formatting, and the repository pre-commit checks pass.
- Size comparison: gzip +116B core, +185B Electric, +31B persistence; typical
  app scenario +115B. The final loop spelling has identical control flow.

The implementation reuses the existing transaction and Electric lifecycles,
current descriptor binding, and persistence source-start promise. It adds no
write retry queue or GC ownership layer. Waiting for Collection readiness was
rejected because publication can wait on the same optimistic transaction;
preloading rows would also defeat on-demand behavior. The added bytes implement
stream-position preparation and its invalidation, plus wrapper composition.


## Review follow-up: accepted evidence across readiness cleanup

Review base: `006b65bac772c020de657c872a49922743986697`.
CodeRabbit comment4421557210 identified that the added late lifecycle fence
also discarded transaction evidence from a batch admitted while active. The
parent adapter published that evidence after the ready callback. The correction
preserves that behavior while fencing mutation readiness and match publication
against a retired run. Callbacks entering after retirement remain rejected by
the existing entry fence.

Before the source edit, the generated startup checker was extended with
`ready-cleanup`: insert an optimistic row, hold the first HTTP response, then
supply a source batch containing txid100 whose ready callback cleans up the
Collection. The admitted batch's txid must remain queryable after cleanup;
the pending optimistic mutation must reject without dispatch. Both campaigns
failed with `TimeoutWaitingForTxIdError` for100 on the review base. This is the
specific acknowledgement timeout under test, not a generic harness timeout.

The repair guards only `resolveMutationReady` and `commitMatches`. It publishes
and clears the accepted batch's evidence regardless of callback retirement.
The existing shared checker now runs twelve paths in each of8 fixed and8 random
histories, with declared reach. Payload and participant-release order remain the
same generated dimensions. The contract and evidence limits above remain;
this adds one synchronous reentry boundary, not arbitrary stale callbacks.


## November 2: upstream merge and complete persisted startup

Merged upstream main `d9d0a8e` in `4911f7b`, preserving both coverage-map
additions. The only merge conflict was that shared documentation append.

- Law: the proposed mutation-preparation contract waits for persistence startup
  as well as current Electric stream positions, without waiting for row visibility.
  The Electric collection guide now states this composition explicitly.
- Reach: the existing startup grammar adds `persisted-index`. A real Collection
  index causes coordinator startup work to remain held after metadata and the
  installed SDK's baseline arrive. All thirteen paths reach eight times in each
  fixed/random campaign; payload and participant order still vary.
- RED: the focused startup command above fails both campaigns before the source
  change. Seed20261030, path0:0 observes one handler invocation where zero is
  required at `no write before persisted startup completes`.
- Repair: after source entry, mutation preparation also awaits the runtime's
  existing `ensureStarted()` promise. Source entry keeps its existing metadata
  boundary; no startup queue or readiness state is added.
- GREEN: the same campaigns pass. The four affected adapter suites pass408
  runtime/type tests with no type errors; persistence `tsc --noEmit` passes.
- Mutant: removing only the added startup wait reproduces the same assertion
  failure in direct seed20261030/path0:0 replay. Restoring it passes that replay.
- Limits: the new receiving path uses controlled coordinator scheduling and
  managed storage plus the installed Electric SDK. It establishes held-versus-
  released startup ordering, not a new native-SQLite or arbitrary-failure claim.

The original oracle missed this boundary because its persistence paths held
metadata only; none left coordinator startup pending after source entry.
CodeRabbit's broader claim about late index failures was not reproduced: index
request failures are currently caught by persistence. This repair addresses the
verified premature-dispatch boundary and adopts full startup promise rejection
without changing index failure policy.

Self-review: ORC-001–007 and ORC-013–016 retain the prior contract, shared checker,
installed-SDK path, campaign parity, replay, and cleanup limits. The new held
coordinator request distinguishes source-entry-only admission from complete
startup admission. ORC-008 adds no model state; ORC-009 uses the existing terms.
ORC-010 cleanup releases the new held index before cleaning up the Collection.
ORC-011 identified no separate shared-semantic-fault hypothesis. This record
supplies ORC-012 evidence for the bounded added path; it is not an exhaustive
audit of unrelated upstream changes.

Reviewed packages/db-sqlite-persistence-core/src/persisted.ts SHA256: `7445fdf60921cd04feb1f1aa22415b3f637545b084223ba2b7af9f19328194ab`.

Reviewed packages/electric-db-collection/tests/electric-sdk-delivery-oracle.property.test.ts SHA256: `cf58a63b38f465d3c558d55e3b62daf5984a7c6035615c26fc44803e84e781e7`.
