import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import config from './vite.config'

// Runtime oracles judge the current source. Published declarations have a
// separate build-consuming lane, so tests never rebuild another suite's input.
export default mergeConfig(
  config,
  defineConfig({
    resolve: {
      alias: {
        '@tanstack/db': fileURLToPath(
          new URL('../db/src/index.ts', import.meta.url),
        ),
        '@tanstack/db-ivm': fileURLToPath(
          new URL('../db-ivm/src/index.ts', import.meta.url),
        ),
      },
    },
    test: {
      exclude: [
        'tests/portable-declarations.test.ts',
        'tests/packed-consumer.test.ts',
      ],
      typecheck: { tsconfig: './tsconfig.test.json' },
    },
  }),
)
