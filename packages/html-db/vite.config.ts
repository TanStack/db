import { defineConfig, mergeConfig } from "vitest/config"
import { tanstackViteConfig } from "@tanstack/config/vite"
import packageJson from "./package.json"

export default defineConfig(async () => {
  const tanstack = await tanstackViteConfig({
    entry: `./src/index.ts`,
    srcDir: `./src`,
  })

  const base = {
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
