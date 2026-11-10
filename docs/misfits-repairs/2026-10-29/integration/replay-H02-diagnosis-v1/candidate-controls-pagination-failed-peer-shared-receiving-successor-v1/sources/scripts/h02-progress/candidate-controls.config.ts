import { defineConfig } from 'vitest/config'

// Pure instrument calibration. No source aliases, receiving setup or DB imports.
export default defineConfig({
  test: {
    include: ['scripts/h02-progress/candidate-controls.test.ts'],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    execArgv: ['--max-old-space-size=384'],
    coverage: { enabled: false },
    typecheck: { enabled: false },
  },
})
