import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import packageJson from './package.json'

const config = defineConfig({
  test: {
    name: packageJson.name,
    include: [`tests/**/*.test.ts`],
    exclude: [`e2e/**/*.e2e.test.ts`],
    environment: `node`,
    setupFiles: [`./tests/helpers/mobile-runtime-test-setup.ts`],
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
    typecheck: {
      enabled: true,
      include: [`tests/**/*.test.ts`, `tests/**/*.test-d.ts`],
      // Vitest 5 fails a typecheck file with no suite. These wrappers only
      // register shared suites when they run as tests.
      exclude: [
        `**/node_modules/**`,
        `**/.git/**`,
        `tests/expo-sqlite-core-adapter-contract.test.ts`,
        `tests/expo-sqlite-driver-contract.test.ts`,
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
