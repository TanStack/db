import { resolve } from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import packageJson from './package.json'

const config = defineConfig({
  test: {
    // Shared persistence drivers and this adapter must use one transaction stack.
    alias: {
      '@tanstack/db': resolve(import.meta.dirname, `../db/src`),
      '@tanstack/db-ivm': resolve(import.meta.dirname, `../db-ivm/src`),
      '@tanstack/db-sqlite-persistence-core': resolve(
        import.meta.dirname,
        `../db-sqlite-persistence-core/src`,
      ),
    },
    // Keep the framework's Vitest API in this package's active worker.
    server: { deps: { inline: [`@tanstack/oracles`] } },
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
  }),
)
