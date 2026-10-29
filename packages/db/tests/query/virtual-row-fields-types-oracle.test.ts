/**
 * # Do generated public query types respect the row/value boundary?
 *
 * Authority: VirtualRowProps and ARCHITECTURE.md, Nested materialization.
 * Published Collection roots and whole source rows carry four readonly virtual
 * fields. Inline projected objects, nested objects, arrays and opaque values
 * retain their authored shape. Nullable whole-row selections are absent or
 * complete; facade rows always receive required metadata. WithoutVirtualProps
 * distributes over discriminated row unions.
 *
 * The source generator enacts that law with independently written Published,
 * Missing and SameShape types. It never imports production metadata classifiers.
 * Each finite input varies key domain, ordinary value type, nested optionality
 * and discriminated source unions. Every input crosses root projection shape,
 * direct/recursive/union composition and inline materialization form. Expected
 * shapes follow authored declarations, not inferred production types.
 *
 * The real TypeScript compiler receives consumer source importing only the
 * public @tanstack/db entry. Every diagnostic, including dependencies, survives
 * comparison with the empty diagnostic set. This checks source public exports;
 * built declarations, npm resolution, adapter handlers and runtime values are
 * separate receiving paths. Concrete helper examples remain supplemental in
 * virtual-row-fields-reference-types.test-d.ts.
 */
import { resolve } from 'node:path'
import ts from 'typescript'
import { afterAll, expect, test } from 'vitest'
import * as publicDb from '../../src/index.js'
import { declareOracle } from '../oracle-declaration.js'
import { createOracleReach } from '../oracle-reach.js'
import { checkWithCleanup } from './virtual-row-fields-support.js'
import {
  metadataCompositions as compositions,
  metadataProjectionShapes as projections,
} from './virtual-row-fields-grammar-oracle.js'

// Exhaustive finite grammar. Removing an axis loses a distinct public type:
// numeric/union keys, scalar types, optional nested values or union narrowing.
// Boolean keys and nullable Collection rows are excluded as illegal inputs.
const typeShapes = [`string`, `number`, `string | number`].flatMap((key) =>
  [`string`, `number`].flatMap((value) =>
    [false, true].flatMap((optional) =>
      [false, true].map((union) => ({ key, value, optional, union })),
    ),
  ),
)
type TypeShape = (typeof typeShapes)[number]
const inlineShapes = [
  `whole`,
  `selected-whole`,
  `nullable-whole`,
  `object`,
  `nested-object`,
  `array`,
  `date`,
] as const
const inlineForms = [`facade`, `toArray`, `materialize`, `findOne`] as const
const states = [
  ...projections.flatMap((shape) =>
    compositions.map((composition) => `root/${shape}/${composition}`),
  ),
  ...inlineShapes.flatMap((shape) =>
    inlineForms
      .filter(
        (form) => form !== `facade` || (shape !== `array` && shape !== `date`),
      )
      .map((form) => `inline/${shape}/${form}`),
  ),
  `nested-query-ref`,
  `nested-index-ref`,
  `union-removal`,
  `construction-admitted`,
]
const reach = createOracleReach(`virtual row public types`, states, {
  replaying: false,
})
let publicTypesEntered = false
afterAll(() => {
  if (!publicTypesEntered) return
  reach.assertReached()
  console.info(
    `virtual row public types reach`,
    Object.fromEntries(reach.counts()),
  )
})

function rootQuery(shape: (typeof projections)[number], alias: string) {
  const base = `new Query().from({ ${alias}: rows })`
  if (shape === `functional-direct`)
    return `${base}.fn.select(({ ${alias} }) => ${alias})`
  const select = shape.startsWith(`functional`) ? `fn.select` : `select`
  const result = shape.endsWith(`spread`)
    ? `{ ...${alias} }`
    : `{ id: ${alias}.id, payload: ${alias}.profile }`
  return `${base}.${select}(({ ${alias} }) => (${result}))`
}
function composeQuery(query: string, peer: string, composition: string) {
  const outer = (input: string) => `new Query().from({ outer: ${input} })`
  if (composition === `query-ref`) return outer(query)
  if (composition === `nested-query-ref`) return outer(outer(query))
  if (composition === `functional-query-ref`)
    return `${outer(query)}.fn.select(({ outer }) => outer)`
  if (composition === `joined-query-ref`)
    return `new Query().from({ anchor: rows }).innerJoin({ outer: ${query} }, ({ anchor, outer }) => eq(anchor.id, outer.id)).select(({ outer }) => outer)`
  const union = `new Query().unionAll(${query}, ${peer})`
  if (composition === `union`) return union
  if (composition === `union-last`)
    return `new Query().unionAll(${peer}, ${query})`
  if (composition === `union-query-ref`) return outer(union)
  return query
}

/**
 * The independent type law is textual because TypeScript checks generated
 * consumers. Normalize distributes only the outer record; nested values retain
 * optionality, unions and opaque types. No cast or never-running runtime path
 * supplies a missing type. Callback bodies are compiled with real inference.
 */
function consumerSource(
  shape: TypeShape,
  only?: ReadonlySet<string>,
): {
  source: string
  states: Array<string>
} {
  const witnesses: Array<string> = []
  const observed: Array<string> = []
  const addWitness = (state: string, source: string) => {
    if (!only || only.has(state)) {
      witnesses.push(source)
      observed.push(state)
    }
  }
  const row = `{ id: ${shape.key}; value: ${shape.value}; profile${shape.optional ? `?` : ``}: Profile; nullable: Profile | null; tags: Array<${shape.value}>; createdAt: Date }`
  for (const projection of projections) {
    for (const composition of compositions) {
      const query = composeQuery(
        rootQuery(projection, `chosen`),
        rootQuery(projection, `peer`),
        composition,
      )
      const expected = projection.endsWith(`projection`)
        ? `{ id: ${shape.key}; payload: Profile${shape.optional ? ` | undefined` : ``} }`
        : `Row`
      addWitness(
        `root/${projection}/${composition}`,
        `{
        const collection = createLiveQueryCollection({ query: ${query} });
        type Observation_${projection.replaceAll(`-`, `_`)}_${composition.replaceAll(`-`, `_`)} = Assert<SameShape<Normalize<typeof collection.toArray[number]>, Normalize<Published<${expected}>>>>;
      }`,
      )
    }
  }
  for (const projection of inlineShapes) {
    let query = `new Query().from({ child: rows }).where(({ child }) => eq(child.id, parent.id))`
    let value = `Row`
    let rowBearing = true
    if (projection === `selected-whole`)
      query += `.select(({ child }) => child)`
    if (projection === `nullable-whole`) {
      query += `.leftJoin({ missing: rows }, ({ child, missing }) => eq(child.id, missing.id)).select(({ missing }) => missing)`
      value = `Published<Row> | Missing<Published<Row>>`
    }
    if (projection === `object`) {
      query += `.select(({ child }) => ({ value: child.value }))`
      value = `{ value: ${shape.value} }`
      rowBearing = false
    }
    if (projection === `nested-object`) {
      query += `.select(({ child }) => ({ nested: { value: child.value } }))`
      value = `{ nested: { value: ${shape.value} } }`
      rowBearing = false
    }
    if (projection === `array` || projection === `date`) {
      query += `.select(({ child }) => child.${projection === `array` ? `tags` : `createdAt`})`
      value = projection === `array` ? `Array<${shape.value}>` : `Date`
      rowBearing = false
    }
    for (const form of inlineForms) {
      // Collection-valued includes require record projections. Arrays and Date
      // are legal only in the inline forms, as query construction enforces.
      if (
        form === `facade` &&
        (projection === `array` || projection === `date`)
      )
        continue
      // Facades publish ordinary projections as rows; inline forms do not.
      const expected =
        projection === `nullable-whole`
          ? form === `facade`
            ? `Published<Row | Missing<Row>>`
            : value
          : rowBearing || form === `facade`
            ? `Published<${value}>`
            : value
      const selected =
        form === `findOne`
          ? `materialize((${query}).findOne())`
          : `${form === `facade` ? `include` : form}(${query})`
      const observation =
        form === `facade`
          ? `typeof collection.toArray[number]['children']['toArray'][number]`
          : form === `findOne`
            ? `typeof collection.toArray[number]['children']`
            : `typeof collection.toArray[number]['children'][number]`
      addWitness(
        `inline/${projection}/${form}`,
        `{
        const collection = createLiveQueryCollection({ query: new Query().from({ parent: rows }).select(({ parent }) => ({ id: parent.id, children: ${selected} })) });
        type Observation_${projection.replaceAll(`-`, `_`)}_${form} = Assert<SameShape<Normalize<${observation}>, Normalize<${expected}${form === `findOne` ? ` | undefined` : ``}>>>;
      }`,
      )
    }
  }
  return {
    source: `
    import { BTreeIndex, Query, createCollection, createLiveQueryCollection, eq, include, materialize, toArray } from '@tanstack/db';
    import type { WithoutVirtualProps } from '@tanstack/db';
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
    type Assert<T extends true> = T;
    type Normalize<T> = T extends unknown ? { [K in keyof T]: T[K] } : never;
    type Published<T> = T extends unknown ? T & { readonly $key: string | number; readonly $collectionId: string; readonly $origin: 'local' | 'remote'; readonly $hasPendingWrites: boolean } : never;
    type Missing<T> = T extends unknown ? { [K in keyof T]?: undefined } : never;
    type IsAny<T> = 0 extends (1 & T) ? true : false;
    type HasAny<T> = IsAny<T> extends true ? true : T extends Date ? true extends { [K in Exclude<keyof T, keyof Date>]-?: HasAny<T[K]> }[Exclude<keyof T, keyof Date>] ? true : false : T extends ReadonlyArray<infer V> ? HasAny<V> : T extends object ? true extends { [K in keyof T]-?: HasAny<T[K]> }[keyof T] ? true : false : false;
    type AllKeys<T> = T extends unknown ? keyof T : never;
    type ReadonlyKeys<T> = T extends unknown ? { [K in keyof T]-?: Equal<{ [P in K]: T[P] }, { -readonly [P in K]: T[P] }> extends true ? never : K }[keyof T] : never;
    // Keep modifiers attached to each union member. A global readonly-key union
    // would let a correct member hide a mutable sibling with the same key.
    type RecordSignature<T> = { keys: keyof T; fields: { [K in keyof T]-?: { value: Signature<T[K]>; readonly: K extends ReadonlyKeys<T> ? true : false; optional: {} extends Pick<T, K> ? true : false } } };
    type Signature<T> = T extends Date ? { opaque: 'Date'; extras: RecordSignature<Omit<T, keyof Date>> } : T extends ReadonlyArray<infer V> ? { array: Signature<V>; mutable: T extends Array<unknown> ? true : false; extras: RecordSignature<Omit<T, keyof Array<unknown> | keyof ReadonlyArray<unknown>>> } : T extends object ? RecordSignature<T> : { scalar: T };
    type SameShape<A, B> = true extends HasAny<A> | HasAny<B> ? false : [Signature<A>] extends [Signature<B>] ? [Signature<B>] extends [Signature<A>] ? Equal<AllKeys<A>, AllKeys<B>> : false : false;
    type MutableOne<T> = T extends { kind: 'b' } ? Omit<T, '$key'> & { $key: string | number } : T;
    type Profile = { label: ${shape.value} };
    type Base = ${row};
    type Row = Base${shape.union ? ` & ({ kind: 'a'; left: string } | { kind: 'b'; right: number })` : ``};
    const rows = createCollection<Row>({ getKey: row => row.id, sync: { sync: ({ markReady }) => { markReady(); } } });
    type Removal = Assert<SameShape<Normalize<WithoutVirtualProps<Published<Row>>>, Normalize<Row>>>;
    const nestedQuery = createLiveQueryCollection({ query: new Query().from({ row: rows }).select(({ row }) => {
      type NestedHasNoVirtualNames = Assert<Equal<Extract<keyof NonNullable<typeof row.profile>, '$key' | '$collectionId' | '$origin' | '$hasPendingWrites'>, never>>;
      type RootNames = Assert<Equal<Extract<keyof typeof row, '$key' | '$collectionId' | '$origin' | '$hasPendingWrites'>, '$key' | '$collectionId' | '$origin' | '$hasPendingWrites'>>;
      type RemovedAlias = Assert<Equal<Extract<keyof typeof row, '$synced'>, never>>;
      return { id: row.id, label: row.nullable?.label, sourceKey: row.$key, sourceCollectionId: row.$collectionId, sourceOrigin: row.$origin, sourcePending: row.$hasPendingWrites };
    }) });
    type CallbackValues = Assert<SameShape<Normalize<typeof nestedQuery.toArray[number]>, Normalize<Published<{ id: ${shape.key}; label: ${shape.value} | undefined; sourceKey: string | number; sourceCollectionId: string; sourceOrigin: 'local' | 'remote'; sourcePending: boolean }>>>>;
    rows.createIndex(row => {
      type RootNames = Assert<Equal<Extract<keyof typeof row, '$key' | '$collectionId' | '$origin' | '$hasPendingWrites'>, '$key' | '$collectionId' | '$origin' | '$hasPendingWrites'>>;
      type RemovedAlias = Assert<Equal<Extract<keyof typeof row, '$synced'>, never>>;
      type NestedHasNoVirtualNames = Assert<Equal<Extract<keyof NonNullable<typeof row.profile>, '$key' | '$collectionId' | '$origin' | '$hasPendingWrites'>, never>>;
      return row.id;
    }, { indexType: BTreeIndex });
    ${witnesses.join(`\n`)}
  `,
    states: [
      ...observed,
      `nested-query-ref`,
      `nested-index-ref`,
      `union-removal`,
    ],
  }
}

// Cache only dependency syntax trees. The consumer gets a new tree per history;
// TypeScript retains full diagnostics and their exact file/span/code identity.
const packageRoot = resolve(process.cwd())
const filename = resolve(packageRoot, `tests/__generated-virtual-types.ts`)
const config = ts.readConfigFile(
  resolve(packageRoot, `tsconfig.json`),
  ts.sys.readFile,
)
if (config.error)
  throw new Error(
    ts.flattenDiagnosticMessageText(config.error.messageText, `\n`),
  )
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot)
const options: ts.CompilerOptions = {
  ...parsed.options,
  noEmit: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
  paths: {
    ...parsed.options.paths,
    '@tanstack/db': [resolve(packageRoot, `src/index.ts`)],
  },
}
const host = ts.createCompilerHost(options)
const original = host.getSourceFile.bind(host)
const cached = new Map<string, ts.SourceFile>()
let generated = ``
host.getSourceFile = (
  name,
  languageVersion,
  onError,
  shouldCreateNewSourceFile,
) => {
  if (name === filename)
    return ts.createSourceFile(name, generated, languageVersion, true)
  let source = cached.get(name)
  if (!source) {
    source = original(name, languageVersion, onError, shouldCreateNewSourceFile)
    if (source) cached.set(name, source)
  }
  return source
}
let previous: ts.Program | undefined
function compileConsumer(source: string): ReadonlyArray<ts.Diagnostic> {
  generated = source
  const program = ts.createProgram([filename], options, host, previous)
  previous = program
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
  return diagnostics
}
/**
 * Compiler acceptance alone does not establish a legal query grammar. Erase
 * types and replay the exact consumer through public query/index construction.
 * This supplies no row/publication evidence. Every acquired Collection registers
 * cleanup immediately, including if a later construction throws.
 */
async function checkConsumerConstruction(source: string): Promise<void> {
  const cleanups: Array<() => Promise<void>> = []
  const track = <
    T extends { cleanup: (options: { dependents: boolean }) => Promise<void> },
  >(
    collection: T,
  ): T => {
    cleanups.unshift(() => collection.cleanup({ dependents: true }))
    return collection
  }
  await checkWithCleanup(async () => {
    const parsedConsumer = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.ES2022,
      true,
    )
    const importFree = ts.createPrinter().printFile(
      ts.factory.updateSourceFile(
        parsedConsumer,
        parsedConsumer.statements.filter(
          (statement) => !ts.isImportDeclaration(statement),
        ),
      ),
    )
    // Reparse printed source before binding. Removing imports only in an emit
    // transform leaves CommonJS's bound import substitutions in the output.
    const { outputText, diagnostics = [] } = ts.transpileModule(importFree, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
      reportDiagnostics: true,
    })
    checkConsumer(diagnostics)
    const api = {
      ...publicDb,
      createCollection: (
        ...arguments_: Parameters<typeof publicDb.createCollection>
      ) => track(publicDb.createCollection(...arguments_)),
      createLiveQueryCollection: (
        ...arguments_: Parameters<typeof publicDb.createLiveQueryCollection>
      ) => track(publicDb.createLiveQueryCollection(...arguments_)),
    }
    // The source is generated solely from this file's closed grammar. Imports
    // are removed by TypeScript's AST transform; public exports supply bindings.
    const construct = new Function(
      `api`,
      `exports`,
      `const { BTreeIndex, Query, createCollection, createLiveQueryCollection, eq, include, materialize, toArray } = api;\n${outputText}`,
    )
    construct(api, {})
  }, cleanups)
}
function checkConsumer(diagnostics: ReadonlyArray<ts.Diagnostic>): void {
  expect(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => packageRoot,
      getNewLine: () => `\n`,
    }),
  ).toBe(``)
}
declareOracle({
  grammar: [typeShapes],
  model: [consumerSource],
  check: [checkConsumer, checkConsumerConstruction],
})
test.each(typeShapes)(
  `preserves generated public row/value types: %j`,
  async (shape) => {
    publicTypesEntered = true
    reach.beginHistory()
    const consumer = consumerSource(shape)
    await checkConsumerConstruction(consumer.source)
    reach.reach(`construction-admitted`)
    const diagnostics = compileConsumer(consumer.source)
    for (const state of consumer.states) reach.reach(state)
    checkConsumer(diagnostics)
  },
  30_000,
)

// Feed a hostile type observation through the actual compiler/checker. Altering
// only the expected law emulates leaked value metadata or lost nullability;
// the legal production query remains identical to its accepted neighbor.
test.each([
  `value-metadata`,
  `lost-nullability`,
  `one-branch-readonly`,
  `nested-any`,
  `date-metadata-any`,
  `nested-optional-metadata`,
  `nested-readonly`,
] as const)(
  `rejects a hostile public type observation: %s`,
  (fault) => {
    const consumer = consumerSource(
      fault === `one-branch-readonly` ? typeShapes[1]! : typeShapes[0]!,
      new Set([
        fault === `value-metadata`
          ? `inline/object/toArray`
          : fault === `lost-nullability`
            ? `inline/nullable-whole/toArray`
            : fault === `date-metadata-any`
              ? `inline/date/toArray`
              : `root/functional-direct/direct`,
      ]),
    )
    checkConsumer(compileConsumer(consumer.source))
    const wrong =
      fault === `value-metadata`
        ? consumer.source.replace(
            `Normalize<{ value: string }>>>`,
            `Normalize<Published<{ value: string }>>>>`,
          )
        : fault === `lost-nullability`
          ? consumer.source.replaceAll(
              `Published<Row> | Missing<Published<Row>>`,
              `Published<Row>`,
            )
          : fault === `one-branch-readonly`
            ? consumer.source.replace(
                `Normalize<Published<Row>>>>`,
                `Normalize<MutableOne<Published<Row>>>>>`,
              )
            : fault === `date-metadata-any`
              ? consumer.source.replace(
                  `Normalize<Date>>>`,
                  `Normalize<Date & { readonly $key: any }>>>`,
                )
              : fault === `nested-optional-metadata`
                ? consumer.source.replace(
                    `Normalize<Published<Row>>>>`,
                    `Normalize<Published<Omit<Row, 'profile'> & { profile: Profile & { readonly $key?: string } }>>>>`,
                  )
                : fault === `nested-readonly`
                  ? consumer.source.replace(
                      `Normalize<Published<Row>>>>`,
                      `Normalize<Published<Omit<Row, 'profile'> & { profile: { readonly label: string } }>>>>`,
                    )
                  : consumer.source.replace(
                      `type Profile = { label: string };`,
                      `type Profile = { label: any };`,
                    )
    expect(wrong).not.toBe(consumer.source)
    const diagnostics = compileConsumer(wrong)
    // A syntax/setup error cannot stand in for a rejected wrong type. Require
    // only failed Assert constraints in this generated consumer's law aliases.
    expect(diagnostics.length).toBeGreaterThan(0)
    for (const diagnostic of diagnostics) {
      expect(diagnostic.file?.fileName).toBe(filename)
      expect(diagnostic.code).toBe(2344)
      const text = diagnostic.file!.text
      const lineStart = text.lastIndexOf(`\n`, diagnostic.start) + 1
      const lineEnd = text.indexOf(`\n`, diagnostic.start)
      expect(text.slice(lineStart, lineEnd)).toMatch(
        /type (Observation_|Removal|CallbackValues)/,
      )
    }
    expect(() => checkConsumer(diagnostics)).toThrow()
  },
  30_000,
)

// Grammar controls preserve the admission checkpoint that exposed two invalid
// early fixtures. Their legal neighbors run the identical generated body.
test.each([`non-record-facade`, `missing-index-type`] as const)(
  `rejects an illegal generated construction at admission: %s`,
  async (fault) => {
    const consumer = consumerSource(
      typeShapes[0]!,
      new Set([`inline/array/toArray`]),
    )
    await checkConsumerConstruction(consumer.source)
    const wrong =
      fault === `non-record-facade`
        ? consumer.source.replace(`children: toArray(`, `children: include(`)
        : consumer.source.replace(`, { indexType: BTreeIndex }`, ``)
    expect(wrong).not.toBe(consumer.source)
    await expect(checkConsumerConstruction(wrong)).rejects.toThrow(
      fault === `non-record-facade`
        ? /must select an object when materializing as a Collection/
        : /No index type specified and no defaultIndexType set/,
    )
  },
)
