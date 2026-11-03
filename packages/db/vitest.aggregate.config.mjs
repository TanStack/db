import { fileURLToPath } from 'node:url'

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url))

// A focused source run, with the same jsdom setup as the package suite.
export default {
  root: path(`./`),
  resolve: {
    alias: {
      '@tanstack/db-ivm': path(`../db-ivm/src/index.ts`),
      '@tanstack/store': path(`../store/src/index.ts`),
    },
  },
  test: {
    environment: `jsdom`,
    setupFiles: [path(`./tests/test-setup.ts`)],
    include: [
      `tests/query/aggregate-select-oracle.property.test.ts`,
      `tests/declared-reach-oracle.property.test.ts`,
      `tests/oracle-campaign.test.ts`,
      `tests/oracle-reach.test.ts`,
      `tests/oracle-replay.test.ts`,
    ],
    maxWorkers: 1,
    minWorkers: 1,
    coverage: { enabled: false },
    typecheck: { enabled: false },
  },
}
