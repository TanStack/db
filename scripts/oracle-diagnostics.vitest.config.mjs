import { fileURLToPath } from 'node:url'

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url))

// These owners distinguish a replay selection from a freshly chosen seed.
export default {
  root: path(`../`),
  resolve: {
    alias: {
      '@tanstack/db': path(`../packages/db/src/index.ts`),
      '@tanstack/db-ivm': path(`../packages/db-ivm/src/index.ts`),
      '@tanstack/store': path(`../packages/store/src/index.ts`),
    },
  },
  test: {
    environment: `jsdom`,
    include: [
      `packages/db-ivm/tests/structural-identity-oracle.property.test.ts`,
      `packages/db/tests/query/includes-publication-oracle.test.ts`,
      `packages/offline-transactions/tests/transaction-serializer-oracle.property.test.ts`,
    ],
    maxWorkers: 1,
    minWorkers: 1,
    coverage: { enabled: false },
    typecheck: { enabled: false },
  },
}
