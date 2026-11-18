import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import packageJson from './package.json'

const config = defineConfig({
  test: {
    name: packageJson.name,
    include: [`tests/**/*.test.ts`],
    exclude: [`e2e/**/*.e2e.test.ts`],
    environment: `node`,
    setupFiles: [`./tests/helpers/mobile-runtime-test-setup.ts`],
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
    typecheck: {
      enabled: true,
      include: [`tests/**/*.test.ts`],
      tsconfig: `./tsconfig.json`,
      // oracleProperty registers its tests at runtime, beyond the static
      // collector. The full project compiler still checks this file and
      // reports its diagnostics as source errors.
      exclude: [`tests/op-sqlite-driver-oracle.test.ts`],
    },
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({
    entry: [`./src/index.ts`, `./src/react-native.ts`],
    srcDir: `./src`,
  }),
)
