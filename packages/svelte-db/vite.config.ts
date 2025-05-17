import { svelte } from "@sveltejs/vite-plugin-svelte"
import { defineConfig } from "vitest/config"
import packageJson from "./package.json" with { type: "json" }

export default defineConfig({
  plugins: [svelte()],
  test: {
    name: packageJson.name,
    dir: `./tests`,
    watch: false,
    environment: `jsdom`,
    coverage: {
      enabled: false,
      provider: `istanbul`,
      include: [`src/**/*`],
    },
    typecheck: { enabled: true },
  },
  resolve: process.env.VITEST
    ? {
        conditions: [`browser`],
      }
    : undefined,
})
