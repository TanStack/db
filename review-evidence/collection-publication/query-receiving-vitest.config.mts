import ordinary from '/Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db/packages/query-db-collection/vite.config.ts'
import { mergeConfig } from '/Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db/node_modules/vitest/dist/config.js'
export default mergeConfig(ordinary, {
  cacheDir: '/tmp/collection-publication-query-vite-cache',
  resolve: { alias: [
    { find: /^@tanstack\/db$/, replacement: '/Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db/packages/db/src/index.ts' },
    { find: /^@tanstack\/db-ivm$/, replacement: '/Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db/packages/db-ivm/src/index.ts' },
    { find: /^@tanstack\/query-core$/, replacement: '/Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db/packages/query-db-collection/node_modules/@tanstack/query-core/build/modern/index.js' },
  ] },
})
