import { svelteTesting } from "@testing-library/svelte/vite"
import { sveltekit } from "@sveltejs/kit/vite"
import { defineConfig } from "vitest/config"
import packageJson from "./package.json" with { type: "json" }

export default defineConfig({
  plugins: [sveltekit(), svelteTesting()],
  test: {
    name: packageJson.name,
    dir: `./tests`,
    watch: false,
    environment: `jsdom`,
    // coverage: {
    //   enabled: true,
    //   provider: `istanbul`,
    //   include: [`src/lib/**/*`],
    // },
    typecheck: { enabled: true },
  },
})
