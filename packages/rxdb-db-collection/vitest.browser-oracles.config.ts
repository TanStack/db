/** Vitest drives a real Chromium page through the common receiving host. */
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
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
    name: `rxdb-oracles-chromium`,
    include: [`tests/*-oracle.browser.test.ts`],
    environment: `node`,
    fileParallelism: false,
    coverage: { enabled: false },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
