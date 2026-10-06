import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      '@tanstack/db': fileURLToPath(
        new URL('../db/src/index.ts', import.meta.url),
      ),
      '@tanstack/db-ivm': fileURLToPath(
        new URL('../db-ivm/src/index.ts', import.meta.url),
      ),
    },
  },
})
