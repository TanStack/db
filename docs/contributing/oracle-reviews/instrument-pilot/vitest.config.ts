import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Replay this component-level pilot explicitly; it is outside the normal suite.
const root = fileURLToPath(new URL('../../../../', import.meta.url))
export default defineConfig({
  root,
  resolve: {
    alias: {
      '@tanstack/db-ivm': `${root}packages/db-ivm/src/index.ts`,
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/db/tests/paced-mutations-oracle.test.ts',
      'docs/contributing/oracle-reviews/instrument-pilot/paced-witness.test.ts',
    ],
    coverage: { enabled: false },
    typecheck: { enabled: false },
  },
})
