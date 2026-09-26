import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const packageDirectory = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: `./`,
  // wa-sqlite locates its sibling WASM file through import.meta.url. Keeping
  // the module out of Vite's dependency prebundle preserves that relationship
  // for this real-browser fixture.
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
    },
  },
  server: {
    fs: {
      allow: [resolve(packageDirectory, `../..`)],
    },
  },
})
