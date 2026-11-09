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


## November 3: stale persistence preparation and upstream merge

Source baseline: PR head `8f6abecd5c7430e09ced81f7304292cb48673f79`, merged with
upstream `36f879727d594601e28329e177c802dc179bf9e9`. This entry describes the
source and oracle changes in the commit containing this entry. Self-review.

- **Law:** Collection cleanup invalidates pending source preparation. Late
  metadata settlement must not restart the retired persistence runtime or retain
  a cache claim/coordinator subscription. Authority: the cleanup lifecycle in
  the glossary and the proposed mutation-admission contract in the Electric
  guide. Successful startup must still dispatch after metadata and index startup.
- **Reach:** the existing `persisted-cleanup` receiving path now observes a live
  cache claim before cleanup, then completed cleanup and transaction settlement.
  All thirteen paths run eight times in each fixed/random campaign. The release
  flag varies metadata release before/after cleanup settlement; payloads remain
  strings of length 0–8. No run budget was reduced.
- **RED:** before the persistence repair, both generated startup campaigns fail
  `retired preparation cannot restart storage`: two claim requests versus one.
  The previous checker observed only blocked dispatch and missed resource
  acquisition after cleanup. The extension ran before the production repair.
- **GREEN:** the lifecycle-generation check before `ensureStarted()` makes both
  startup campaigns pass. Resource expectations come from the cleanup law;
  claim/subscription recorders observe external collaborator calls, without
  inspecting the runtime's generation or preparation machinery.
- **Mutant:** removing only the new generation check fails direct replay with
  seed `20261030`, path `0:0`, property `electric.sdk-mutation-startup`, at the same
  claim-request assertion. Restoring it passes the same replay. This is an
  assertion failure at the intended checkpoint, not a setup error or timeout.
- **Limits:** the installed Electric SDK receives controlled HTTP and the real
  persistence wrapper receives controlled managed storage. No live-service,
  native SQLite resource-release, renewal-timer, arbitrary restart scheduling,
  or prompt storage-I/O cancellation claim follows.

Commands from `packages/electric-db-collection` (Node available on PATH):

```sh
node ../../node_modules/vitest/vitest.mjs run tests/electric-sdk-delivery-oracle.property.test.ts \
  -t 'admits cold mutations' --coverage.enabled=false --typecheck.enabled=false
TANSTACK_DB_ORACLE_PROPERTY=electric.sdk-mutation-startup \
TANSTACK_DB_ORACLE_SEED=20261030 TANSTACK_DB_ORACLE_PATH=0:0 \
node ../../node_modules/vitest/vitest.mjs run tests/electric-sdk-delivery-oracle.property.test.ts \
  --coverage.enabled=false --typecheck.enabled=false
```

ORC-001–005: the existing contract, driver, grammar and independent admission
judgment remain; cleanup adds external resource observations at settlement.
Removing the cleanup path loses the stale-continuation witness; removing the
successful persisted/index paths loses the adjacent valid-startup witnesses.
Cleanup precedes source entry; cleanup without an admitted Collection operation
is outside this grammar. ORC-006–007: RED and restored direct replay above,
with unchanged fixed/random budgets. ORC-008–009: no model state or vocabulary
was renamed or merged. ORC-010: existing first-violation reporting and ordered
cleanup remain. ORC-011: no shared semantic classifier is used for the zero-live-
resources rule, and no concrete second-formulation hypothesis was identified.
ORC-012: this append-only entry is versioned with the source/test changes.
ORC-013: live startup versus retired startup distinguishes the guard from an
unconditional abort. ORC-014: the boundary stays explicitly controlled.
ORC-015–016: existing declared per-path reach is retained, with cleanup reach
moved to the settlement boundary; no standalone examples were added.

The merge retains upstream's retry health and retired-evidence policy alongside
mutation-gate invalidation. In particular, retirement no longer advances the
Electric epoch: upstream failure reporting may still belong to that retired run,
and the next start advances the epoch. External abort only rejects preparation
for its originating active run.


Validation: 42 adapter files / 1,219 runtime tests pass (the command excluded
`electric-sdk-delivery.test.ts` and `electric-descriptor-isolation-oracle.test.ts`;
two other exclude patterns matched no files). The focused four-file run passes
400 runtime tests. Those initial runs also reported three missing local build
artifacts during typechecking; production package builds were then generated
before rerunning typechecking. Persistence `tsc --noEmit` passes after linking
its Browser workspace dependency. Changed-source ESLint, oracle lint, formatting,
and `git diff --check` pass. No generated build output is committed.

Production size against upstream `36f879727`: core +117B gzip, Electric +196B,
persistence +59B; total +372B gzip (+0.2%), +295B brotli. This runs the
repository size comparator with `--exact-base --no-scenarios`; no new app-scenario
claim follows. The local runtime lacks `npx`, so a temporary shell shim routes
its `vite build` calls to the installed workspace binary. The lifecycle check
uses the existing runtime generation and abort error; no extra lifecycle,
retry path, or queue is introduced. Diff cleanup against current upstream finds
no formatting-only churn or unused mechanism; all eleven existing per-file
justifications still apply.

The final focused type-only run passes all four files (126 checks, no type
errors or unhandled source errors). Expo example tsconfig warnings remain from
the filtered dependency installation and do not fail these checks. The merge
commit skips lint-staged's whole incoming-upstream formatting pass; changed
source ESLint, oracle lint, formatting, type checks and diff checks ran directly.
