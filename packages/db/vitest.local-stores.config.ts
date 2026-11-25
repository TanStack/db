import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/** Vitest drives actual Chromium; the browser page uses native localStorage. */
export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      '@tanstack/db': resolve(import.meta.dirname, `src`),
      '@tanstack/db-ivm': resolve(import.meta.dirname, `../db-ivm/src`),
    },
  },
  test: {
    name: `local-stores-chromium`,
    include: [
      `tests/local-storage-eager-reload-oracle.browser.test.ts`,
      `tests/local-storage-receiving-cleanup.browser.test.ts`,
    ],
    environment: `jsdom`,
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: { enabled: false },
  },
})
