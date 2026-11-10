import { defineConfig } from 'vitest/config'

// Actual Query Core ordering plus pure source-fact controls. No DB production,
// receiving setup, generated history, or progress/value comparison executes.
export default defineConfig({
  test: {
    include: [
      `packages/query-db-collection/tests/queued-answer-progress-premise-calibration.test.ts`,
    ],
    environment: `node`,
    pool: `forks`,
    maxWorkers: 1,
    fileParallelism: false,
    execArgv: [`--max-old-space-size=384`],
    coverage: { enabled: false },
    typecheck: { enabled: false },
  },
})
