import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [`tests/**/*.e2e.test.ts`],
    environment: `node`,
    fileParallelism: false,
    testTimeout: 60_000,
    typecheck: {
      enabled: false,
    },
    coverage: {
      enabled: false,
    },
  },
})
