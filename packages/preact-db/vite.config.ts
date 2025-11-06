import { defineConfig, mergeConfig } from "vitest/config"
import { tanstackViteConfig } from "@tanstack/config/vite"
import preact from "@preact/preset-vite"
import packageJson from "./package.json"

export default defineConfig(async () => {
  const tanstack = await tanstackViteConfig({
    entry: `./src/index.ts`,
    srcDir: `./src`,
  })

  // Your base config (with Vitest 'test' opts)
  const base = {
    plugins: [preact()],
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
