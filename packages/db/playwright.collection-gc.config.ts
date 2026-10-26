import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: `./e2e/collection-gc`,
  testMatch: `**/*.spec.ts`,
  timeout: 30_000,
  workers: 1,
  outputDir: `test-results/collection-gc`,
  use: {
    baseURL: `http://127.0.0.1:42871`,
    browserName: `chromium`,
    headless: true,
  },
  webServer: {
    command: `node ../../node_modules/vite/bin/vite.js --config vite.indexed-db.browser.config.ts --host 127.0.0.1 --port 42871`,
    url: `http://127.0.0.1:42871/e2e/collection-gc/browser.html`,
    reuseExistingServer: false,
  },
})
