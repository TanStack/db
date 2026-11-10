import { defineConfig } from 'vitest/config'

// Pure parent process: it imports the independent judgment and child supervisor,
// with no production alias or native Collection in this test process.
export default defineConfig({
  test: {
    include: [
      'packages/query-db-collection/tests/queued-answer-completion-baseline.test.ts',
    ],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    execArgv: ['--max-old-space-size=384'],
    coverage: { enabled: false },
    typecheck: { enabled: false },
  },
})
