import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// A finite existing real-QueryClient owner, selected by its exact test name.
// This path does not claim the H02 progress driver's V8/receipt binding.
const root = fileURLToPath(new URL('../../', import.meta.url))
export default defineConfig({
  root,
  resolve: { alias: [
    { find: /^@tanstack\/db$/, replacement: resolve(root, 'packages/db/src/index.ts') },
    { find: /^@tanstack\/db-ivm$/, replacement: resolve(root, 'packages/db-ivm/src/index.ts') },
  ] },
  test: {
    include: ['packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts'],
    environment: 'jsdom', pool: 'forks', maxWorkers: 1, fileParallelism: false,
    execArgv: ['--max-old-space-size=384'],
    typecheck: { enabled: false }, coverage: { enabled: false }, testTimeout: 20_000,
  },
})
