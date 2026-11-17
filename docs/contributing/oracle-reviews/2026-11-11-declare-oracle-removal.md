# Removal of declareOracle: conversion record (2026-11-11)

Maintainer decision, 2026-11-11: `declareOracle` is deleted from
`@tanstack/oracles`. Two laws replace it:

- **D2.** An oracle file registers its tests only through `oracleProperty`.
  `oracle/no-unit-test` reports every other test registration in a file
  whose name contains `oracle`.
- **O1.** The gap report reads `owns` from an object-literal argument of any
  call in a test file. A wrapper forwards its `owns` to `oracleProperty`.

This record lists what the conversion moved, renamed, and left open. It
changes no product law. Each converted registration keeps its production
path, its inputs, its comparisons, and their checkpoints, except where this
record says otherwise.

## Open items: D2 exceptions for the maintainer

These sites still register plain tests in oracle files. `oracle/no-unit-test`
reports each one. None is a quiet exclusion: each is recorded here with its
reason and owner.

| Site | Kind | Why it is not converted | Proposed resolution |
| --- | --- | --- | --- |
| `packages/browser-db-sqlite-persistence/tests/multi-tab-electric-oracle.test.ts`, "keeps a resumed lagging tab out of error when a peer deleted the row it updates" | `it.fails` known-defect witness, [#2267](https://github.com/TanStack/db/issues/2267) | Its driver, `runGeneratedHistory` (about 520 lines), closes over the describe's mutable host, stream, and reach state, so it cannot move to an ordinary known-defects file unchanged. | Extract the driver into a companion module, then move the witness to `multi-tab-electric-known-defects.test.ts`. Trace: `{ tabCount: 2, steps: [recover tab 1 pick 0; server change key 2 pick 1; server change key 1 pick 0; server change key 2 pick 0; server change key 1 pick 0; advance tab 0 pick 0] }`. |
| same file, "converges an open tab to the head after a lagging tab commits an older row and closes" | `it.fails` known-defect witness, [#2209](https://github.com/TanStack/db/issues/2209) | Same driver. | Same. Trace: `{ tabCount: 2, steps: [server change key 1 pick 1; catch up tab 0 pick 0; server change key 1 pick 1; catch up tab 0 pick 0; catch up tab 1 pick 1; close tab 1] }`. |
| `packages/db/tests/collection-subscription-lifecycle-publication-oracle.property.test.ts`, "reaches a zero-sign source write in the fixed campaign" (at least 5 over seed 1657005) | Production-running reach census with a count minimum | The framework's declared reach has no minimum above 1. | F33: an enforced per-state minimum in `measured` of a generated source with fixed seeds, under law `reach minimum` (maintainer decision, 2026-11-11). |
| `packages/db/tests/collection-subscription-replay-oracle.property.test.ts` census (more than 0 over seed 1756) | Same | Same | F33 |
| `packages/db/tests/collection-state-retention-oracle.property.test.ts`, three censuses over seeds 86103 and 86104 (inserts > 0; deletes > absent deletes > 0; distinguishing partial updates > 0; zero-sign > 0) | Same | Same. "deletes > absent deletes" is "a present-row delete" at least once. | F33, with each relation as a state |
| `packages/db/tests/d2-source-reconciliation-oracle.property.test.ts`, "executes changed down-state sources and checks their restart replay" (500 samples, seed 1780, changed restarts > 0) | Same | Same | F33, as a second property with its own seed and run count |

## Census hooks that stay pending F33

These production-running census hooks are `afterEach` or `afterAll` hooks,
not registrations, so the lint rule does not report them. They keep their
minimums unchanged until F33 adds enforced minimums:

- `packages/query-db-collection/tests/refetch-ordered-prefix-oracle.test.ts`:
  census hooks on its three generated properties (minimums 24, 3, and more
  than 0).
- `packages/electric-db-collection/tests/electric-sdk-delivery-oracle.property.test.ts`:
  three `afterEach` hooks that require every declared state at least once on
  `sdk-snapshot-delivery`, `sdk-rotation-release`, and `sdk-source-release`.
- `packages/electric-db-collection/tests/electric-oracle.property.test.ts`:
  the mutation-confirmation `afterAll` (every case at least once).
- `packages/electric-db-collection/e2e/sql-predicate-semantics-oracle.e2e.test.ts`:
  `executedCells === oracleRuns(50)` and the required reach on seed 1814.
- `packages/offline-transactions/tests/transaction-settlement-oracle.property.test.ts`:
  the restored-history `afterAll` (exact set of reached checkpoints).

## Resolved during integration

- The generated-construction guard in the Query and Chromium
  scope-omission oracles (`it.skipIf(oracleReplayRequested())` around
  `calibrateGeneratedConstructions`) is removed. The property's fixed seed is
  the guard's seed, 1313; every `build()` records its obligations; and the
  native calibrations `omits state <s>` remove exactly that reach fact from a
  constructed history under law `constructed reach`. A mutant `build()` that
  records no obligation fails all six native calibrations.
- Two closure-runner properties in db-collection, three sweeps in
  db-sqlite-persistence-core, and `sqlite-ordinary.fixed-cases` became
  enumerated sources: one history per scenario, with each required reach
  fact a declared state.
- `electric.design-witnesses` selects four named procedures through a data
  history. Three compare production with the model's recomputation and stay.
  The fourth, the authored HTTP transcript, compares production with
  authored transcripts and snapshots, so it belongs in an ordinary file. It
  is listed as a follow-up: moving it needs its trace helpers extracted from
  the oracle file.

## Known-defect witnesses in ordinary files

| File | Defect | Oracle owner |
| --- | --- | --- |
| `packages/db-sqlite-persistence-core/tests/persisted-known-defects.test.ts` (8 `it.fails`) | [#2139](https://github.com/TanStack/db/issues/2139), rotated follower recovery | `persisted-oracle.test.ts`, through `persisted-follower-recovery-oracle.ts` |
| `packages/query-db-collection/tests/refetch-ordered-prefix-known-defects.test.ts` (2 `it.fails`) | The open coverage-map items "Offset-only providers under a joined ordered window" and "A page-capping provider during an ordered repair" | `refetch-ordered-prefix-oracle.test.ts`, through `refetch-ordered-prefix-driver-oracle.ts` |

## Receiving witnesses (renamed `*-witness.*`)

`oracleProperty` registers through Vitest, and its main entry is Node-only.
Specs that run in Playwright, and suites that the Capacitor and Tauri WebView
apps bundle, keep their plain tests. Each compares production with the shared
check of its Vitest oracle owner. ESLint applies every oracle rule except
`no-unit-test` to them (`db/receiving-witnesses` in `eslint.config.js`). A
witness is not an oracle file, so the gap report does not credit its tests.
The two Vitest e2e witnesses, `install-layout` and `opfs-open-outcome`, lose
their `owns` lists for that reason.

- `packages/browser-db-sqlite-persistence/e2e/eager-gap-conformance-oracle.opfs.spec.ts` → `packages/browser-db-sqlite-persistence/e2e/eager-gap-conformance-witness.opfs.spec.ts`
- `packages/browser-db-sqlite-persistence/e2e/electric-source-prefix-oracle.opfs.spec.ts` → `packages/browser-db-sqlite-persistence/e2e/electric-source-prefix-witness.opfs.spec.ts`
- `packages/browser-db-sqlite-persistence/e2e/install-layout-oracle.e2e.test.ts` → `packages/browser-db-sqlite-persistence/e2e/install-layout-witness.e2e.test.ts`
- `packages/browser-db-sqlite-persistence/e2e/leader-close-oracle.opfs.spec.ts` → `packages/browser-db-sqlite-persistence/e2e/leader-close-witness.opfs.spec.ts`
- `packages/browser-db-sqlite-persistence/e2e/opfs-open-outcome-oracle.e2e.test.ts` → `packages/browser-db-sqlite-persistence/e2e/opfs-open-outcome-witness.e2e.test.ts`
- `packages/browser-db-sqlite-persistence/e2e/opfs-request-order-oracle.opfs.spec.ts` → `packages/browser-db-sqlite-persistence/e2e/opfs-request-order-witness.opfs.spec.ts`
- `packages/browser-db-sqlite-persistence/e2e/persisted-startup-conformance-oracle.opfs.spec.ts` → `packages/browser-db-sqlite-persistence/e2e/persisted-startup-conformance-witness.opfs.spec.ts`
- `packages/browser-db-sqlite-persistence/e2e/reload-class-oracle.opfs.spec.ts` → `packages/browser-db-sqlite-persistence/e2e/reload-class-witness.opfs.spec.ts`
- `packages/browser-db-sqlite-persistence/e2e/shared-driver-fairness-oracle.opfs.spec.ts` → `packages/browser-db-sqlite-persistence/e2e/shared-driver-fairness-witness.opfs.spec.ts`
- `packages/db-collection-e2e/src/suites/joins-oracle.suite.ts` → `packages/db-collection-e2e/src/suites/joins-witness.suite.ts`
- `packages/db-collection-e2e/src/suites/live-updates-oracle.suite.ts` → `packages/db-collection-e2e/src/suites/live-updates-witness.suite.ts`
- `packages/db-collection-e2e/src/suites/pagination-oracle.suite.ts` → `packages/db-collection-e2e/src/suites/pagination-witness.suite.ts`
- `packages/db-collection-e2e/src/suites/predicates-oracle.suite.ts` → `packages/db-collection-e2e/src/suites/predicates-witness.suite.ts`
- `packages/db/e2e/indexed-db/cross-tab-oracle.spec.ts` → `packages/db/e2e/indexed-db/cross-tab-witness.spec.ts`
- `packages/db/e2e/indexed-db/value-oracle.spec.ts` → `packages/db/e2e/indexed-db/value-witness.spec.ts`

## Tests moved to ordinary files

Each group's own move list follows. A moved test keeps its body and its
assertions; only `oracleRoute` is removed. These tests run no production, or
compare production with written values, so they never close a gap.

### db-core

In each case the test bodies are unchanged and `oracleRoute` is removed.

| From | To |
|---|---|
| `proxy-detachment-contract-oracle.test.ts`: own-data-property calibration ×4, accepts a native cyclic snapshot ×4, rejects a fault in a cyclic snapshot ×12 | `proxy-detachment-calibration.test.ts` |
| `proxy-revert-oracle.property.test.ts`: 3 fixed-seed censuses | `proxy-revert-census.test.ts` |
| `conformance/window-history-oracle.ts`: "rejects a pending keyed map…", "retained subscriptions distinguish…" | `conformance-window-history-calibration.test.ts` |
| `duration-query-equality-oracle.test.ts`: "calibrates all ten fields…" | `duration-query-equality-calibration.test.ts` |
| `conformance/indexing-reuse-oracle.test.ts`: both tests | `conformance/indexing-reuse-calibration.test.ts` |

The rest of db-core's moves are the renamed calibration files in the inventory below.

**New test-free companions:** `proxy-revert-model-oracle.ts`, `duration-query-equality-model-oracle.ts`, `production-error-messages-docs-oracle.ts`, `live-query-cache-lifecycle-model-oracle.ts`. **New support module:** `calibration-rejection.ts`.

### db-query-ordered

All files below are in `packages/db/tests/query/`. Each moved test keeps its old describe name, minus `oracleRoute`.

| From | To | Tests |
|---|---|---|
| where-predicate-publication-oracle.property.test.ts | where-predicate-publication-model.test.ts | "fixed snapshot histories distinguish Kleene logic from two-valued logic" |
| ordered-source-loader-oracle.test.ts | ordered-source-loader-model.test.ts | "enumerates every staged-boundary explicit-window cell exactly once" |
| custom-index-order-selection-oracle.test.ts | custom-index-order-selection-model.test.ts | "rejects wrong output-indexing observations: %j" (15 cases) |
| load-subset-oracle.property.test.ts | load-subset-model.test.ts | "uses SQL unknown for nullish comparisons in the independent model"; "generates repeated, cursor, empty, and unbounded exact demands" |
| ordered-source-loader-state-oracle.test.ts | ordered-source-loader-state-model.test.ts | "rejects a retirement start observed %s" (2 cases) |
| pagination-oracle.property.test.ts | pagination-recomputation.test.ts | 18 literal-expectation sites, 25 tests. Two named drivers moved with them: `expectInflightRequestFillsNewWindow`, `expectOnDemandWindowsAreCompletionOrderIndependent`. |
| pagination-oracle.property.test.ts | pagination-model.test.ts | "rejects the right NaN window members in the wrong order"; "rejects a malformed bounded-repair request trace"; "distinguishes a filtered full-source fallback from a repair tie predicate"; the model halves of the eager NaN window cells and the filter-update cells |
| ordered-work-oracle.property.test.ts | ordered-work-examples.test.ts | 29 tests: the grammar-size check, 17 literal-expectation tests, 4 no-production checker calibrations, and the no-production full-join census |
| ordered-lifecycle-oracle.property.test.ts | ordered-lifecycle-model.test.ts | 8 tests: 5 grammar-size checks, the Promise-wrapped observation calibration, the palette anchor, and "generates the nullable value and lifecycle dimensions" (seed 93472, 100 runs) |

Each new ordinary file has its own id counter. The counters only make collection ids unique.

### db-query-includes

1. **includes-functional-projection-oracle → includes-functional-projection.test.ts:**
   - covers the declared output and renamed-field products
   - covers every declared boundary product without duplicate cells
2. **includes-cross-formulation-oracle → includes-cross-formulation.test.ts:**
   - bounded grammar axes distinguish routes, order, partitions, and windows
   - TLP checker rejects a wrong branch even when the union is complete
3. **includes-temporal-oracle → includes-temporal.test.ts:**
   - rejects an obsolete child row at the first scheduled checkpoint
   - rejects a failed release that suppresses reacquisition
4. **includes-context-transport-oracle → includes-context-transport.test.ts:**
   - expands every declared product without duplicate cells
   - expands every declared input boundary without duplicates
   - rejects lost children and cross-parent reuse at the public checkpoint
   - rejects missing and duplicated joined contributions
5. **virtual-row-fields-effect-oracle → new virtual-row-fields-effect.test.ts:**
   - rejects a hostile Effect metadata ledger: %s (12 cases)
   - permits reordered delivery and fresh opaque keys after an exit
   - permits empty callback partitions while preserving exact delta events
   - records scalar callback values before later object mutation
   - preserves later interval judgments after an invalid unknown update
   - The fixtures `calibrationRows` and `calibrationLedger` moved with these tests.
6. **virtual-row-fields-input-oracle → new virtual-row-fields-input.test.ts:**
   - rejects a hostile callback-input observation (8 cases)
   - rejects a hostile derived ordinary output (5 cases)
   - copies callback input before later source objects change
   - accepts readable inherited source metadata at callback input
   - copies nested callback values before later child objects change
   - rejects an inherited replacement for an authored inline field (2 cases)
   - rejects an extra own field on an inline array (2 cases)
   - The `sourceFact` fixture moved with these tests.
7. **virtual-row-fields-oracle → virtual-row-fields.test.ts:**
   - rejects source metadata on a grouped output (4 cases)
   - rejects a hostile complete metadata result (14 cases)
   - rejects a hostile metadata publication (8 cases)
   - rejects facade enrichment of an inline value (4 cases)
   - rejects a hostile nullable whole-row observation (3 cases)
8. **includes-collection-oracle → includes-collection.test.ts:**
   - rejects a hostile facade interval observation (6 cases)
9. **includes-work-counter-oracle → includes-work-counter.test.ts:**
   - reaches every window dimension in the executed fixed cases. This is a grammar-only census that runs no production: at least 3 per premise, seed 2137, 60 runs.
   - rejects a source payload mutated in place (4 cases)
10. **includes-oracle.property → new includes-history-grammar.test.ts:**
    - the sibling topology targets rows under one parent
    - the descendant remains attached before its ancestor moves
    - reconstructs every supported two-transition placement (grammar census, seed 1725)
    - keeps each route-history topology and destination in the grammar
    - reconstructs and distinguishes the split/atomic batch matrix
    - keeps retired-route and moved-child matrix cuts distinct (grammar census, seeds 1726, 1733, 1727)

**New test-free companion modules.** Each holds definitions moved unchanged from its oracle file. None registers tests, and no ordinary file imports an oracle file.
- `includes-cross-formulation-model-oracle.ts`
- `includes-temporal-check-oracle.ts`
- `includes-context-transport-model-oracle.ts`
- `virtual-row-fields-effect-model-oracle.ts`
- `virtual-row-fields-model-oracle.ts`
- `includes-work-counter-model-oracle.ts`
- `includes-history-grammar-oracle.ts`

### frameworks-ivm

All paths below are under `packages/`. Each test was moved without edits except that `oracleRoute` was removed.

**db-ivm:**
- `reaches every kind, mutation, and verdict in the fixed campaign`: `db-ivm/tests/hash-identity-oracle.property.test.ts` → `db-ivm/tests/hash-identity-grammar.test.ts`.
- `generates ordered histories that promote retained rows`, `rejects invalid negative and duplicate-key input states`, and `rejects omitted, sign-flipped, wrong-member, wrong-window, wrong-limit, missing-promotion, and truthiness-filtered output`: `incrementalization-law-oracle.property.test.ts` → `db-ivm/tests/incrementalization-law-calibration.test.ts`.
- `reaches cancelled NaN-prefixed values beside other values`: `index-refinement-oracle.property.test.ts` → `db-ivm/tests/index-refinement-grammar.test.ts`.
- `rejects a representative absent from source inputs` (from distinct-representative) and `rejects omitted, duplicate and wrong-member snapshots` (from distinct-incrementalization) → `db-ivm/tests/distinct-calibration.test.ts`.
- `rejects end-relative slicing and offset-first clamping` and `rejects excess signed weight %s across a moved window`: `operators/topk-support-window-oracle.test.ts` → `db-ivm/tests/operators/topk-support-window-calibration.test.ts`.

**react-db:**
- `rejects wrong descriptor release observation: %s` (×4): source-id-reuse → `react-db/tests/source-id-reuse-release-calibration.test.tsx`.
- `distinguishes a client-layout diagnostic from unrelated messages`: ssr-effects → `react-db/tests/ssr-effects-calibration.test.ts`.
- `rejects wrong multi-source release observation: %s` (×4): descriptor-start-release → `react-db/tests/descriptor-start-release-calibration.test.tsx`.
- `schema judgment rejects wrong binding and mutation observations %j` (×72), with its `observationFromModel` helper: bound-schema-options → `react-db/tests/bound-schema-options-calibration.test.tsx`.

### sqlite

- `opfs-open-outcome-oracle.test.ts`: "reaches every outcome that this driver controls" → `opfs-open-outcome-jsdom-grammar.test.ts`
- `expression-index-oracle.test.ts`: "reconstructs the retained generated grammar…" and "rejects the generated grammar when the %s axis is ablated" → `expression-index-grammar.test.ts`
- `sqlite-temporal-value-oracle.test.ts`: "distinguishes type and value for $0" and "rejects missing, duplicate, and reversed query results" → `sqlite-temporal-value-calibration.test.ts`
- `persisted-demand-coverage-campaign-oracle.test.ts`: "rejects observations that ignore lost rows…" → `persisted-demand-coverage-campaign-calibration.test.ts`
- `persisted-demand-coverage-oracle.test.ts`: "rejects wrong observations at a checkpoint", "distinguishes the law from the wrong design: %s", "enumerates every declared cell once" → `persisted-demand-coverage-calibration.test.ts`
- `shared-driver-fairness-oracle.test.ts`: "reconstructs the known persist-first witness…", "proves tail-order ablation…", "calibrates the checker against a synthetic persist-first observation" → `shared-driver-fairness-grammar.test.ts`
- `ordinary-transaction-work-oracle.ts`: "reconstructs the bounded generated action-history axes", "reconstructs independent-key work shapes and host caps", "calibrates the complete-observation comparison" → `ordinary-transaction-work-calibration.test.ts`
- `per-collection-coordinator-oracle.test.ts`: the 7 "calibrates …" tests (clone checker, acknowledgement, collection-scoped acquisition, lease checker, SQLite-state/fresh-registry, collection-key comparison, owner checker) → `per-collection-coordinator-calibration.test.ts`
- `persisted-oracle.test.ts`: "reconstructs the full grammar and rejects ablated…", "rejects named wrong answer: $name", "append-only transaction judgment rejects omission and reordering", "rejects an evidence-coupled on-demand hydration mutant" → `persisted-model-calibration.test.ts`

### adapters

- **offline:**
  - `transaction-settlement-oracle` "rejects a wrong restored observation: %s" → `transaction-settlement-restored-model.test.ts`
  - `leadership-replay-oracle` "append-only replay judgment rejects stale admission…" → `leadership-replay-ledger-model.test.ts`
- **convex:**
  - `lazy-paging-revalidation-oracle` (2 model calibrations) → `lazy-paging-revalidation-model.test.ts`
  - `lazy-paging-interleaving-oracle` "permits core fulfillment after abort…" → `lazy-paging-interleaving-model.test.ts`
  - `lazy-paging-oracle` "rejects wrong coverage and transient windows…" → `lazy-paging-model.test.ts`
  - `lazy-paging-oracle` "rejects invalid lazy row caps before readiness: %s" → `lazy-paging-config.test.ts`
  - `lazy-paging-version-oracle` "allows stuttering…" → `lazy-paging-version-model.test.ts`
  - `lazy-paging-failure-history-oracle` "rejects old graphs…" → `lazy-paging-failure-history-model.test.ts`
  - `pagination-oracle` "calibrates complete monotone snapshots at %s" → `pagination-trace.test.ts`
  - `lazy-paging-write-model-oracle.test.ts` (2 tests) → renamed to `lazy-paging-write-model.test.ts`, and removed from `test:oracles` in `package.json`
- **query:**
  - `cursor-pagination.oracle` "preserves ties, filtering and reverse total order" and "rejects capped-page, wrong-order and duplicate-row answers" (with `checkRead`) → `cursor-pagination-reference.test.ts`
  - `optimistic-ordered-refetch-oracle` "rejects ordered wrong observation: %s" → `optimistic-ordered-refetch-calibration.test.ts`
  - The structural census's `>= 48` size check → a new test in `refetch-ordered-prefix.test.ts`
- **electric:**
  - pg-serializer decoder half (7) and "rejects $name" (13) → `pg-serializer-calibration.test.ts`
  - "models a same-key %s…" → `electric-recovery-durable-row.test.ts`
  - "fixed recovery corpus reaches every deletion and reload combination" (grammar-only census) → `electric-recovery-publication-grammar.test.ts`
  - 5 grammar and wrong-answer tests from `electric-oracle` → `electric-adapter-grammar.test.ts`

### Inventory: new ordinary test files

- `packages/browser-db-sqlite-persistence/tests/opfs-open-outcome-jsdom-grammar.test.ts`
- `packages/browser-db-sqlite-persistence/tests/per-collection-coordinator-calibration.test.ts`
- `packages/browser-db-sqlite-persistence/tests/shared-driver-fairness-grammar.test.ts`
- `packages/convex-db-collection/tests/lazy-paging-config.test.ts`
- `packages/convex-db-collection/tests/lazy-paging-failure-history-model.test.ts`
- `packages/convex-db-collection/tests/lazy-paging-interleaving-model.test.ts`
- `packages/convex-db-collection/tests/lazy-paging-model.test.ts`
- `packages/convex-db-collection/tests/lazy-paging-revalidation-model.test.ts`
- `packages/convex-db-collection/tests/lazy-paging-version-model.test.ts`
- `packages/convex-db-collection/tests/lazy-paging-write-model.test.ts`
- `packages/convex-db-collection/tests/pagination-trace.test.ts`
- `packages/db-ivm/tests/distinct-calibration.test.ts`
- `packages/db-ivm/tests/hash-identity-grammar.test.ts`
- `packages/db-ivm/tests/incrementalization-law-calibration.test.ts`
- `packages/db-ivm/tests/index-refinement-grammar.test.ts`
- `packages/db-ivm/tests/operators/topk-support-window-calibration.test.ts`
- `packages/db-sqlite-persistence-core/tests/ordinary-transaction-work-calibration.test.ts`
- `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-calibration.test.ts`
- `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-campaign-calibration.test.ts`
- `packages/db-sqlite-persistence-core/tests/persisted-known-defects.test.ts`
- `packages/db-sqlite-persistence-core/tests/persisted-model-calibration.test.ts`
- `packages/db-sqlite-persistence-core/tests/sqlite-temporal-value-calibration.test.ts`
- `packages/db/tests/collection-gc-retention-calibration.test.ts`
- `packages/db/tests/collection-row-metadata-composition.test.ts`
- `packages/db/tests/collection-subscription-lifecycle-grammar.test.ts`
- `packages/db/tests/conformance-window-history-calibration.test.ts`
- `packages/db/tests/conformance/indexing-reuse-calibration.test.ts`
- `packages/db/tests/db-client-hydration-authority.test.ts`
- `packages/db/tests/documented-mutations-calibration.test.ts`
- `packages/db/tests/duration-query-equality-calibration.test.ts`
- `packages/db/tests/indexed-db/cross-tab-calibration.test.ts`
- `packages/db/tests/indexed-db/persistence-values-calibration.test.ts`
- `packages/db/tests/live-query-cache-lifecycle-calibration.test.ts`
- `packages/db/tests/live-query-cache-options-calibration.test.ts`
- `packages/db/tests/mutation-confirmation-calibration.test.ts`
- `packages/db/tests/notification-laws-calibration.test.ts`
- `packages/db/tests/production-error-messages-calibration.test.ts`
- `packages/db/tests/proxy-detachment-calibration.test.ts`
- `packages/db/tests/proxy-revert-census.test.ts`
- `packages/db/tests/query/custom-index-order-selection-model.test.ts`
- `packages/db/tests/query/includes-history-grammar.test.ts`
- `packages/db/tests/query/load-subset-model.test.ts`
- `packages/db/tests/query/ordered-lifecycle-model.test.ts`
- `packages/db/tests/query/ordered-source-loader-model.test.ts`
- `packages/db/tests/query/ordered-source-loader-state-model.test.ts`
- `packages/db/tests/query/ordered-work-examples.test.ts`
- `packages/db/tests/query/pagination-model.test.ts`
- `packages/db/tests/query/pagination-recomputation.test.ts`
- `packages/db/tests/query/virtual-row-fields-effect.test.ts`
- `packages/db/tests/query/virtual-row-fields-input.test.ts`
- `packages/db/tests/query/where-predicate-publication-model.test.ts`
- `packages/electric-db-collection/tests/electric-adapter-grammar.test.ts`
- `packages/electric-db-collection/tests/electric-recovery-durable-row.test.ts`
- `packages/electric-db-collection/tests/electric-recovery-publication-grammar.test.ts`
- `packages/node-db-sqlite-persistence/tests/expression-index-grammar.test.ts`
- `packages/offline-transactions/tests/leadership-replay-ledger-model.test.ts`
- `packages/offline-transactions/tests/transaction-settlement-restored-model.test.ts`
- `packages/query-db-collection/tests/cursor-pagination-reference.test.ts`
- `packages/query-db-collection/tests/optimistic-ordered-refetch-calibration.test.ts`
- `packages/query-db-collection/tests/refetch-ordered-prefix-known-defects.test.ts`
- `packages/react-db/tests/bound-schema-options-calibration.test.tsx`
- `packages/react-db/tests/descriptor-start-release-calibration.test.tsx`
- `packages/react-db/tests/source-id-reuse-release-calibration.test.tsx`
- `packages/react-db/tests/ssr-effects-calibration.test.ts`
