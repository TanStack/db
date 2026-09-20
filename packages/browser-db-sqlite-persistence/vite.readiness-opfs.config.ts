import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const workspaceDirectory = resolve(packageDirectory, `../..`)
const dependencyDirectory = realpathSync(
  resolve(workspaceDirectory, `node_modules`),
)

export default defineConfig({
  base: `./`,
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
      '@tanstack/electric-db-collection': resolve(
        packageDirectory,
        `../electric-db-collection/src`,
      ),
    },
  },
  server: {
    fs: {
      allow: [workspaceDirectory, dependencyDirectory],
    },
  },
})
