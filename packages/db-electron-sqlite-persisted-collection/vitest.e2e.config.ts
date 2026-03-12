import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const packageDirectory = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@tanstack/db': resolve(packageDirectory, `../db/src`),
      '@tanstack/db-ivm': resolve(packageDirectory, `../db-ivm/src`),
      '@tanstack/db-node-sqlite-persisted-collection': resolve(
        packageDirectory,
        `../db-node-sqlite-persisted-collection/src`,
      ),
      '@tanstack/db-sqlite-persisted-collection-core': resolve(
        packageDirectory,
        `../db-sqlite-persisted-collection-core/src`,
      ),
    },
  },
  test: {
    include: [`tests/**/*.e2e.test.ts`],
    environment: `node`,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    typecheck: {
      enabled: false,
    },
    coverage: {
      enabled: false,
    },
  },
})
