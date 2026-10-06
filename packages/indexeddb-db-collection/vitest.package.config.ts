import { defineConfig } from 'vitest/config'

// This lane intentionally resolves package exports from completed builds.
export default defineConfig({
  test: {
    name: '@tanstack/indexeddb-db-collection (package)',
    include: ['tests/portable-declarations.test.ts'],
    environment: 'node',
    coverage: { enabled: false },
    typecheck: { enabled: false },
  },
})
