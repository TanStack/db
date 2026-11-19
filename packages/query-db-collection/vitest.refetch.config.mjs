import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url))
const require = createRequire(import.meta.url)

// Exercise this checkout's source without requiring package builds. Query Core
// still resolves from this package's installed dependency, as in its normal run.
export default {
  root: path(`./`),
  resolve: {
    alias: {
      '@tanstack/db': path(`../db/src/index.ts`),
      '@tanstack/db-ivm': path(`../db-ivm/src/index.ts`),
      '@tanstack/query-core': require.resolve(`@tanstack/query-core`),
    },
  },
  test: {
    environment: `jsdom`,
    include: [`tests/refetch-ordered-prefix-oracle.test.ts`],
    maxWorkers: 1,
    minWorkers: 1,
    coverage: { enabled: false },
    typecheck: { enabled: false },
  },
}
