// @vitest-environment node
/**
 * A consumer must resolve the published ESM and CommonJS declarations and keep
 * Collection row/key types. TypeScript is the independent checker: compile a
 * consumer through package exports, with no source aliases or skipLibCheck.
 * This fixed module-resolution matrix links workspace builds of this adapter
 * and its core dependencies. It does not prove tarball completeness, every
 * public API, or older compiler versions.
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { commonJsDeclarations } from '../../../scripts/commonjs-declarations.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), `..`)
const consumer = `
import { createCollection } from '@tanstack/db'
import { createIndexedDB, indexedDBCollectionOptions, type IndexedDBCollectionUtils } from '@tanstack/indexeddb-db-collection'

type Input = { id: number; date: string }
type Output = { id: number; date: Date }
declare const utils: IndexedDBCollectionUtils<Output, Input>
export async function schemaDomains() {
  await utils.importData([{ id: 1, date: '2026-01-01' }])
  // @ts-expect-error Schema output is not validated schema input.
  await utils.importData([{ id: 1, date: new Date() }])
  const output: Array<Output> = await utils.exportData()
  // @ts-expect-error Export retains the transformed output domain.
  const input: Array<Input> = await utils.exportData()
  return { output, input }
}

export async function createRows() {
  const db = await createIndexedDB({ name: 'typed', version: 1, stores: ['rows'] })
  const collection = createCollection(
    indexedDBCollectionOptions<{ id: number; value: string }, number>({
      db, name: 'rows', getKey: row => row.id,
    }),
  )
  collection.insert({ id: 1, value: 'typed' })
  const value: string | undefined = collection.get(1)?.value
  // @ts-expect-error Public declarations must retain the row type.
  collection.insert({ id: 2, value: 123 })
  // @ts-expect-error Public declarations must retain the key type.
  collection.get('1')
  await collection.utils.importData([{ id: 3, value: 'imported' }])
  const exported: Array<{ id: number; value: string }> = await collection.utils.exportData()
  return { value, exported }
}
`

it.each([
  [`Node16 ESM`, ts.ModuleKind.Node16, ts.ModuleResolutionKind.Node16, `mts`],
  [
    `Node16 CommonJS`,
    ts.ModuleKind.Node16,
    ts.ModuleResolutionKind.Node16,
    `cts`,
  ],
  [
    `NodeNext ESM`,
    ts.ModuleKind.NodeNext,
    ts.ModuleResolutionKind.NodeNext,
    `mts`,
  ],
  [
    `NodeNext CommonJS`,
    ts.ModuleKind.NodeNext,
    ts.ModuleResolutionKind.NodeNext,
    `cts`,
  ],
  [`Bundler`, ts.ModuleKind.ESNext, ts.ModuleResolutionKind.Bundler, `mts`],
] as const)(
  `resolves public package types for %s consumers`,
  (_name, module, moduleResolution, extension) => {
    const root = mkdtempSync(join(tmpdir(), `indexeddb-declarations-`))
    try {
      const scope = join(root, `node_modules`, `@tanstack`)
      mkdirSync(scope, { recursive: true })
      symlinkSync(packageRoot, join(scope, `indexeddb-db-collection`), `dir`)
      symlinkSync(resolve(packageRoot, `../db`), join(scope, `db`), `dir`)
      const input = join(root, `consumer.${extension}`)
      writeFileSync(input, consumer)
      expectConsumerTypes(root, input, module, moduleResolution)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
  30_000,
)

// These declaration forms distinguish a module path from data that happens to
// look like one. Only the module path changes format; the consumer's literal
// value is the public type contract. Dotted module names and bare package
// subpaths exercise boundaries that a global string replacement would break.
it.each([
  [
    `import type arguments`,
    `export type Value = import('./row.with.dots.js').Box<'./literal.js'>`,
  ],
  [
    `package import type arguments`,
    `export type Value = import('external/subpath.js').Box<'./literal.js'>`,
  ],
  [`literal types`, `export type Value = './literal.js'`],
  [
    `static imports`,
    `import type { Box } from './row.with.dots.js'; export type Value = Box<'./literal.js'>`,
  ],
  [`re-exports`, `export type { Value } from './row.with.dots.js'`],
  [
    `import equals`,
    `import Peer = require('./row.with.dots.js'); export type Value = Peer.Box<'./literal.js'>`,
  ],
  [
    `module augmentation`,
    `declare module './row.with.dots.js' { interface Values { value: './literal.js' } }
     export type Value = import('./row.with.dots.js').Values['value']`,
  ],
])(`preserves consumer types when rewriting %s`, (_name, declaration) => {
  const root = mkdtempSync(join(tmpdir(), `declaration-imports-`))
  try {
    const output = join(root, `dist`, `cjs`)
    const external = join(root, `node_modules`, `external`)
    mkdirSync(output, { recursive: true })
    mkdirSync(external, { recursive: true })
    const peer = `export type Box<T> = T; export type Value = './literal.js'; export interface Values {}`
    writeFileSync(join(output, `row.with.dots.d.cts`), peer)
    writeFileSync(join(external, `subpath.d.ts`), peer)
    writeFileSync(
      join(output, `public.d.cts`),
      commonJsDeclarations(join(output, `public.d.ts`), declaration),
    )
    const input = join(root, `consumer.cts`)
    writeFileSync(
      input,
      `import type { Value } from './dist/cjs/public.cjs'; export const value: Value = './literal.js'`,
    )
    expectConsumerTypes(
      root,
      input,
      ts.ModuleKind.NodeNext,
      ts.ModuleResolutionKind.NodeNext,
    )
    expect(
      commonJsDeclarations(
        join(root, `dist`, `esm`, `public.d.ts`),
        declaration,
      ),
    ).toBe(declaration)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function expectConsumerTypes(
  root: string,
  input: string,
  module: ts.ModuleKind,
  moduleResolution: ts.ModuleResolutionKind,
) {
  const program = ts.createProgram([input], {
    target: ts.ScriptTarget.ES2022,
    lib: [`lib.es2022.d.ts`, `lib.dom.d.ts`],
    module,
    moduleResolution,
    strict: true,
    skipLibCheck: false,
    types: [],
    noEmit: true,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  expect(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => `\n`,
    }),
  ).toBe(``)
}
