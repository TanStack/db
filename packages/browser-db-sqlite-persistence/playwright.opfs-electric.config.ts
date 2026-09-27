import { defineConfig } from '@playwright/test'
import opfsConfig from './playwright.opfs.config'

export default defineConfig({
  ...opfsConfig,
  testMatch: [`electric-resume-two-tab.opfs.spec.ts`],
  timeout: 180_000,
})
