/**
 * The project settings that @tanstack/eslint-plugin-oracles reads from
 * `settings.oracles`. eslint.config.js and scripts/agent-lint-feedback.mjs
 * both pass them, so `pnpm lint`, the edit hooks, and the pre-commit hook
 * judge oracle files under the same settings.
 *
 * - `envPrefix`: the prefix of the oracle environment variables. It must match
 *   the `configureOracles({ envPrefix })` call in packages/db/tests/oracle-config.ts.
 * - `implementationModules`: the modules that implement replay selection, so
 *   they may read the replay variables and select a replay from configuration.
 * - `legacyCampaigns`: the shrinking list of files that retain legacy campaigns.
 * - `replayWitnessModules`: the module that writes a replay witness, whose
 *   record the standard JSON serializer writes.
 */
export const oracleLintSettings = {
  oracles: {
    envPrefix: `TANSTACK_DB_ORACLE`,
    implementationModules: [
      `packages/db/tests/oracle-config.ts`,
      `packages/db/tests/oracle-property.ts`,
      `packages/db/tests/oracle-reach.ts`,
      `packages/db/tests/oracle-campaign.ts`,
    ],
    // Frozen migration baseline: remove entries as their files convert. Never add one.
    legacyCampaigns: [
      {
        file: `packages/browser-db-sqlite-persistence/e2e/electric-source-prefix-oracle.opfs.spec.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/browser-db-sqlite-persistence/tests/browser-coordinator-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/browser-db-sqlite-persistence/tests/multi-tab-electric-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/browser-db-sqlite-persistence/tests/opfs-page-lifecycle-oracle.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/browser-db-sqlite-persistence/tests/opfs-request-order-oracle.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/browser-db-sqlite-persistence/tests/opfs-worker-diagnostics-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/browser-db-sqlite-persistence/tests/per-collection-coordinator-oracle.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/browser-db-sqlite-persistence/tests/reload-class-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/browser-db-sqlite-persistence/tests/shared-driver-fairness-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/e2e/backend-oracle.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/e2e/lazy-app-write-oracle.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/e2e/lazy-boundary-oracle.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/e2e/lazy-concurrency-oracle.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/eager-live-source-conformance-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/lazy-paging-abort-replay-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/lazy-paging-failure-history-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/lazy-paging-history-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/lazy-paging-interleaving-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/lazy-paging-load-outcome-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/lazy-paging-native-receipt-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/lazy-paging-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/lazy-paging-receipt-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/lazy-paging-revalidation-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/lazy-paging-version-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/offline-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/ownership-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/pagination-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/snapshot-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/convex-db-collection/tests/values-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-adapter-conformance/tests/neon-realtime-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-adapter-conformance/tests/reference-adapter-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-ivm/tests/distinct-incrementalization-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-ivm/tests/distinct-representative-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-ivm/tests/hash-identity-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-ivm/tests/hash-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-ivm/tests/incrementalization-law-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-ivm/tests/index-refinement-oracle.property.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-ivm/tests/murmur-stream-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-ivm/tests/operators/reduce-fast-path-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-ivm/tests/operators/topk-relation-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-ivm/tests/operators/topk-support-window-oracle.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-ivm/tests/operators/topKWithFractionalIndex-oracle.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-ivm/tests/structural-identity-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-sqlite-persistence-core/tests/ordinary-transaction-work-oracle.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-campaign-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-sqlite-persistence-core/tests/persisted-options-type-oracle.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-sqlite-persistence-core/tests/persisted-readiness-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-sqlite-persistence-core/tests/persisted-reload-replacement-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-sqlite-persistence-core/tests/persisted-sync-problem-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-sqlite-persistence-core/tests/reserved-commit-sqlite-adapter-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-sqlite-persistence-core/tests/shared-logical-scheduling-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-sqlite-persistence-core/tests/sqlite-boolean-arity-oracle.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-sqlite-persistence-core/tests/sqlite-core-adapter-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/btree-map-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/change-event-history-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/cleanup-queue-oracle.property.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/collection-cleanup-restart-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/collection-gc-mutation-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/collection-gc-retention-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/collection-metadata-publication-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/collection-state-retention-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/collection-subscription-lifecycle-history-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/collection-subscription-lifecycle-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/collection-subscription-lifecycle-publication-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/collection-subscription-replay-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/collection-sync-reentrancy-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/comparison-oracle.property.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/conformance/indexing-config-oracle.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/conformance/infinite-suite-oracle.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/conformance/public-field-oracle.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/conformance/row-snapshot-oracle.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/conformance/window-history-oracle.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/cursor-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/d2-source-reconciliation-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/declared-reach-oracle.property.test.ts`,
        reason: `campaign helper with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/flat-change-tracking-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/index-update-oracle.property.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/indexed-db/cross-tab-history-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/indexed-db/persistence-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/live-query-cache-lifecycle-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/live-query-cache-options-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/live-query-deferred-acquisition-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/live-query-observer-history-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/live-query-observer-hydration-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/live-query-observer-snapshot-oracle.property.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/live-query-preload-indexing-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/local-storage-value-fidelity-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/notification-laws-oracle.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/optimistic-history-outcomes-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/optimistic-transaction-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/oracle-campaign.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/oracle-reach.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/production-error-messages-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/proxy-detachment-contract-oracle.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/proxy-native-methods-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/proxy-revert-oracle.property.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/aggregate-select-oracle.property.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/bucket-facade-rollback-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/cold-join-reconciliation-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/compiler/group-by-pipeline-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/custom-index-order-selection-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/derived-delete-reconciliation-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/distinct-collision-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/effect-callback-oracle.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/identity-output-shape-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/includes-collection-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/includes-context-transport-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/includes-cross-formulation-oracle.property.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/includes-optimistic-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/includes-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/includes-publication-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/includes-query-shape-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/includes-work-counter-oracle.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/ir-stable-identity-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/join-result-key-oracle.property.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/limit-admission-oracle.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/load-subset-joint-replay-oracle.property.test.ts`,
        reason: `campaign helper; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/load-subset-oracle.property.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/ordered-lifecycle-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/ordered-source-loader-state-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/ordered-work-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/pagination-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/pooled-live-query-gc-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/pooled-live-query-oracle.property.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/public-container-copy-oracle.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/virtual-row-fields-effect-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/virtual-row-fields-input-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/virtual-row-fields-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/virtual-row-fields-types-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/where-predicate-publication-oracle.property.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/SortedMap-oracle.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/source-health-oracle.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/ssr-stream-record-wait-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/sync-metadata-session-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/transaction-ownership-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/utils-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/electric-db-collection/e2e/sql-predicate-semantics-oracle.e2e.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/electric-db-collection/tests/eager-live-source-conformance-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/electric-db-collection/tests/electric-descriptor-isolation-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/electric-db-collection/tests/electric-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/electric-db-collection/tests/electric-recovery-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/electric-db-collection/tests/electric-sdk-delivery-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/electric-db-collection/tests/pg-serializer-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/electron-db-sqlite-persistence/tests/reload-class-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/node-db-sqlite-persistence/tests/expression-index-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/offline-transactions/tests/leadership-replay-oracle.property.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/offline-transactions/tests/transaction-serializer-oracle.property.test.ts`,
        reason: `campaign helper with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/offline-transactions/tests/transaction-settlement-oracle.property.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/powersync-db-collection/tests/eager-live-source-conformance-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/query-db-collection/tests/cursor-pagination-oracle.integration.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/query-db-collection/tests/cursor-pagination.boundary-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/query-db-collection/tests/cursor-pagination.cache-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/query-db-collection/tests/cursor-pagination.oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/query-db-collection/tests/cursor-pagination.publication-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/query-db-collection/tests/optimistic-ordered-refetch-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/query-db-collection/tests/refetch-ordered-prefix-oracle.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/react-db/tests/cache-first-registration-oracle.test.tsx`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/react-db/tests/client-window-oracle.test.tsx`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/react-db/tests/descriptor-query-binding-oracle.test.tsx`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/react-db/tests/source-id-reuse-oracle.test.tsx`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/react-db/tests/ssr-effects-oracle.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/react-db/tests/suspense-indexing-config-oracle.test.tsx`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/react-db/tests/suspense-lifecycle-oracle.test.tsx`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/react-db/tests/suspense-local-options-oracle.test.tsx`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/react-db/tests/window-render-oracle.test.tsx`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/rxdb-db-collection/tests/eager-live-source-conformance-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/solid-db/tests/row-materialization-oracle.test.tsx`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/svelte-db/tests/cache-options-oracle.svelte.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/svelte-db/tests/client-window-oracle.svelte.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/svelte-db/tests/descriptor-start-release-oracle.svelte.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/svelte-db/tests/ssr-runtime-error-oracle.svelte.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/svelte-db/tests/ssr-snapshot-admission-oracle.svelte.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/svelte-db/tests/ssr-snapshot-handoff-oracle.svelte.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/trailbase-db-collection/tests/eager-live-source-conformance-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/trailbase-db-collection/tests/lifecycle-oracle.property.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `scripts/lint-scope-oracle.property.test.js`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `scripts/publish-history-oracle.property.test.js`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `scripts/publish-http-oracle.property.test.js`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `scripts/release-history-oracle.property.test.js`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `scripts/run-budget-oracle.property.test.js`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `scripts/strip-oracle-probes-oracle.property.test.js`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
    ],
    replayWitnessModules: [`packages/db/tests/oracle-replay-witness.ts`],
  },
}
