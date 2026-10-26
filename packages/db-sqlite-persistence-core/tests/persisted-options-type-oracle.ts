/**
 * # Persistence options preserve admitted caller contracts
 *
 * Authority: docs/guides/sqlite-persistence.md, "Add persistence to a synced
 * Collection", composes adapter options with persistedCollectionOptions and
 * createCollection. The createCollection API assigns schema input to insert,
 * schema output to reads, and the configured key and utilities to callers.
 * Wrapping must preserve those distinctions, including without a schema.
 * The exported PersistedCollectionUtils interface in src/persisted.ts and the
 * QueryCollectionUtils reference specify the local and adapter capabilities.
 * docs/guides/schemas.md requires schema input to accept schema output, so
 * already-transformed rows remain legal mutation input.
 * docs/reference/type-aliases/WithVirtualProps.md and the VirtualRowProps
 * interface specify the readonly fields on a published row.
 *
 * Each type history declares a row/key/utility shape, constructs options,
 * wraps them, and observes public types at compilation. A utility-admission
 * driver observes wrapping
 * through the real core/browser entry before persistence resolution. Neither
 * driver executes Collection mutations, parses a schema, uses SQLite, or
 * establishes published declaration/package resolution. Compiler acceptance
 * observes type preservation; return/throw observes utility admission. The
 * declared shapes and reserved-name rule supply independent expected results.
 */
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import fc from 'fast-check'
import ts from 'typescript'
import { it } from 'vitest'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../../db/tests/oracle-config.js'
import { createOracleReach } from '../../db/tests/oracle-reach.js'
import type {
  PersistedCollectionPersistence,
  PersistenceAdapter,
  persistedCollectionOptions,
} from '../src/index.js'
import type { StandardSchemaV1 } from '@standard-schema/spec'

type Receiver = `core` | `browser`
type Shape = {
  key: string
  keyName: string
  fields: Array<{
    name: string
    type: string
    optional: boolean
    inputOptional: boolean
    readonly?: boolean
    inputReadonly?: boolean
  }>
  utilityName: string
  utilityArgument: string
  utilityResult: string
  schemaVersion?: number
  networkTimeoutMs?: number
}

const primitives = [`string`, `number`, `boolean`] as const
const fieldTypes = [
  ...primitives,
  `string | null`,
  `ReadonlyArray<number>`,
  `{ value: string }`,
] as const

/**
 * Grammar: rows have one string/number-compatible key and 1–4 other fields;
 * fields may be optional, readonly, nullable, arrays, or a nested record. Each history
 * varies property names, key domains, and a utility's argument/return types.
 * Its construction paths cross schema-free/transforming schema, local/synced,
 * inline/typed-spread config, and inferred/explicit type arguments. Those
 * crossings matter: a fix to one overload or only untyped literals is wrong.
 *
 * Names are disjoint by construction. Boolean keys are excluded as illegal.
 * Partial explicit type arguments select TypeScript's utility default, so
 * that path deliberately supplies no custom utility. The full and inferred
 * paths check utility preservation. Query Collection is always synced and
 * schema-free here; it supplies its real adapter utility namespace.
 * Inline schema forms also leave getKey's row unannotated. The schema must
 * contextually supply its output type without help from a caller annotation.
 * Every history includes mutable and readonly first-field neighbors in both
 * persistence modes, with and without a schema. Other modifiers vary freely.
 * A phantom schema generic without a schema value preserves an accepted source
 * form; it does not establish a runtime schema promise.
 */
const shapeArbitrary: fc.Arbitrary<Shape> = fc.record({
  key: fc.constantFrom(
    `string`,
    `number`,
    `string | number`,
    `"alpha" | "beta"`,
    `1 | 2`,
    `string & { readonly brand: "key" }`,
  ),
  keyName: fc.constantFrom(`id`, `key`, `identifier`),
  fields: fc.uniqueArray(
    fc.record({
      name: fc.constantFrom(`rank`, `title`, `completed`, `payload`, `label`),
      type: fc.constantFrom(...fieldTypes),
      optional: fc.boolean(),
      inputOptional: fc.boolean(),
      readonly: fc.boolean(),
      inputReadonly: fc.boolean(),
    }),
    { selector: (field) => field.name, minLength: 1, maxLength: 4 },
  ),
  utilityName: fc.constantFrom(
    `labelLength`,
    `titleLength`,
    `measure`,
    `convert`,
  ),
  utilityArgument: fc.constantFrom(...primitives),
  utilityResult: fc.constantFrom(...primitives),
  schemaVersion: fc.integer({ min: 1, max: 100 }),
  networkTimeoutMs: fc.integer({ min: 0, max: 10_000 }),
})

// Original regressions are inputs, never separate expected answers. They use
// the same model, construction paths, and comparison as generated histories.
const replayShapes: ReadonlyArray<Shape> = [
  {
    key: `string`,
    keyName: `id`,
    fields: [
      { name: `rank`, type: `number`, optional: false, inputOptional: false },
      { name: `label`, type: `string`, optional: false, inputOptional: true },
    ],
    utilityName: `labelLength`,
    utilityArgument: `string`,
    utilityResult: `number`,
  },
  {
    key: `number`,
    keyName: `id`,
    fields: [
      { name: `rank`, type: `number`, optional: false, inputOptional: false },
      { name: `label`, type: `string`, optional: false, inputOptional: false },
    ],
    utilityName: `labelLength`,
    utilityArgument: `string`,
    utilityResult: `number`,
  },
  {
    key: `string`,
    keyName: `id`,
    fields: [
      { name: `title`, type: `string`, optional: false, inputOptional: false },
      {
        name: `completed`,
        type: `boolean`,
        optional: false,
        inputOptional: false,
      },
    ],
    utilityName: `titleLength`,
    utilityArgument: `string`,
    utilityResult: `number`,
  },
]

const packageRoot = fileURLToPath(new URL(`../`, import.meta.url))
const repositoryRoot = resolve(packageRoot, `../..`)

/**
 * Independent model: insert accepts the declared input; reads retain every
 * declared output field; get takes exactly the declared key; user utilities
 * keep their declared signatures. A transforming schema changes one required
 * field from string | number to number, distinguishing input/output reversal
 * while accepting output as input, as required by the schema guide.
 * A public get result includes undefined for a missing row, and excludes null.
 * Other schema fields may become required, retaining the original oracle's
 * optional-input/required-output histories as instances of this grammar.
 * An optional output field stays optional on input. Property readonly modifiers
 * vary independently; publication and insert input retain the declared types.
 * Public PendingMutation and LoadSubsetOptions are trusted parameter-domain
 * carriers, never used to compute capability names, modifiers, or signatures.
 * Local additions are observed separately because UtilsRecord has an index
 * signature; comparing just the caller's keys cannot observe those additions.
 * Configured cells independently specify numeric schema versions/timeouts,
 * eager/on-demand mode and network-first strategy from the SQLite guide.
 * The model does not reproduce persistence or Collection's overload logic.
 * An unannotated schema callback receives exactly the declared output row.
 */
function rowType(
  shape: Shape,
  transformed: boolean,
  output: boolean,
  modifiers?: `mutable` | `readonly`,
): string {
  const fields = shape.fields.map((field, index) => {
    const changed = transformed && index === 0
    const optional = changed
      ? false
      : transformed && !output
        ? field.optional || field.inputOptional
        : field.optional
    const type = changed ? (output ? `number` : `string | number`) : field.type
    const readonly =
      index === 0 && modifiers !== undefined
        ? modifiers === `readonly`
        : transformed && !output
          ? field.inputReadonly
          : field.readonly
    return `${readonly ? `readonly ` : ``}${field.name}${optional ? `?` : ``}: ${type}`
  })
  return `{ ${shape.keyName}: Key; ${fields.join(`; `)} }`
}

/**
 * One shared refinement check for every generated form and receiving path.
 * Exact equality rejects widening as well as narrowing; the IsAny guard also
 * rejects a public read erased to any. The expected published row spells out
 * the documented virtual fields without importing production's type helper.
 * PublicShape flattens intersection presentation while retaining every key,
 * readonly/optional modifier, and undefined in the public result.
 * Negative insert/key/utility/sync observations are derived from the shape,
 * so @ts-expect-error cannot silently survive a checker that admits everything.
 */
function comparison(
  shape: Shape,
  utilities: string,
  transformed: boolean,
  local = false,
) {
  const field = shape.fields[0]!
  return `
    declare const input: Input;
    declare const key: Key;
    collection.insert(input);
    collection.get(key);
    type Result = ReturnType<typeof collection.get>;
    type Read = NonNullable<Result>;
    type Published = Output & {
      readonly $hasPendingWrites: boolean;
      readonly $synced: boolean;
      readonly $origin: "local" | "remote";
      readonly $key: Key;
      readonly $collectionId: string;
    };
    type LocalCapabilities = {
      acceptMutations: (transaction: {
        mutations: Array<PendingMutation<Record<string, unknown>>>
      }) => Promise<void> | void;
      getLeadershipState?: () => { nodeId: string; isLeader: boolean };
      forceReloadSubset?: (options: LoadSubsetOptions) => Promise<void> | void;
    };
    type Laws = [
      Assert<Equal<Parameters<typeof collection.insert>[0], Input | Array<Input>>>,
      Assert<Equal<Parameters<typeof collection.get>, [Key]>>,
      Assert<Equal<PublicShape<Result>, PublicShape<Published | undefined>>>,
      Assert<Equal<IsAny<Read>, false>>,
      Assert<Equal<${utilities === `AdapterUtils` ? `QueryCapabilities<typeof collection.utils>` : `Pick<typeof collection.utils, keyof ${utilities}>`}, ${utilities}>>${
        local
          ? `,
      Assert<Equal<Pick<typeof collection.utils, keyof LocalCapabilities>, LocalCapabilities>>`
          : ``
      }
    ];
    // @ts-expect-error a symbol is outside every generated field's input type
    collection.insert({ ...input, ${field.name}: Symbol() });
    // @ts-expect-error a symbol is outside every legal key domain
    collection.get(Symbol());
    ${
      utilities === `Utils`
        ? `// @ts-expect-error a symbol is outside the declared utility argument
           collection.utils.${shape.utilityName}(Symbol());`
        : ``
    }
    ${
      transformed
        ? `declare const output: Output;
           type SchemaInputLaw = Assert<Equal<Output extends Input ? true : false, true>>;
           collection.insert(output);`
        : ``
    }
    const rejectedSyncOptions = { ...options, persistence, sync: undefined };
    // The positive neighbor changes only sync. A collateral invalid property
    // must fail here rather than masquerading as the expected rejection below.
    persistedCollectionOptions({ ...rejectedSyncOptions, sync: { sync: ({ markReady }) => markReady() } });
    persistedCollectionOptions({ ...rejectedSyncOptions, sync: undefined });
  `
}

type Cell = {
  transformed: boolean
  synced: boolean
  typed: boolean
  contextualKey: boolean
  arguments: `inferred` | `row-key` | `full` | `phantom-schema`
  configuration?: `eager` | `on-demand` | `network-first`
  modifiers?: `mutable` | `readonly`
}

function declarations(
  shape: Shape,
  transformed: boolean,
  modifiers?: Cell[`modifiers`],
): string {
  return `
    type Key = ${shape.key};
    type Input = ${rowType(shape, transformed, false, modifiers)};
    type Output = ${rowType(shape, transformed, true, modifiers)};
    type Utils = { ${shape.utilityName}: (value: ${shape.utilityArgument}) => ${shape.utilityResult} };
    declare const utils: Utils;
    declare const schema: StandardSchemaV1<Input, Output>;
  `
}

/**
 * Production driver: call the real wrapper and createCollection in TS source.
 * Contextual callbacks occur directly inside the schema-bearing argument;
 * spreading a pretyped callback cannot observe contextual inference. Their
 * parameter type is another public observation of the same output-row law.
 */
function collectionSource(shape: Shape, cell: Cell): string {
  const hasUtils = cell.arguments !== `row-key`
  const schemaType = cell.transformed ? `typeof schema` : `never`
  const utilsType = hasUtils ? `Utils` : `{}`
  const configuration = cell.configuration
    ? `schemaVersion: ${shape.schemaVersion ?? 1}, syncMode: "${cell.configuration === `on-demand` ? `on-demand` : `eager`}" as const, ${cell.configuration === `network-first` ? `initialRender: { strategy: "network-first" as const, networkTimeoutMs: ${shape.networkTimeoutMs ?? 0} },` : ``}`
    : ``
  const configProperties = (contextualKey: boolean) => `
    id: "generated",
    ${configuration}
    getKey: ${
      contextualKey
        ? `(row) => {
            type CallbackInput = Assert<Equal<typeof row, Output>>;
            return row.${shape.keyName};
          }`
        : `(row: Output) => row.${shape.keyName}`
    },
    ${cell.transformed ? `schema,` : ``}
    ${hasUtils ? `utils,` : ``}
  `
  const annotation = cell.typed
    ? `: Omit<CollectionConfig<Output, Key, ${schemaType}, ${utilsType}>, "sync">${
        cell.transformed ? ` & { schema: typeof schema }` : ``
      }`
    : ``
  const typeArguments =
    cell.arguments === `inferred`
      ? ``
      : cell.transformed
        ? `<typeof schema, Key${hasUtils ? `, Utils` : ``}>`
        : `<Output, Key${hasUtils ? `, ${cell.arguments === `phantom-schema` ? `typeof schema` : `never`}, Utils` : ``}>`
  const syncProperty = cell.synced
    ? `sync: { sync: ({ markReady }) => {
        type ReadinessCallback = Assert<Equal<typeof markReady, () => void>>;
        markReady();
      } },`
    : ``
  const wrappedOptions = cell.contextualKey
    ? `{ ${configProperties(true)} persistence, ${syncProperty} }`
    : cell.typed
      ? `options`
      : `{ ...config, persistence, ${syncProperty} }`
  return `
    ${declarations(shape, cell.transformed, cell.modifiers)}
    ${
      cell.configuration
        ? `
      type DeclaredOptions = ${cell.synced ? `PersistedSyncWrappedOptions` : `PersistedLocalOnlyOptions`}<Output, Key, ${schemaType}, ${utilsType}>;
      type ConfigurationLaw = [
        Assert<Equal<DeclaredOptions["schemaVersion"], number | undefined>>,
        Assert<Equal<DeclaredOptions["syncMode"], "eager" | "on-demand" | undefined>>,
        Assert<Equal<DeclaredOptions["initialRender"], { strategy: "network-first"; networkTimeoutMs?: number } | undefined>>
      ];`
        : ``
    }
    const config${annotation} = { ${configProperties(false)} };
    const options = {
      ...config, persistence,
      ${syncProperty}
    } satisfies typeof config & { persistence: PersistedCollectionPersistence; sync?: SyncConfig<Output, Key> };
    const collection = createCollection(persistedCollectionOptions${typeArguments}(${wrappedOptions}));
    ${comparison(shape, hasUtils ? `Utils` : `{}`, cell.transformed, !cell.synced)}
  `
}

/**
 * Query's documented utility capability model is independent of adapter output.
 * Direct write signatures vary with generated rows/keys; state fields and the
 * closed namespace follow the public QueryCollectionUtils reference. Refetch
 * compares its exact parameter tuple and a non-any Promise-of-array envelope.
 * A supplemental transparency relation preserves the full payload across the
 * wrapper; QueryObserverResult internals have no independent model here.
 * This single model replaces standalone fixed refetch/nonexistent-method calls.
 * Exact namespace equality pins the current API. An intentional documented
 * utility addition must update this model; closure does not prohibit additions.
 */
function querySource(shape: Shape): string {
  return `
    ${declarations(shape, false)}
    type QueryCapabilities<U> = {
      [K in keyof U]: K extends "refetch"
        ? U[K] extends (...args: infer P) => unknown ? P : never
        : U[K]
    };
    type AdapterUtils = {
      writeInsert: (data: Input | Array<Input>) => Promise<void>;
      writeUpdate: (data: Partial<Output> | Array<Partial<Output>>) => Promise<void>;
      writeDelete: (keys: Key | Array<Key>) => Promise<void>;
      writeUpsert: (data: Partial<Output> | Array<Partial<Output>>) => Promise<void>;
      writeBatch: (callback: () => void) => Promise<void>;
      clearError: () => Promise<void>;
      refetch: [opts?: { throwOnError?: boolean }];
      lastError: unknown;
      isError: boolean;
      errorCount: number;
      isFetching: boolean;
      isRefetching: boolean;
      isLoading: boolean;
      dataUpdatedAt: number;
      fetchStatus: "fetching" | "paused" | "idle";
    };
    const options = queryCollectionOptions({
      id: "query-generated", queryClient: new QueryClient(),
      queryKey: ["generated"],
      queryFn: (): Promise<Array<Output>> => Promise.resolve([]),
      getKey: (row) => row.${shape.keyName},
    });
    const direct = createCollection(options);
    const collection = createCollection(persistedCollectionOptions({ ...options, persistence }));
    ${comparison(shape, `AdapterUtils`, false)}
    // Supplemental transparency relation retains the full refetch payload.
    // The independent model above prevents a shared wrong answer passing it.
    type AdapterPreservation = Assert<Equal<typeof collection.utils, typeof direct.utils>>;
    type RefetchResult = ReturnType<typeof collection.utils.refetch>;
    type RefetchValues = Awaited<RefetchResult>;
    type RefetchValue = RefetchValues[number];
    type RefetchLaw = [
      Assert<Equal<IsAny<RefetchResult>, false>>,
      Assert<Equal<IsAny<RefetchValues>, false>>,
      Assert<Equal<IsAny<RefetchValue>, false>>,
      Assert<Equal<RefetchResult extends Promise<Array<object | void>> ? true : false, true>>
    ];
  `
}

/**
 * The compiler host caches unchanged source files between generated histories.
 * Only the generated consumer exists in memory. Module resolution uses source
 * aliases, so core, browser re-exports, and Query Collection are real entries.
 * A semantic builder reuses dependency diagnostics across histories and both
 * campaigns. It retains every source diagnostic, apart from the exact expected
 * sync-admission observations paired with an otherwise identical legal call.
 */
function createCompiler(receiver: Receiver) {
  const consumerRoot =
    receiver === `core`
      ? packageRoot
      : resolve(repositoryRoot, `packages/browser-db-sqlite-persistence`)
  const configPath = resolve(consumerRoot, `tsconfig.json`)
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, `\n`),
    )
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    consumerRoot,
  )
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: true,
    noUnusedLocals: false,
    noUnusedParameters: false,
    paths: {
      ...parsed.options.paths,
      '@standard-schema/spec': [
        resolve(packageRoot, `node_modules/@standard-schema/spec`),
      ],
      '@tanstack/db-sqlite-persistence-core': [
        resolve(packageRoot, `src/index.ts`),
      ],
      '@tanstack/db-sqlite-persistence-core/*': [resolve(packageRoot, `src/*`)],
      '@tanstack/query-db-collection': [
        resolve(repositoryRoot, `packages/query-db-collection/src/index.ts`),
      ],
    },
  }
  const filename = resolve(
    consumerRoot,
    `tests/__generated-persisted-options.ts`,
  )
  const host = ts.createCompilerHost(options)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  const files = new Map<string, ts.SourceFile>()
  let generated = ``
  let revision = 0
  host.getSourceFile = (
    name,
    languageVersion,
    onError,
    shouldCreateNewSourceFile,
  ) => {
    if (name === filename)
      return Object.assign(
        ts.createSourceFile(name, generated, languageVersion, true),
        { version: String(revision) },
      )
    let source = files.get(name)
    if (!source) {
      source = originalGetSourceFile(
        name,
        languageVersion,
        onError,
        shouldCreateNewSourceFile,
      )
      if (source) {
        Object.assign(source, { version: `0` })
        files.set(name, source)
      }
    }
    return source
  }
  let previous: ts.SemanticDiagnosticsBuilderProgram | undefined
  return (source: string) => {
    generated = source
    revision++
    const roots = [filename]
    if (receiver === `browser`) {
      roots.push(resolve(consumerRoot, `src/vite-env.d.ts`))
    }
    const program = ts.createSemanticDiagnosticsBuilderProgram(
      roots,
      options,
      host,
      previous,
    )
    previous = program
    const diagnostics = [
      ...parsed.errors,
      ...program.getOptionsDiagnostics(),
      ...program.getGlobalDiagnostics(),
      ...program.getSyntacticDiagnostics(),
      ...program.getSemanticDiagnostics(),
      ...program.getDeclarationDiagnostics(),
    ]
    // Each expected error has its own unsuppressed call. Match the explicit
    // sync property span, require one overload rejection, and retain every other
    // diagnostic (including dependency errors). The positive neighbor above
    // proves that changing only sync admits this exact candidate.
    const rejected = [
      ...source.matchAll(
        /persistedCollectionOptions\((\{ \.\.\.rejectedSyncOptions, sync: undefined \})\);/g,
      ),
    ]
    const unexpected = [...diagnostics]
    for (const match of rejected) {
      const start =
        match.index +
        `persistedCollectionOptions(`.length +
        match[1]!.indexOf(`sync:`)
      const index = unexpected.findIndex(
        (diagnostic) =>
          diagnostic.file?.fileName === filename &&
          diagnostic.start === start &&
          diagnostic.length === `sync`.length &&
          diagnostic.code === 2769,
      )
      if (index < 0)
        throw new Error(`Missing exact sync admission rejection at ${start}`)
      unexpected.splice(index, 1)
    }
    if (rejected.length === 0) throw new Error(`No sync admission observations`)
    if (unexpected.length > 0) {
      throw new Error(
        ts.formatDiagnosticsWithColorAndContext(unexpected, {
          getCanonicalFileName: (name) => name,
          getCurrentDirectory: () => repositoryRoot,
          getNewLine: () => `\n`,
        }),
      )
    }
  }
}

const states = [
  `schema-free-local`,
  `schema-free-synced`,
  `schema-input-output`,
  `typed-spread`,
  `inferred-arguments`,
  `explicit-arguments`,
  `row-key-arguments`,
  `schema-contextual-key`,
  `query-adapter`,
  `local-capabilities`,
  `configured-options`,
  `on-demand-options`,
  `network-first-options`,
  `contextual-sync`,
  `phantom-schema-argument`,
  `schema-compatible-input`,
  `readonly-input`,
  `readonly-output`,
  `mutable-fields`,
] as const

/**
 * Every generated history crosses the structurally required forms. Reach is
 * recorded only after the generated consumer passes compilation. Replay uses
 * the shared seed/path/property interface and bypasses both normal campaigns.
 * Fixed and fresh-seed campaigns use the identical grammar, budget, and check.
 */
export function registerPersistedOptionsTypeOracle(receiver: Receiver): void {
  const propertyName = `persisted-options.types.${receiver}`
  const replay = readOracleRunConfig()
  if (
    replay.replayPath !== undefined &&
    replay.replayProperty !== propertyName
  ) {
    it.skip(`replay selects another type-preservation receiver`, () => {})
    return
  }
  const campaigns =
    replay.replayPath === undefined ? [`fixed`, `random`] : [`replay`]
  const compile = createCompiler(receiver)
  for (const campaign of campaigns) {
    it(
      `preserves generated option types through ${receiver} (${campaign})`,
      async () => {
        const reach = createOracleReach(
          propertyName,
          states.filter(
            (state) => receiver === `browser` || state !== `query-adapter`,
          ),
        )
        const check = (shape: Shape) => {
          const witnesses: Array<{
            source: string
            states: Array<(typeof states)[number]>
          }> = []
          for (const transformed of [false, true]) {
            for (const synced of [false, true]) {
              for (const typed of [false, true]) {
                for (const arguments_ of [
                  `inferred`,
                  `row-key`,
                  `full`,
                ] as const) {
                  // Preserve annotated cells; add contextual forms only where
                  // an inline schema can supply the callback's output row.
                  for (const contextualKey of transformed && !typed
                    ? [false, true]
                    : [false]) {
                    witnesses.push({
                      source: collectionSource(shape, {
                        transformed,
                        synced,
                        typed,
                        contextualKey,
                        arguments: arguments_,
                      }),
                      states: [
                        transformed
                          ? `schema-input-output`
                          : synced
                            ? `schema-free-synced`
                            : `schema-free-local`,
                        ...(typed ? ([`typed-spread`] as const) : []),
                        ...(contextualKey
                          ? ([`schema-contextual-key`] as const)
                          : []),
                        arguments_ === `inferred`
                          ? `inferred-arguments`
                          : arguments_ === `row-key`
                            ? `row-key-arguments`
                            : `explicit-arguments`,
                      ],
                    })
                  }
                }
              }
            }
          }
          // Keep all original construction cells, then cross the option domain
          // with both schema and persistence modes. initialRender is eager-only.
          for (const transformed of [false, true]) {
            for (const synced of [false, true]) {
              for (const configuration of [
                `eager`,
                `on-demand`,
                `network-first`,
              ] as const) {
                witnesses.push({
                  source: collectionSource(shape, {
                    transformed,
                    synced,
                    configuration,
                    typed: false,
                    contextualKey: transformed,
                    arguments: `inferred`,
                  }),
                  states: [
                    `configured-options`,
                    ...(configuration === `on-demand`
                      ? [`on-demand-options` as const]
                      : []),
                    ...(configuration === `network-first`
                      ? [`network-first-options` as const]
                      : []),
                    ...(synced
                      ? [`contextual-sync` as const]
                      : [`local-capabilities` as const]),
                  ],
                })
              }
            }
          }
          for (const synced of [false, true]) {
            witnesses.push({
              source: collectionSource(shape, {
                transformed: false,
                synced,
                typed: false,
                contextualKey: false,
                arguments: `phantom-schema`,
              }),
              states: [`phantom-schema-argument`],
            })
          }
          // Generated modifier neighbors guarantee reach without requiring a
          // fortunate random boolean. Their row domains and other fields still
          // come from the same grammar, model, driver, and refinement check.
          for (const transformed of [false, true]) {
            for (const synced of [false, true]) {
              for (const modifiers of [`mutable`, `readonly`] as const) {
                witnesses.push({
                  source: collectionSource(shape, {
                    transformed,
                    synced,
                    typed: false,
                    contextualKey: transformed,
                    arguments: `inferred`,
                    modifiers,
                  }),
                  states: [
                    ...(transformed
                      ? ([`schema-compatible-input`] as const)
                      : []),
                    ...(modifiers === `readonly`
                      ? ([`readonly-input`, `readonly-output`] as const)
                      : ([`mutable-fields`] as const)),
                  ],
                })
              }
            }
          }
          if (receiver === `browser`) {
            witnesses.push({
              source: querySource(shape),
              states: [`query-adapter`],
            })
          }
          const entry =
            receiver === `core`
              ? resolve(packageRoot, `src/index.js`)
              : resolve(
                  repositoryRoot,
                  `packages/browser-db-sqlite-persistence/src/index.js`,
                )
          compile(`
          import { createCollection } from "@tanstack/db";
          import type { CollectionConfig, PendingMutation, LoadSubsetOptions, SyncConfig } from "@tanstack/db";
          import type { StandardSchemaV1 } from "@standard-schema/spec";
          import { persistedCollectionOptions } from ${JSON.stringify(entry)};
          import type { PersistedCollectionPersistence } from ${JSON.stringify(entry)};
          import type { PersistedSyncWrappedOptions, PersistedLocalOnlyOptions } from "@tanstack/db-sqlite-persistence-core";
          ${
            receiver === `browser`
              ? `import { QueryClient } from "@tanstack/query-core";
            import { queryCollectionOptions } from "@tanstack/query-db-collection";`
              : ``
          }
          declare const persistence: PersistedCollectionPersistence;
          type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
          type Assert<T extends true> = T;
          type IsAny<T> = 0 extends (1 & T) ? true : false;
          type PublicShape<T> = { [K in keyof T]: T[K] };
          ${witnesses.map(({ source }, index) => `namespace Witness${index} { ${source} }`).join(`\n`)}
        `)
          return witnesses.flatMap((witness) => witness.states)
        }
        const property = fc.asyncProperty(shapeArbitrary, async (shape) => {
          reach.beginHistory()
          for (const state of check(shape)) reach.reach(state)
          // Let Vitest service worker RPC between CPU-bound compiler histories.
          await setImmediate()
        })
        const parameters =
          campaign === `fixed`
            ? { numRuns: oracleRuns(12), seed: 2259 }
            : oraclePropertyOptions(12, propertyName)
        await fc.assert(property, parameters)
        // Replays use the same check but do not inflate generated reach. An
        // explicitly requested seed/path goes directly to its generated history.
        if (campaign !== `replay`) {
          for (const shape of replayShapes) check(shape)
        }
        reach.assertReached()
        console.info(
          `${propertyName} ${campaign} reach`,
          Object.fromEntries(reach.counts()),
        )
      },
      120_000 * replay.multiplier,
    )
  }
}

/**
 * Local persistence owns three utility names. The maintainer chose rejection
 * rather than silent replacement; see the SQLite guide's manual-transaction
 * section and the round-two decision in the versioned type-preservation audit.
 * Synced wrapping installs none of these local utilities, so it preserves the
 * adapter namespace. This judgment depends on names and sync presence, not on
 * production's merge code, the value's truthiness, or its property descriptor.
 */
const reservedUtilityNames = [
  `acceptMutations`,
  `getLeadershipState`,
  `forceReloadSubset`,
] as const

const utilityAdmissionArbitrary = fc.record({
  token: fc.string(),
  extraNames: fc.subarray([
    `measure`,
    `convert`,
    `AcceptMutations`,
    `acceptMutations2`,
    `getLeadershipStates`,
    `forceReloadSubsetLater`,
  ]),
  names: fc.subarray([...reservedUtilityNames]),
})

/**
 * The runtime production driver calls only the supplied public wrapper. Its
 * resolver records whether admission reached persistence setup. Histories vary
 * ordinary names and caller identity; structural neighbors include each reserved
 * name, their union, both sync modes, schema presence, undefined/function values,
 * and own enumerable,
 * non-enumerable or inherited properties. Those forms all reserve the same name.
 * At return/throw, the shared comparison checks admission, config-error identity,
 * zero resolver work on rejection, and caller utility preservation on success.
 * No Collection is constructed, so no sync, database I/O or cleanup starts.
 */
export function registerPersistedUtilityAdmissionOracle(
  receiver: Receiver,
  construct: typeof persistedCollectionOptions,
): void {
  const propertyName = `persisted-options.utilities.${receiver}`
  const replay = readOracleRunConfig()
  if (replay.replayPath !== undefined && replay.replayProperty !== propertyName)
    return
  for (const campaign of replay.replayPath === undefined
    ? [`fixed`, `random`]
    : [`replay`]) {
    it(`rejects reserved local utility names through ${receiver} (${campaign})`, () => {
      const reach = createOracleReach(propertyName, [
        ...reservedUtilityNames,
        `local-ordinary`,
        `synced-collision`,
        `multiple-names`,
        `undefined-value`,
        `non-enumerable`,
        `inherited`,
        `schema-collision`,
      ])
      fc.assert(
        fc.property(
          utilityAdmissionArbitrary,
          ({ token, extraNames, names }) => {
            reach.beginHistory()
            const schemas: Array<StandardSchemaV1<{ id: string }> | undefined> =
              [
                {
                  '~standard': {
                    version: 1,
                    vendor: `oracle`,
                    validate: (value) => ({ value: value as { id: string } }),
                  },
                },
                undefined,
              ]
            for (const schema of schemas) {
              for (const selected of [
                [],
                ...reservedUtilityNames.map((name) => [name]),
                reservedUtilityNames,
                names,
              ]) {
                for (const synced of [false, true]) {
                  for (const descriptor of [
                    `enumerable`,
                    `non-enumerable`,
                    `inherited`,
                  ] as const) {
                    for (const defined of [false, true]) {
                      let resolverCalls = 0
                      let callerCalls = 0
                      const caller = () => {
                        callerCalls++
                        return token
                      }
                      const utils: Record<string, unknown> = Object.fromEntries(
                        extraNames.map((name) => [name, caller]),
                      )
                      const properties = Object.fromEntries(
                        selected.map((name) => [
                          name,
                          {
                            value: defined ? caller : undefined,
                            enumerable: descriptor === `enumerable`,
                          },
                        ]),
                      )
                      if (descriptor === `inherited`)
                        Object.setPrototypeOf(
                          utils,
                          Object.defineProperties({}, properties),
                        )
                      else Object.defineProperties(utils, properties)
                      const adapter: PersistenceAdapter = {
                        loadSubset: () => Promise.resolve([]),
                        loadResumeSnapshot: () =>
                          Promise.resolve({
                            rows: [],
                            keySet: { status: `consistent` },
                            collectionMetadata: [],
                            latestTerm: 0,
                            latestSeq: 0,
                            latestRowVersion: 0,
                            resetEpoch: 0,
                          }),
                        applyCommittedTx: async () => {},
                        ensureIndex: async () => {},
                      }
                      const persistence: PersistedCollectionPersistence = {
                        adapter,
                        resolvePersistenceForCollection: () => {
                          resolverCalls++
                          return { adapter }
                        },
                      }
                      const options = {
                        id: `utility-admission`,
                        getKey: (row: { id: string }) => row.id,
                        utils,
                        persistence,
                      }
                      const rejected =
                        !synced &&
                        selected.some((name) =>
                          reservedUtilityNames.includes(name),
                        )
                      let accepted = false
                      let errorName: string | undefined
                      let preserved = false
                      try {
                        const result = schema
                          ? synced
                            ? construct({
                                ...options,
                                schema,
                                sync: { sync: () => {} },
                              })
                            : construct({ ...options, schema })
                          : synced
                            ? construct({
                                ...options,
                                sync: { sync: () => {} },
                              })
                            : construct(options)
                        accepted = true
                        preserved = [...extraNames, ...selected].every(
                          (name) =>
                            result.utils !== undefined &&
                            name in result.utils &&
                            result.utils[name] === utils[name],
                        )
                      } catch (error) {
                        errorName =
                          error instanceof Error ? error.name : `non-error`
                      }
                      assert.deepEqual(
                        {
                          accepted,
                          errorName,
                          resolverCalls,
                          callerCalls,
                          preserved,
                        },
                        {
                          accepted: !rejected,
                          errorName: rejected
                            ? `InvalidPersistedCollectionConfigError`
                            : undefined,
                          resolverCalls: rejected ? 0 : 1,
                          callerCalls: 0,
                          preserved: !rejected,
                        },
                        JSON.stringify({
                          names: selected,
                          synced,
                          descriptor,
                          defined,
                          schema: schema !== undefined,
                        }),
                      )
                      if (!synced && selected.length === 0)
                        reach.reach(`local-ordinary`)
                      if (synced && selected.length > 0)
                        reach.reach(`synced-collision`)
                      if (selected.length > 1) reach.reach(`multiple-names`)
                      if (schema && !synced && selected.length > 0)
                        reach.reach(`schema-collision`)
                      if (selected.length > 0) {
                        for (const name of selected) reach.reach(name)
                        if (!defined) reach.reach(`undefined-value`)
                        if (descriptor !== `enumerable`) reach.reach(descriptor)
                      }
                    }
                  }
                }
              }
            }
          },
        ),
        campaign === `fixed`
          ? { numRuns: oracleRuns(12), seed: 2259 }
          : oraclePropertyOptions(12, propertyName),
      )
      reach.assertReached()
      console.info(
        `${propertyName} ${campaign} reach`,
        Object.fromEntries(reach.counts()),
      )
    })
  }
}
