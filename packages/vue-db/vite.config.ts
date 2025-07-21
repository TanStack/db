import { defineConfig, mergeConfig } from "vitest/config"
import { tanstackViteConfig } from "@tanstack/config/vite"
import vue from "@vitejs/plugin-vue"
import packageJson from "./package.json"

const config = defineConfig({
  plugins: [vue()],
  test: {
    name: packageJson.name,
    dir: `./tests`,
    environment: `jsdom`,
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
    typecheck: { enabled: true },
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({
    entry: `./src/index.ts`,
    srcDir: `./src`,
  })
)
