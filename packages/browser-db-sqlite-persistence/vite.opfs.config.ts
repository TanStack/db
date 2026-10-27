import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const packageDirectory = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: `./`,
  // The worker passes wa-sqlite its WASM URL through locateFile, so this
  // exclusion no longer locates the WASM file. These fixtures serve the package
  // source; the packaged-consumer e2e tests own the dependency-optimizer path.
  optimizeDeps: {
    exclude: [`@journeyapps/wa-sqlite`],
  },
  resolve: {
    alias: {
      '@tanstack/db': resolve(packageDirectory, `../db/src`),
      '@tanstack/db-ivm': resolve(packageDirectory, `../db-ivm/src`),
      '@tanstack/db-sqlite-persistence-core': resolve(
        packageDirectory,
        `../db-sqlite-persistence-core/src`,
      ),
      '@tanstack/query-db-collection': resolve(
        packageDirectory,
        `../query-db-collection/src`,
      ),
    },
  },
  server: {
    proxy: {
      '/electric': {
        target: process.env.ELECTRIC_URL ?? `http://127.0.0.1:3000`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/electric/, ``),
      },
    },
    fs: {
      allow: [resolve(packageDirectory, `../..`)],
    },
  },
})
