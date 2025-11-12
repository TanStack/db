import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globalSetup: "./support/global-setup.ts",
    fileParallelism: false, // Critical: Serial execution for shared database
    timeout: 30000,
    environment: "jsdom",
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json", "html"],
      include: ["**/src/**"],
    },
  },
})
