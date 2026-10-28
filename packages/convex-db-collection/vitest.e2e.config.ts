import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: [
      `./e2e/setup.ts`,
      `./e2e/auth-app/setup.ts`,
      `./e2e/public-pagination-setup.ts`,
    ],
    include: [`e2e/**/*.test.ts`],
    environment: `node`,
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
})
