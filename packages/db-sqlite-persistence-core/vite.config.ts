import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import packageJson from './package.json'

const config = defineConfig({
  test: {
    name: packageJson.name,
    include: [`tests/**/*.test.ts`],
    exclude: [`tests/sqlite-core-adapter-oracle.test.ts`],
    environment: `jsdom`,
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
    typecheck: {
      enabled: true,
      include: [`tests/**/*.test.ts`, `tests/**/*.test-d.ts`],
      // These oracles register their tests at run time through
      // oracleProperty, so the typecheck collector finds no suite in them.
      // Vitest still type-checks them through the project's tsc run.
      exclude: [
        `**/node_modules/**`,
        `tests/collection-setup-reopen-oracle.test.ts`,
        `tests/shared-logical-scheduling-oracle.test.ts`,
        `tests/persisted-reload-replacement-oracle.test.ts`,
        `tests/persisted-readiness-oracle.test.ts`,
        `tests/persisted-sync-problem-oracle.test.ts`,
        `tests/persisted-optimistic-history-oracle.property.test.ts`,
      ],
    },
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({
    entry: [`./src/index.ts`, `./src/broadcast-coordinator.ts`],
    srcDir: `./src`,
  }),
)
