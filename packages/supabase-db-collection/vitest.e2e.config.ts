import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }

const packagesDir = resolve(import.meta.dirname, '..')

export default defineConfig({
  define: {
    __SUPABASE_DB_COLLECTION_VERSION__: JSON.stringify(packageJson.version),
  },
  test: {
    name: `${packageJson.name}:e2e`,
    include: [`e2e/**/*.e2e.test.ts`],
    globalSetup: [`./e2e/global-setup.ts`],
    // Not jsdom: `isServer` from query-core is false under jsdom, which makes
    // `getQueryClient()` hand every collection the same module-level
    // QueryClient, so cached queries leak between collections.
    environment: `node`,
    // The e2e tests share a single database that is truncated between tests,
    // so files must not run in parallel against it.
    fileParallelism: false,
    hookTimeout: 120_000,
    // A realtime test can chain several 15s poll windows; keep the test timeout
    // above the worst-case sum so the innermost failing waiter reports before
    // the whole test times out.
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@tanstack/db': resolve(packagesDir, 'db/src/index.ts'),
      '@tanstack/db-ivm': resolve(packagesDir, 'db-ivm/src/index.ts'),
      '@tanstack/db-collection-e2e': resolve(
        packagesDir,
        'db-collection-e2e/src/index.ts',
      ),
      // The shared suites package re-exports Electric-only suites that import it.
      '@tanstack/electric-db-collection': resolve(
        packagesDir,
        'electric-db-collection/src/index.ts',
      ),
      '@tanstack/query-db-collection': resolve(
        packagesDir,
        'query-db-collection/src/index.ts',
      ),
    },
  },
})
