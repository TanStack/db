import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:4175`
const shouldStartWebServer = process.env.PLAYWRIGHT_BASE_URL === undefined

export default defineConfig({
  testDir: `./e2e`,
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  use: {
    baseURL,
    trace: `on-first-retry`,
  },
  webServer: shouldStartWebServer
    ? {
        command: `pnpm dev --host 127.0.0.1 --port 4175`,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
        url: baseURL,
      }
    : undefined,
  projects: [
    {
      name: `chromium`,
      use: { ...devices[`Desktop Chrome`] },
    },
  ],
})
