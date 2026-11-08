import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'

// The Neon Realtime receiving driver. It runs the shared eager live-source
// oracle against Neon's adapter source, vendored at a fixed commit, on the
// workspace TanStack DB. It is kept out of the default run because that
// adapter targets the 0.9 sync API and is expected to fail several laws until
// it is updated. Run it with `pnpm --filter @tanstack/db-adapter-conformance
// test:neon`.
const config = defineConfig({
  // The vendored adapter sits outside this package's tsconfig, so its
  // imports need the workspace sources named directly.
  resolve: {
    alias: {
      '@tanstack/db': fileURLToPath(
        new URL(`../db/src/index.ts`, import.meta.url),
      ),
      '@tanstack/db-ivm': fileURLToPath(
        new URL(`../db-ivm/src/index.ts`, import.meta.url),
      ),
    },
  },
  test: {
    name: `@tanstack/db-adapter-conformance (neon)`,
    include: [`tests/neon-realtime-oracle.property.test.ts`],
    environment: `node`,
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({ entry: `./src/index.ts`, srcDir: `./src` }),
)
