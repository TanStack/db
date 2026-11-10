import { defineConfig } from 'vitest/config'
export default defineConfig({
  root: "/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1/prepared-neighbor-controls-v3/native-calibration",
  test: { include: ['native-titles.test.ts'], environment: 'node', pool: 'forks', maxWorkers: 1, fileParallelism: false, execArgv: ['--max-old-space-size=384'], silent: false, reporters: ['verbose'], coverage: { enabled: false }, typecheck: { enabled: false }, testTimeout: 5000 },
})
