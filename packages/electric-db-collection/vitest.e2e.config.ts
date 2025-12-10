import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [`e2e/**/*.e2e.test.ts`],
    globalSetup: `../db-collection-e2e/support/global-setup.ts`,
    fileParallelism: false, // Critical for shared database
    testTimeout: 30000,
    environment: `jsdom`,
  },
})
