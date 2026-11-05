import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The gap report's own oracle. It runs the CLI on scratch packages, so it
// runs in Node, one file at a time, with no coverage.
export default defineConfig({
  test: {
    root: dirname(fileURLToPath(import.meta.url)),
    include: [`*.property.test.mjs`],
    environment: `node`,
    coverage: { enabled: false },
    maxWorkers: 1,
  },
})
