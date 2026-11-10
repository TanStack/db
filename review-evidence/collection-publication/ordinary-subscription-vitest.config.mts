import ordinary from '/Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db/packages/db/vite.config.ts'
import { mergeConfig } from '/Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db/node_modules/vitest/dist/config.js'
export default mergeConfig(ordinary, {
  cacheDir: '/tmp/collection-subscription-supplemental-vite-cache',
  resolve: {
    alias: [
      {
        find: '@tanstack/db-ivm',
        replacement:
          '/Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db/packages/db-ivm/src/index.ts',
      },
    ],
  },
})
