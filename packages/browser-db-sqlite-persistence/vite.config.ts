import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import packageJson from './package.json'
import type { Plugin } from 'vite'

const waSqliteWasmImport = `@journeyapps/wa-sqlite/dist/wa-sqlite.wasm?url&no-inline`
const waSqliteWasmModule = `\0tanstack-wa-sqlite-wasm-url`

function packageWaSqliteWasm(): Plugin {
  return {
    name: `package-wa-sqlite-wasm`,
    enforce: `pre`,
    apply: `build`,
    // Source served by Vite already has resolved asset URLs. Only the built
    // package must find its assets after Vite's dependency optimizer moves it.
    config: () => ({
      define: {
        __BROWSER_SQLITE_PACKAGE_BUILD__: `true`,
        __BROWSER_SQLITE_PACKAGE_VERSION__: JSON.stringify(
          `${packageJson.name}@${packageJson.version}`,
        ),
      },
    }),
    resolveId(id) {
      if (id === waSqliteWasmImport) return waSqliteWasmModule
      return undefined
    },
    load(id) {
      if (id !== waSqliteWasmModule) return
      const require = createRequire(import.meta.url)
      const wasmPath = require.resolve(
        `@journeyapps/wa-sqlite/dist/wa-sqlite.wasm`,
      )
      const reference = this.emitFile({
        type: `asset`,
        fileName: `wa-sqlite.wasm`,
        source: readFileSync(wasmPath),
      })
      return `export default import.meta.ROLLUP_FILE_URL_${reference}`
    },
  }
}

function preserveWaSqliteWasmUrl(): Plugin {
  return {
    name: `preserve-wa-sqlite-wasm-url`,
    enforce: `pre`,
    transform(source: string, id: string) {
      if (
        !/[\\/]@journeyapps[\\/]wa-sqlite[\\/]dist[\\/]wa-sqlite\.mjs$/.test(id)
      ) {
        return
      }

      // locateFile supplies the WASM URL at runtime. Keep Vite from turning
      // wa-sqlite's unused fallback URL into an inlined data URL.
      const defaultUrl = `new URL("wa-sqlite.wasm",import.meta.url)`
      if (!source.includes(defaultUrl)) {
        this.error(`wa-sqlite's WASM URL pattern changed`)
      }
      return {
        code: source.replace(
          defaultUrl,
          `new URL("wa-sqlite" + ".wasm",import.meta.url)`,
        ),
        // The edit stays within one line, so the existing mappings still hold
        // apart from columns after it on that line.
        map: null,
      }
    },
  }
}

const config = defineConfig({
  // Build with relative paths so the ?worker&url and WASM URL imports emit
  // new URL("../assets/opfs-worker.js", import.meta.url) and
  // new URL("../../wa-sqlite.wasm", import.meta.url) instead of absolute
  // "/assets/..." paths that break for library consumers. opfs-database.ts
  // relies on the two depths differing to tell a pre-bundled copy of this
  // package from one served in place; the install-layout e2e test covers it.
  base: `./`,
  plugins: [packageWaSqliteWasm()],
  worker: {
    // opfs-database.ts starts the built worker as a classic script.
    format: `iife`,
    // A fixed name lets package.json export the worker as one file. Consumer
    // bundlers emit it under their own hashed name.
    rollupOptions: { output: { entryFileNames: `assets/[name].js` } },
    plugins: () => [preserveWaSqliteWasmUrl()],
  },
  test: {
    name: packageJson.name,
    include: [`tests/**/*.test.ts`],
    environment: `node`,
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
    typecheck: {
      enabled: true,
      include: [`tests/**/*.test.ts`, `tests/**/*.test-d.ts`],
    },
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({
    entry: `./src/index.ts`,
    srcDir: `./src`,
    bundledDeps: [waSqliteWasmImport],
  }),
)
