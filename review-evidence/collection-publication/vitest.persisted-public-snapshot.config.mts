import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import ordinary from '../../packages/db-sqlite-persistence-core/vite.config'

const workspace = fileURLToPath(new URL('../../', import.meta.url))
const config = mergeConfig(
  ordinary,
  defineConfig({
    root: `${workspace}packages/db-sqlite-persistence-core`,
    cacheDir: `${workspace}review-evidence/collection-publication/cache-persisted-public-snapshot`,
    resolve: {
      alias: [
        {
          find: /^@tanstack\/db$/,
          replacement: `${workspace}packages/db/src/index.ts`,
        },
        {
          find: /^@tanstack\/db-ivm$/,
          replacement: `${workspace}packages/db-ivm/src/index.ts`,
        },
        {
          find: /^@tanstack\/db-sqlite-persistence-core$/,
          replacement: `${workspace}packages/db-sqlite-persistence-core/src/index.ts`,
        },
      ],
    },
    test: {
      include: ['tests/collection-public-snapshot-persisted-oracle.test.ts'],
      typecheck: { enabled: false, include: [] },
      coverage: { enabled: false },
      maxWorkers: 1,
      fileParallelism: false,
    },
  }),
)
// Vite merges array fields by concatenation. Keep this receiving run bounded.
config.test!.include = [
  'tests/collection-public-snapshot-persisted-oracle.test.ts',
]
config.test!.typecheck = { enabled: false, include: [] }
export default config
