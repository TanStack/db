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
    replayWitnessModules: [`packages/db/tests/oracle-replay-witness.ts`],
  },
}
