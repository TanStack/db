import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@tanstack/db': resolve(import.meta.dirname, `../db/src`),
      '@tanstack/db-ivm': resolve(import.meta.dirname, `../db-ivm/src`),
      '@tanstack/db-sqlite-persistence-core': resolve(
        import.meta.dirname,
        `../db-sqlite-persistence-core/src`,
      ),
    },
  },
  test: {
    include: [`tests/cross-adapter-receiving-oracle.browser.test.ts`],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: { enabled: false },
  },
})
