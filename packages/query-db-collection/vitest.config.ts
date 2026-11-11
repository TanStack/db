import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [`e2e/**`, `**/node_modules/**`],
    typecheck: {
      enabled: true,
      include: [`tests/**/*.test.ts`],
      // oracleProperty registers runtime tests that the type-test collector
      // cannot discover. These files remain in the TypeScript program.
      exclude: [
        `tests/offline-executor-refresh-oracle.test.ts`,
        `tests/ownership-lifecycle.oracle.test.ts`,
        `tests/persisted-rejected-write-cutoff-oracle.test.ts`,
        `tests/persisted-direct-ownership-oracle.test.ts`,
        `tests/immediate-eager-materialization-oracle.test.ts`,
        `tests/scope-omission-reacquisition-oracle.test.ts`,
        `tests/ownership-settlement.oracle.test.ts`,
        `tests/ownership-bottom.oracle.test.ts`,
        `tests/ownership-upper.oracle.test.ts`,
        `tests/ownership-confirmation.oracle.test.ts`,
        `tests/documented-mutations-oracle.test.ts`,
      ],
    },
  },
})
