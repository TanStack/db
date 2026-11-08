import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import packageJson from './package.json'

const runElectronFullE2E = process.env.TANSTACK_DB_ELECTRON_E2E_ALL === `1`

const config = defineConfig({
  test: {
    name: packageJson.name,
    include: [`tests/**/*.test.ts`],
    exclude: [`tests/**/*.e2e.test.ts`],
    environment: `node`,
    fileParallelism: !runElectronFullE2E,
    testTimeout: runElectronFullE2E ? 120_000 : undefined,
    hookTimeout: runElectronFullE2E ? 180_000 : undefined,
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
    typecheck: {
      enabled: true,
      include: [`tests/**/*.test.ts`, `tests/**/*.test-d.ts`],
      // Vitest 5 fails a typecheck file with no suite. These wrappers only
      // register shared suites when they run as tests.
      exclude: [
        `**/node_modules/**`,
        `**/.git/**`,
        `tests/electron-persisted-collection.e2e.test.ts`,
        `tests/electron-runtime-bridge.e2e.test.ts`,
        `tests/electron-sqlite-core-adapter-contract.test.ts`,
      ],
    },
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({
    entry: [`./src/index.ts`, `./src/main.ts`, `./src/renderer.ts`],
    srcDir: `./src`,
  }),
)
