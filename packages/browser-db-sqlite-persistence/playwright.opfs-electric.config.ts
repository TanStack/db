import { defineConfig } from '@playwright/test'
import opfsConfig from './playwright.opfs.config'

export default defineConfig({
  ...opfsConfig,
  testMatch: [
    `electric-resume-two-tab.opfs.spec.ts`,
    `electric-hydration-straddle.opfs.spec.ts`,
    `electric-immediate-reload.opfs.spec.ts`,
  ],
  timeout: 180_000,
})
