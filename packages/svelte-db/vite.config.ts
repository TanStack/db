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
    coverage: {
      enabled: false,
      provider: `istanbul`,
      include: [`src/**/*`],
    },
    typecheck: { enabled: true },
    alias: {
      // This is needed for svelte-5 support
      // https://github.com/testing-library/svelte-testing-library?tab=readme-ov-file#svelte-5-support
      "@testing-library/svelte": `@testing-library/svelte/svelte5`,
    },
  },
})
