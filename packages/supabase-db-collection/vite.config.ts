import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import packageJson from './package.json'

const config = defineConfig({
  // Inlines the published version at build time (and under vitest) so the
  // `X-Client-Info` header can never drift from package.json.
  define: {
    __SUPABASE_DB_COLLECTION_VERSION__: JSON.stringify(packageJson.version),
  },
  test: {
    name: packageJson.name,
    include: [`tests/**/*.test.ts`],
    exclude: [`e2e/**/*`],
    // Not jsdom: `isServer` from query-core is false under jsdom, which makes
    // `getQueryClient()` hand every collection the same module-level
    // QueryClient, so cached queries leak between tests.
    environment: `node`,
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
    typecheck: {
      enabled: true,
      include: [`tests/**/*.test.ts`, `tests/**/*.test-d.ts`],
    },
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({
    entry: `./src/index.ts`,
    srcDir: `./src`,
  }),
)
