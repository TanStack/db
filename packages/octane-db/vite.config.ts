import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import { octane } from '@octanejs/vite-plugin'
import packageJson from './package.json'

export default defineConfig(async (env) => {
  const tanstack = await tanstackViteConfig({
    entry: `./src/index.ts`,
    srcDir: `./src`,
  })

  const isTest = env.mode === `test` || process.env.VITEST

  const base = {
    ...(isTest ? { plugins: [octane()] } : {}),
    test: {
      name: packageJson.name,
      dir: `./tests`,
      environment: `jsdom`,
      setupFiles: [`./tests/test-setup.ts`],
      coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
      typecheck: {
        enabled: true,
        include: [`tests/**/*.test-d.tsx`],
      },
    },
  }

  return mergeConfig(tanstack, base)
})
