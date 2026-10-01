import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { defineConfig } from 'vitest/config'
import { assertDbDistFresh } from './scripts/assert-dist-fresh.mjs'
import type { Plugin } from 'vite'

// Runs a few db tests against the built dist, where private members are
// renamed (see mangle-cache.json). The consumer packages' suites already run
// against dist; this lane covers db's own internal paths. The build keeps one output module per
// source module, so each src import maps to the same path under dist/esm.
// The build does not emit modules without runtime code (re-export barrels and
// type-only files). Those load from src, and their own imports resolve to
// dist, so all runtime code still comes from dist. Any other unbuilt module
// throws.
const root = path.dirname(fileURLToPath(import.meta.url))
await assertDbDistFresh(path.join(root, `../..`))
const src = path.join(root, `src`)
const dist = path.join(root, `dist/esm`)

function srcToDist(): Plugin {
  return {
    name: `db-src-to-dist`,
    enforce: `pre`,
    async resolveId(source, importer, options) {
      if (!importer || importer.startsWith(dist)) return null
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      })
      if (!resolved?.id.startsWith(src + path.sep)) return null
      const target = path
        .join(dist, path.relative(src, resolved.id))
        .replace(/\.ts$/, `.js`)
      if (existsSync(target)) return target
      if (hasNoRuntimeCode(resolved.id)) return resolved.id
      throw new Error(`No built module for ${resolved.id}`)
    },
  }
}

function hasNoRuntimeCode(file: string): boolean {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, `utf8`),
    ts.ScriptTarget.Latest,
  )
  return source.statements.every(
    (statement) =>
      ts.isImportDeclaration(statement) ||
      ts.isExportDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement),
  )
}

export default defineConfig({
  plugins: [srcToDist()],
  test: {
    name: `@tanstack/db (dist)`,
    dir: `./tests`,
    environment: `jsdom`,
    setupFiles: [`./tests/test-setup.ts`],
    // Chosen for coverage of the modules with the most renamed members. They
    // do not read private members directly, which would test the rename map
    // instead of behavior. About 9 seconds in total.
    include: [
      `query/ordered-source-loader-state.test.ts`,
      `live-query-observer.test.ts`,
      `query/includes-publication-oracle.test.ts`,
      `query/bucket-facade-adapter.test.ts`,
      `collection-subscription.test.ts`,
    ],
  },
})
