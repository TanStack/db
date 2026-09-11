import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'

export default defineConfig(async () => {
  const tanstack = await tanstackViteConfig({
    entry: `./src/index.tsx`,
    srcDir: `./src`,
  })

  const base = {
    plugins: [react()],
    test: {
      name: packageJson.name,
      dir: `./tests`,
      environment: `jsdom`,
      coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
      typecheck: { enabled: true },
    },
  }

  return mergeConfig(tanstack, base)
})
