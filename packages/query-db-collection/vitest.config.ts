import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [`e2e/**`, `**/node_modules/**`],
    typecheck: {
      enabled: true,
      include: [`tests/**/*.test.ts`],
      // oracleProperty registers runtime tests that the type-test collector
      // cannot discover. The file remains in the TypeScript program.
      exclude: [`tests/offline-executor-refresh-oracle.test.ts`],
    },
  },
})
