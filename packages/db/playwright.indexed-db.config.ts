import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/indexed-db',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  outputDir: 'test-results/indexed-db/browser',
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/indexed-db/browser-results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4197',
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    ...['chromium', 'firefox', 'webkit'].map((browserName) => ({
      name: browserName,
      use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit' },
    })),
    {
      name: 'webkit-persistent',
      testMatch: '**/value-oracle.spec.ts',
      use: { browserName: 'webkit' },
    },
  ],
  webServer: {
    command:
      'node ../../node_modules/vite/bin/vite.js --config vite.indexed-db.browser.config.ts --host 127.0.0.1 --port 4197',
    url: 'http://127.0.0.1:4197/e2e/indexed-db/browser.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
