import { defineConfig } from 'vitest/config'

// This lane resolves @tanstack/db through its built package exports.
export default defineConfig({
  test: {
    name: '@tanstack/db (IndexedDB package)',
    include: ['package-tests/indexed-db/*.test.ts'],
    environment: 'node',
    coverage: { enabled: false },
    typecheck: { enabled: false },
  },
})
