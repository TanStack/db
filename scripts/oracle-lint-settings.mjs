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
    ],
    // Frozen migration baseline: remove entries as their files convert. Never add one.
    legacyCampaigns: [
      {
        file: `packages/db/tests/declared-reach-oracle.property.test.ts`,
        reason: `compatibility helpers are the implementation under test; the outer campaign uses oracleProperty and preserves the complete independent ledger self-test.`,
      },
      {
        file: `packages/node-db-sqlite-persistence/tests/expression-index-oracle.test.ts`,
        reason: `All product campaigns use oracleProperty. Retain only the existing fast-check seed/run/path self-checks, grammar ablations, and SQL-fault shrink-and-replay controls: native calibrations do not expose their shrink coordinates.`,
      },
    ],
    replayWitnessModules: [`packages/db/tests/oracle-replay-witness.ts`],
  },
}
