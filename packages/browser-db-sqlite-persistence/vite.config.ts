import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import packageJson from './package.json'

const config = defineConfig({
  // Build with relative paths so the ?worker import generates
  // new URL("../assets/worker.js", import.meta.url) instead of
  // an absolute "/assets/worker.js" path that breaks for library consumers.
  base: `./`,
  test: {
    name: packageJson.name,
    include: [`tests/**/*.test.ts`],
    environment: `node`,
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
    entry: `./src/index.ts`,
    srcDir: `./src`,
  }),
)
