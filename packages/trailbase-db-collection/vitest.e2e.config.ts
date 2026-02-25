import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const packagesDir = resolve(__dirname, '..')

export default defineConfig({
  test: {
    include: [`e2e/**/*.e2e.test.ts`],
    globalSetup: `./e2e/global-setup.ts`,
    fileParallelism: false, // Critical for shared database
    testTimeout: 30000,
    environment: `jsdom`,
  },
  resolve: {
    alias: {
      '@tanstack/db': resolve(packagesDir, 'db/src/index.ts'),
      '@tanstack/db-ivm': resolve(packagesDir, 'db-ivm/src/index.ts'),
      '@tanstack/db-collection-e2e': resolve(
        packagesDir,
        'db-collection-e2e/src/index.ts',
      ),
    },
  },
})
