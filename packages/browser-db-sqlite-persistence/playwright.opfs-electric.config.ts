import { defineConfig } from '@playwright/test'
import opfsConfig from './playwright.opfs.config'

export default defineConfig({
  ...opfsConfig,
  testMatch: [
    `electric-resume-two-tab-oracle.opfs.spec.ts`,
    `electric-hydration-straddle-oracle.opfs.spec.ts`,
    `electric-immediate-reload-oracle.opfs.spec.ts`,
  ],
  timeout: 180_000,
})
