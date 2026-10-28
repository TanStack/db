import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Generated oracles beside the repository scripts. They run in Node, with no
// coverage and no package setup.
export default defineConfig({
  test: {
    root: dirname(fileURLToPath(import.meta.url)),
    include: [`*.property.test.js`],
    environment: `node`,
    coverage: { enabled: false },
  },
})
