import { defineConfig } from 'vitest/config'

// Match the receiving runner's client/jsdom transform without importing its
// setup instrument, production aliases, driver, or oracle tests. Tests call
// only the supervisor's pure root guard; they never invoke receiving.
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
