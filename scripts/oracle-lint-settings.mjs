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
        file: `packages/browser-db-sqlite-persistence/tests/per-collection-coordinator-oracle.test.ts`,
        reason: `raw campaign with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/browser-db-sqlite-persistence/tests/shared-driver-fairness-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
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
        file: `packages/db/tests/declared-reach-oracle.property.test.ts`,
        reason: `campaign helper with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/indexed-db/cross-tab-history-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
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
        file: `packages/db/tests/proxy-revert-oracle.property.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/aggregate-select-oracle.property.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/custom-index-order-selection-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/effect-callback-oracle.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/limit-admission-oracle.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
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
        file: `packages/db/tests/utils-oracle.property.test.ts`,
        reason: `manual reach; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/node-db-sqlite-persistence/tests/expression-index-oracle.test.ts`,
        reason: `raw campaign; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
      {
        file: `packages/query-db-collection/tests/refetch-ordered-prefix-oracle.test.ts`,
        reason: `manual reach with fixed histories; preserve its laws, declared states, and run budgets during oracleProperty conversion.`,
      },
    ],
    replayWitnessModules: [`packages/db/tests/oracle-replay-witness.ts`],
  },
}
