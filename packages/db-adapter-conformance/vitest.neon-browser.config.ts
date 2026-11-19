import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@tanstack/db': fileURLToPath(
        new URL(`../db/src/index.ts`, import.meta.url),
      ),
      '@tanstack/db-ivm': fileURLToPath(
        new URL(`../db-ivm/src/index.ts`, import.meta.url),
      ),
    },
  },
  test: {
    include: [`tests/neon-receiving-oracle.browser.test.ts`],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: { enabled: false },
  },
})
