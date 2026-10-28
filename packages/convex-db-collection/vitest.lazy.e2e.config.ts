import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: [`./e2e/setup.ts`],
    include: [
      `e2e/lazy-paging-oracle.test.ts`,
      `e2e/lazy-concurrency-oracle.test.ts`,
      `e2e/lazy-boundary-oracle.test.ts`,
      `e2e/lazy-app-write-oracle.test.ts`,
    ],
    environment: `node`,
    testTimeout: 60000,
    fileParallelism: false,
  },
})
