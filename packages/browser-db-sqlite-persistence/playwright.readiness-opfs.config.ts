import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const baseURL = `http://127.0.0.1:4186`
const browserChannel =
  process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? undefined : `chrome`)

export default defineConfig({
  testDir: `./e2e`,
  testMatch: `electric-coordinator-readiness.opfs.spec.ts`,
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
    command: `${resolve(packageDirectory, `../../node_modules/.bin/vite`)} --config vite.readiness-opfs.config.ts --host 127.0.0.1 --port 4186`,
    cwd: packageDirectory,
    reuseExistingServer: false,
    timeout: 120_000,
    url: `${baseURL}/e2e/electric-coordinator-readiness.opfs.html`,
  },
})
