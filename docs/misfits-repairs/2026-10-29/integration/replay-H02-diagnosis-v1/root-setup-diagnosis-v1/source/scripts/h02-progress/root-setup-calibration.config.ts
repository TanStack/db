import { defineConfig } from 'vitest/config'

// Match the receiving runner's client/jsdom transform without importing its
// setup instrument, production aliases, supervisor, driver, or oracle tests.
export default defineConfig({
  test: {
    include: [`scripts/h02-progress/root-setup-calibration.test.ts`],
    environment: `jsdom`,
    pool: `forks`,
    maxWorkers: 1,
    fileParallelism: false,
    execArgv: [`--max-old-space-size=384`],
    coverage: { enabled: false },
    typecheck: { enabled: false },
  },
})
