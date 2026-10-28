import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The lint-rule suites run in Node. They need no coverage and no package
// setup, so this config stays separate from the packages' configs.
export default defineConfig({
  test: {
    root: dirname(fileURLToPath(import.meta.url)),
    include: [`*.test.js`],
    environment: `node`,
    coverage: { enabled: false },
  },
})
