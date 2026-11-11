import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import { commonJsDeclarations } from '../../scripts/commonjs-declarations.mjs'
import packageJson from './package.json'

const config = defineConfig({
  test: {
    // Keep the framework's Vitest API in this package's active worker.
    server: { deps: { inline: [`@tanstack/oracles`] } },
    name: packageJson.name,
    include: [`tests/**/*.test.ts`],
    environment: `jsdom`,
    // Generated fixed/random campaigns include real Collection lifecycles.
    testTimeout: 30_000,
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
    typecheck: {
      enabled: true,
      include: [`tests/**/*.test-d.ts`],
      tsconfig: `./tsconfig.test.json`,
    },
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({
    entry: [`./src/index.ts`, `./src/offline.ts`],
    srcDir: `./src`,
    beforeWriteDeclarationFile: commonJsDeclarations,
  }),
)
