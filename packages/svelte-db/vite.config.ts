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
  // Tell Vitest to use the `browser` entry points in `package.json` files, even though it's running in Node
  resolve: process.env.VITEST
    ? {
        conditions: [`browser`],
      }
    : undefined,
})
