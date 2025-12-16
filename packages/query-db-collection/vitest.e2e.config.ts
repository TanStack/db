import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [`e2e/**/*.e2e.test.ts`],
    fileParallelism: false,
    testTimeout: 30000,
    environment: `jsdom`,
  },
})
