import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import packageJson from './package.json'

const config = defineConfig({
  test: {
    name: packageJson.name,
    include: [`tests/**/*.test.ts`],
    exclude: [`e2e/**/*.e2e.test.ts`],
    environment: `node`,
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
    typecheck: {
      enabled: true,
      include: [`tests/**/*.test.ts`],
      // Vitest 5 fails a typecheck file with no suite. These wrappers only
      // register shared suites when they run as tests.
      exclude: [
        `**/node_modules/**`,
        `**/.git/**`,
        `tests/tauri-sql-driver-contract.test.ts`,
        `tests/tauri-sqlite-core-adapter-contract.test.ts`,
      ],
    },
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({
    entry: [`./src/index.ts`, `./src/tauri.ts`],
    srcDir: `./src`,
  }),
)
