import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import packageJson from './package.json'

const config = defineConfig({
  test: {
    name: packageJson.name,
    dir: `./tests`,
    environment: `node`,
    // The Neon receiving driver runs a vendored adapter that targets an older
    // TanStack DB sync API. It has its own config and is expected to fail
    // until that adapter is updated (see tests/neon/README.md).
    exclude: [`**/node_modules/**`, `tests/neon/**`, `**/neon-*.test.ts`],
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({
    entry: `./src/index.ts`,
    srcDir: `./src`,
  }),
)
