import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const packageDirectory = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@tanstack/db': resolve(packageDirectory, `../db/src`),
      '@tanstack/db-ivm': resolve(packageDirectory, `../db-ivm/src`),
      '@tanstack/db-sqlite-persistence-core': resolve(
        packageDirectory,
        `../db-sqlite-persistence-core/src`,
      ),
    },
  },
  test: {
    include: [`e2e/**/*.e2e.test.ts`],
    environment: `node`,
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    typecheck: {
      enabled: false,
    },
    coverage: {
      enabled: false,
    },
  },
})
