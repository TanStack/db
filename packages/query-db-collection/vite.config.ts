import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import packageJson from './package.json'

const config = defineConfig({
  test: {
    name: packageJson.name,
    include: [`tests/**/*.test.ts`],
    exclude: [`e2e/**/*`],
    environment: `jsdom`,
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
    typecheck: {
      enabled: true,
      include: [`tests/**/*.test.ts`, `tests/**/*.test-d.ts`],
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
      ],
    },
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({
    entry: `./src/index.ts`,
    srcDir: `./src`,
  }),
)
