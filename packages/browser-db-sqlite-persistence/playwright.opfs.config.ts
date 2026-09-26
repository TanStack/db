import { defineConfig } from '@playwright/test'

const baseURL = `http://127.0.0.1:4185`
const browserChannel =
  process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? undefined : `chrome`)

export default defineConfig({
  testDir: `./e2e`,
  testMatch: `shared-driver-fairness.opfs.spec.ts`,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    ...(browserChannel ? { channel: browserChannel } : {}),
    headless: true,
    trace: `retain-on-failure`,
  },
  webServer: {
    command: `vite --config vite.opfs.config.ts --host 127.0.0.1 --port 4185`,
    reuseExistingServer: false,
    timeout: 120_000,
    url: `${baseURL}/e2e/shared-driver-fairness.opfs.html`,
  },
})
