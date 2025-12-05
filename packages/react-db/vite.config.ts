import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/config/vite'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'

export default defineConfig(async () => {
  const tanstack = await tanstackViteConfig({
    entry: `./src/index.ts`,
    srcDir: `./src`,
  })

  // Your base config (with Vitest 'test' opts)
  const base = {
    plugins: [react()],
    test: {
      name: packageJson.name,
      dir: `./tests`,
      environment: `jsdom`,
      setupFiles: [`./tests/test-setup.ts`],
      coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
      typecheck: { enabled: true },
    },
  }

  // Merge using Vite's mergeConfig (compatible with both sides)
  return mergeConfig(tanstack, base)
})
