import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: `./e2e`,
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:4175`,
    trace: `on-first-retry`,
  },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port 4175`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    url: `http://127.0.0.1:4175`,
  },
  projects: [
    {
      name: `chromium`,
      use: { ...devices[`Desktop Chrome`] },
    },
  ],
})
