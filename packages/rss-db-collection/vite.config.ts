import { defineConfig } from "vite"

export default defineConfig({
  test: {
    testTimeout: 10000,
    coverage: {
      enabled: false, // Disable coverage to bypass missing coverage provider
    },
  },
})
