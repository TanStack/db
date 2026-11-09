import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import { commonJsDeclarations } from '../../scripts/commonjs-declarations.mjs'
import { stripOracleProbes } from '../../scripts/strip-oracle-probes.mjs'
import packageJson from './package.json'

const config = defineConfig({
  // The published build carries no oracle state probes.
  plugins: [stripOracleProbes()],
  test: {
    name: packageJson.name,
    dir: `./tests`,
    environment: `jsdom`,
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
    typecheck: { enabled: true },
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({
    entry: `./src/index.ts`,
    srcDir: `./src`,
    beforeWriteDeclarationFile: commonJsDeclarations,
  }),
)
