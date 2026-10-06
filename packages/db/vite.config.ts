import { readFileSync } from 'node:fs'
import { transform } from 'esbuild'
import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import { commonJsDeclarations } from '../../scripts/commonjs-declarations.mjs'
import packageJson from './package.json'
import type { Plugin } from 'vite'

// Consumer minifiers never rename properties. Rename TS-private members in
// the published output with a committed, reversible name map. Only names
// whose every use resolves to a private member in src are listed.
function manglePrivateMembers(): Plugin {
  const mangleCache: Record<string, string> = JSON.parse(
    readFileSync(new URL(`./mangle-cache.json`, import.meta.url), `utf8`),
  )
  const mangleProps = new RegExp(`^(${Object.keys(mangleCache).join(`|`)})$`)
  return {
    name: `mangle-private-members`,
    apply: `build`,
    async renderChunk(code, chunk) {
      const result = await transform(code, {
        loader: `js`,
        mangleProps,
        mangleCache: { ...mangleCache },
        sourcemap: `external`,
        sourcefile: chunk.fileName,
        legalComments: `inline`,
      })
      const added = Object.keys(result.mangleCache).filter(
        (name) => !(name in mangleCache),
      )
      if (added.length > 0)
        throw new Error(`Unlisted mangled names: ${added.join(`, `)}`)
      return { code: result.code, map: result.map }
    },
  }
}

const config = defineConfig({
  plugins: [manglePrivateMembers()],
  test: {
    name: packageJson.name,
    dir: `./tests`,
    environment: `jsdom`,
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
    typecheck: { enabled: true, tsconfig: `./tsconfig.test.json` },
    setupFiles: [`./tests/test-setup.ts`],
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({
    entry: [`./src/index.ts`],
    srcDir: `./src`,
    beforeWriteDeclarationFile: commonJsDeclarations,
  }),
)
