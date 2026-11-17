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

/**
 * Oracle files that may still register plain tests, by maintainer decision:
 * "merge sooner and then remove once F33 is in" (2026-11-11), for the
 * declareOracle removal (TanStack/db #2421). `oracle/no-unit-test` is off for
 * each listed file in eslint.config.js and scripts/agent-lint-feedback.mjs.
 * `scripts/check-registration-exceptions.mjs` (part of `pnpm lint:oracles`)
 * lints each file with the rule on and fails when its report count differs
 * from `reports`, in either direction, and fails when the list grows or a
 * count rises against the merge-base. The list may only shrink: remove an
 * entry when its retiring work lands, and then the rule applies again.
 */
export const registrationExceptions = [
  {
    file: `packages/browser-db-sqlite-persistence/tests/multi-tab-electric-oracle.test.ts`,
    reports: 2,
    retiredBy: `multi-tab driver extraction`,
    why: `The it.fails known-defect witnesses for #2267 and #2209 share the 520-line runGeneratedHistory driver, which closes over describe state; they move to an ordinary known-defects file once the driver is extracted.`,
  },
  {
    file: `packages/db/tests/collection-state-retention-oracle.property.test.ts`,
    reports: 3,
    retiredBy: `F33`,
    why: `Production-running fixed-seed censuses with count minimums (seeds 86103 and 86104), which need enforced reach minimums.`,
  },
  {
    file: `packages/db/tests/collection-subscription-lifecycle-publication-oracle.property.test.ts`,
    reports: 1,
    retiredBy: `F33`,
    why: `A census of at least 5 zero-sign source writes over fixed seed 1657005.`,
  },
  {
    file: `packages/db/tests/collection-subscription-replay-oracle.property.test.ts`,
    reports: 1,
    retiredBy: `F33`,
    why: `A census of more than 0 over fixed seed 1756.`,
  },
  {
    file: `packages/db/tests/d2-source-reconciliation-oracle.property.test.ts`,
    reports: 1,
    retiredBy: `F33`,
    why: `A census of changed restarts over 500 samples of seed 1780.`,
  },
]

export const registrationExceptionDecision = `"merge sooner and then remove once F33 is in" (maintainer, 2026-11-11)`

/** The flat-config block that turns oracle/no-unit-test off for the listed files only. */
export const registrationExceptionConfig = {
  name: `db/oracle-registration-exceptions`,
  files: registrationExceptions.map(({ file }) => file),
  rules: { 'oracle/no-unit-test': `off` },
}
