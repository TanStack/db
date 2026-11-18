import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const packageDirectory = dirname(fileURLToPath(import.meta.url))

// These Vitest properties still drive real Chromium and OPFS. They run in the
// adapter-browser CI group, after Playwright installs its Chromium runtime.
export default defineConfig({
  root: packageDirectory,
  resolve: {
    alias: {
      '@tanstack/db': resolve(packageDirectory, `../db/src`),
      '@tanstack/db-ivm': resolve(packageDirectory, `../db-ivm/src`),
      '@tanstack/db-sqlite-persistence-core': resolve(
        packageDirectory,
        `../db-sqlite-persistence-core/src`,
      ),
      '@tanstack/query-db-collection': resolve(
        packageDirectory,
        `../query-db-collection/src`,
      ),
    },
  },
  test: {
    name: `adapter-oracles-chromium`,
    include: [
      `tests/trailbase-hydration-oracle.test.ts`,
      `tests/trailbase-eager-live-source-oracle.test.ts`,
      `tests/trailbase-browser-fidelity.test.ts`,
      `tests/opfs-fixture-cleanup.test.ts`,
      `tests/query-rejected-write-cutoff-browser-fidelity.test.ts`,
      `tests/persisted-baseline-lifecycle-oracle.test.ts`,
      `e2e/query-*-oracle.browser.test.ts`,
    ],
    environment: `jsdom`,
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: { enabled: false },
  },
})
