import { defineConfig } from 'vitest/config'
import sourceBoundConfig from './vitest.config.js'

// Separate, source-bound receiving entry. The baseline selector and its eight
// histories are unchanged. Importing this file is not an invocation admission.
export default defineConfig({
  ...sourceBoundConfig,
  test: {
    ...sourceBoundConfig.test,
    include: [
      `packages/query-db-collection/tests/queued-answer-completion.receiving.test.ts`,
    ],
    maxWorkers: 1,
    fileParallelism: false,
  },
})
