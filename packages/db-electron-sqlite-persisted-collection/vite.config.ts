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
    testTimeout: runElectronFullE2E ? 30_000 : undefined,
    hookTimeout: runElectronFullE2E ? 60_000 : undefined,
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
    typecheck: {
      enabled: true,
      include: [`tests/**/*.test.ts`, `tests/**/*.test-d.ts`],
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
