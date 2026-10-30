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
