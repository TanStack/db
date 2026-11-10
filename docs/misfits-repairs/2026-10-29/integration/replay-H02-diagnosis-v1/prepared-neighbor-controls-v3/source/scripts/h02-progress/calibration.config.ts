import { defineConfig } from 'vitest/config'

// Pure comparison calibration only. No receiving setup, production alias,
// production driver, QueryClient, or generated history executes here.
export default defineConfig({
  test: {
    include: [`scripts/h02-progress/checker-calibration.test.ts`],
    environment: `node`,
    pool: `forks`,
    maxWorkers: 1,
    fileParallelism: false,
    execArgv: [`--max-old-space-size=384`],
    coverage: { enabled: false },
    typecheck: { enabled: false },
  },
})
