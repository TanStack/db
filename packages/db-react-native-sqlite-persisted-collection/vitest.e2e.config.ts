import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const packageDirectory = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@tanstack/db': resolve(packageDirectory, `../db/src`),
      '@tanstack/db-ivm': resolve(packageDirectory, `../db-ivm/src`),
      '@tanstack/db-sqlite-persisted-collection-core': resolve(
        packageDirectory,
        `../db-sqlite-persisted-collection-core/src`,
      ),
    },
  },
  test: {
    include: [`e2e/**/*.e2e.test.ts`],
    fileParallelism: false,
    testTimeout: 60_000,
    environment: `jsdom`,
    setupFiles: [`./tests/helpers/mobile-runtime-test-setup.ts`],
    typecheck: {
      enabled: false,
    },
    coverage: {
      enabled: false,
    },
  },
})
