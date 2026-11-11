import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import packageJson from './package.json'

const config = defineConfig({
  test: {
    // Keep the framework's Vitest API in this package's active worker.
    server: { deps: { inline: [`@tanstack/oracles`] } },
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
      exclude: [`tests/documented-mutations-oracle.test.ts`],
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
