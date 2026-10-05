import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const appDirectory = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      vitest: resolve(appDirectory, `src/runtime-vitest.ts`),
      'node:crypto': resolve(appDirectory, `src/node-crypto.ts`),
      '@tanstack/db': resolve(appDirectory, `../../../db/src`),
      '@tanstack/db-ivm': resolve(appDirectory, `../../../db-ivm/src`),
      '@tanstack/db-sqlite-persistence-core': resolve(
        appDirectory,
        `../../../db-sqlite-persistence-core/src`,
      ),
    },
  },
  server: {
    host: `127.0.0.1`,
    port: 1420,
    strictPort: true,
  },
  build: {
    target: `es2022`,
  },
})
