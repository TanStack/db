import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from './vite.config'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: [`tests/**/*.e2e.test.ts`],
      exclude: [],
      environment: `node`,
      fileParallelism: false,
      testTimeout: 60_000,
      typecheck: {
        enabled: false,
      },
      coverage: {
        enabled: false,
      },
    },
  }),
)
