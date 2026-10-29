/**
 * Query and Electric handlers return Promise<void>. A thrown handler is legal;
 * coordination objects and ordinary values are not. Undefined is a void result,
 * but a synchronous void handler does not supply the required Promise.
 * Authority: the approved RC handler migration and the two public Config types.
 *
 * The finite grammar crosses adapter, key/scalar domain, CRUD handler, direct
 * Config annotation/factory call, schema presence, Query row/envelope selection,
 * Promise construction and return-value shape.
 * An independent output/transport rule predicts admission. The actual compiler
 * receives generated consumers importing public source entries. Diagnostics
 * must match exactly the rejected candidate lines; missing imports or unrelated
 * compiler failures never count as rejection evidence. Built declarations/npm
 * resolution and actual application migrations remain separate O22 receivers.
 */
import { resolve } from 'node:path'
import ts from 'typescript'
import { afterAll, describe, expect, test } from 'vitest'
import { declareOracle } from './oracle-declaration'
import { createOracleReach } from './oracle-reach'

type ResultDescription = {
  name: string
  transport: `async` | `promise` | `sync`
  output: `void` | `undefined` | `never` | `value`
  body: string
}
const results: Array<ResultDescription> = [
  { name: `void`, transport: `async`, output: `void`, body: `` },
  {
    name: `undefined`,
    transport: `async`,
    output: `undefined`,
    body: `return undefined`,
  },
  {
    name: `throw`,
    transport: `async`,
    output: `never`,
    body: `throw new Error('server failed')`,
  },
  {
    name: `promise-void`,
    transport: `promise`,
    output: `void`,
    body: `return Promise.resolve()`,
  },
  {
    name: `synchronous-throw`,
    transport: `sync`,
    output: `never`,
    body: `throw new Error('server failed')`,
  },
  {
    name: `legacy-disable`,
    transport: `async`,
    output: `value`,
    body: `return { refetch: false }`,
  },
  {
    name: `legacy-enable`,
    transport: `async`,
    output: `value`,
    body: `return { refetch: true }`,
  },
  {
    name: `legacy-txid`,
    transport: `async`,
    output: `value`,
    body: `return { txid: 55 }`,
  },
  {
    name: `empty-record`,
    transport: `async`,
    output: `value`,
    body: `return {}`,
  },
  { name: `row`, transport: `async`, output: `value`, body: `return row` },
  { name: `number`, transport: `async`, output: `value`, body: `return 1` },
  { name: `null`, transport: `async`, output: `value`, body: `return null` },
  { name: `synchronous-void`, transport: `sync`, output: `void`, body: `` },
]
const handlers = [`onInsert`, `onUpdate`, `onDelete`] as const
const surfaces = [`config`, `factory-explicit`, `factory-inferred`] as const
const typeShapes = ([`query`, `electric`] as const).flatMap((adapter) =>
  [`string`, `number`, `string | number`].flatMap((key) =>
    [`string`, `number`].flatMap((scalar) =>
      [false, true].flatMap((schema) =>
        (adapter === `query` ? [`rows`, `envelope`] : [`rows`]).map((data) => ({
          adapter,
          key,
          scalar,
          schema,
          data,
        })),
      ),
    ),
  ),
)
type TypeShape = (typeof typeShapes)[number]

// Promise<void> accepts fulfilled void/undefined and rejection. A synchronous
// never-returning function is also assignable; a synchronous void one is not.
// This rule uses the declared result description, not production handler types.
function admitsHandler(result: ResultDescription): boolean {
  return (
    result.output === `never` ||
    (result.transport !== `sync` && result.output !== `value`)
  )
}

type Candidate = {
  id: string
  line: number
  admitted: boolean
  surface: string
  start: number
  end: number
  handlerStart: number
  handlerEnd: number
}
function handlerConsumer(shape: TypeShape): {
  source: string
  candidates: Array<Candidate>
} {
  const { adapter, key, scalar, schema, data } = shape
  const config =
    adapter === `query` ? `QueryCollectionConfig` : `ElectricCollectionConfig`
  const factory =
    adapter === `query` ? `queryCollectionOptions` : `electricCollectionOptions`
  const entry =
    adapter === `query`
      ? `@tanstack/query-db-collection`
      : `@tanstack/electric-db-collection`
  const lines = [
    `import { ${factory}, type ${config} } from '${entry}';`,
    ...(adapter === `query`
      ? [`import { QueryClient } from '@tanstack/query-core';`]
      : []),
    ...(schema ? [`import { z } from 'zod';`] : []),
    `type Row = { id: ${key}; value: ${scalar} };`,
    `const row: Row = { id: ${key === `string` ? `'row'` : `1`}, value: ${scalar === `string` ? `'value'` : `7`} };`,
    ...(schema
      ? [
          `const schema = z.object({ id: ${key === `string | number` ? `z.union([z.string(), z.number()])` : `z.${key}()`}, value: z.${scalar}() });`,
        ]
      : []),
    adapter === `query`
      ? `const base = { queryKey: ['handler-types'], queryClient: new QueryClient(), queryFn: async () => ${data === `envelope` ? `({ rows: [row] })` : `[row]`}, ${data === `envelope` ? `select: (data: { rows: Row[] }) => data.rows,` : ``} ${schema ? `schema,` : ``} getKey: (r: Row) => r.id };`
      : `const base = { shapeOptions: { url: 'http://localhost/shape' }, ${schema ? `schema,` : ``} getKey: (r: Row) => r.id };`,
  ]
  const candidates: Array<Candidate> = []
  for (const surface of surfaces) {
    for (const handler of handlers) {
      for (const result of results) {
        const id = `${surface}/${handler}/${result.name}`
        const variable = `candidate_${candidates.length}`
        const callback = `${result.transport === `async` ? `async ` : ``}({ collection }) => { void collection.id; ${result.body} }`
        const object = `{ ...base, ${handler}: ${callback} }`
        const configArguments =
          adapter === `query`
            ? `Row, typeof base.queryFn, unknown, typeof base.queryKey, Row['id'], ${schema ? `typeof schema` : `never`}`
            : `Row${schema ? `, typeof schema` : ``}`
        const factoryArguments = `${schema ? `typeof schema` : `Row`}${data === `envelope` ? `, typeof base.queryFn` : ``}`
        const declaration =
          surface === `config`
            ? `const ${variable}: ${config}<${configArguments}> = ${object};`
            : `const ${variable} = ${factory}${surface === `factory-explicit` ? `<${factoryArguments}>` : ``}(${object});`
        const start = lines.join(`\n`).length + 1
        candidates.push({
          id,
          line: lines.length + 1,
          admitted: admitsHandler(result),
          surface,
          start,
          end: start + declaration.length,
          handlerStart: start + declaration.indexOf(`${handler}:`),
          handlerEnd:
            start + declaration.indexOf(`${handler}:`) + handler.length,
        })
        lines.push(`${declaration} // handler candidate: ${id}`)
      }
    }
  }
  return { source: lines.join(`\n`), candidates }
}

// Only compiler mechanics are cached. Every history gets a fresh consumer AST;
// all dependency diagnostics are retained. Public imports resolve to source so
// stale installed declaration files cannot make this source contract pass.
const packageRoot = resolve(process.cwd())
const filename = resolve(packageRoot, `tests/__generated-handler-types.ts`)
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
  rootDir: resolve(packageRoot, `../..`),
  noEmit: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
  paths: {
    ...parsed.options.paths,
    '@tanstack/db': [resolve(packageRoot, `src/index.ts`)],
    '@tanstack/query-core': [
      resolve(
        packageRoot,
        `../query-db-collection/node_modules/@tanstack/query-core`,
      ),
    ],
    '@tanstack/query-db-collection': [
      resolve(packageRoot, `../query-db-collection/src/index.ts`),
    ],
    '@tanstack/electric-db-collection': [
      resolve(packageRoot, `../electric-db-collection/src/index.ts`),
    ],
  },
}
const host = ts.createCompilerHost(options)
const originalGetSource = host.getSourceFile.bind(host)
const dependencies = new Map<string, ts.SourceFile>()
let generated = ``
host.getSourceFile = (name, version, onError, fresh) => {
  if (name === filename)
    return ts.createSourceFile(name, generated, version, true)
  let source = dependencies.get(name)
  if (!source) {
    source = originalGetSource(name, version, onError, fresh)
    if (source) dependencies.set(name, source)
  }
  return source
}
let previous: ts.Program | undefined
function compileHandlerConsumer(source: string): ReadonlyArray<ts.Diagnostic> {
  generated = source
  const program = ts.createProgram([filename], options, host, previous)
  previous = program
  return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
}

// A negative candidate owes a handler-result incompatibility inside its own
// declaration, anchored on its CRUD property; positive neighbors owe none.
// TypeScript may report both schema and handler overload errors for one call. Keep those distinct diagnostics,
// reject duplicates, and compare candidate membership rather than multiplicity.
// The Promise<void> cause prevents unrelated same-code errors from substituting
// for the required rejection. The property anchor also rejects an unrelated
// Promise<void> error inside the callback. Built diagnostics are an O22 receiver.
function checkHandlerAdmission(
  candidates: ReadonlyArray<Candidate>,
  diagnostics: ReadonlyArray<ts.Diagnostic>,
): void {
  const observed = diagnostics.map((diagnostic) => {
    const line =
      diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line +
          1
        : undefined
    const candidate = candidates.find((entry) => entry.line === line)
    expect(
      diagnostic.file?.fileName,
      ts.flattenDiagnosticMessageText(diagnostic.messageText, `\n`),
    ).toBe(filename)
    expect(
      candidate,
      `unexpected diagnostic at line ${line}: TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ` `)}`,
    ).toBeDefined()
    expect(candidate!.admitted, `admitted handler ${candidate!.id}`).toBe(false)
    expect(candidate!.surface === `config` ? [2322] : [2322, 2769]).toContain(
      diagnostic.code,
    )
    expect(diagnostic.start).toBeGreaterThanOrEqual(candidate!.start)
    expect(diagnostic.start! + (diagnostic.length ?? 0)).toBeLessThanOrEqual(
      candidate!.end,
    )
    expect(
      ts.flattenDiagnosticMessageText(diagnostic.messageText, ` `),
    ).toContain(`Promise<void>`)
    return {
      id: candidate!.id,
      handler:
        diagnostic.start === candidate!.handlerStart &&
        diagnostic.start + (diagnostic.length ?? 0) === candidate!.handlerEnd,
      diagnostic: `${diagnostic.start}/${diagnostic.length}/${diagnostic.code}/${ts.flattenDiagnosticMessageText(diagnostic.messageText, ` `)}`,
    }
  })
  expect(new Set(observed.map((entry) => entry.diagnostic)).size).toBe(
    observed.length,
  )
  expect(
    [
      ...new Set(
        observed.filter((entry) => entry.handler).map((entry) => entry.id),
      ),
    ].sort(),
  ).toEqual(
    candidates
      .filter((entry) => !entry.admitted)
      .map((entry) => entry.id)
      .sort(),
  )
}

// A state name leaves out the key and scalar types, so the six shapes that
// differ only there share one state, and `minimum: 6` asks for all of them.
const states = [
  ...new Set(
    typeShapes.flatMap((shape) =>
      surfaces.flatMap((surface) =>
        handlers.flatMap((handler) =>
          results.map(
            (result) =>
              `${shape.adapter}/${shape.schema ? `schema` : `plain`}/${shape.data}/${surface}/${handler}/${result.name}`,
          ),
        ),
      ),
    ),
  ),
]
const reach = createOracleReach(`adapter.handler-types`, states, { minimum: 6 })
describe(`public handler result admission`, () => {
  afterAll(() => {
    reach.assertReached()
    console.info(
      `adapter.handler-types reach`,
      Object.fromEntries(reach.counts()),
    )
  })
  test.each(typeShapes)(
    `admits only promised handler results: %j`,
    (shape) => {
      reach.beginHistory()
      const consumer = handlerConsumer(shape)
      const diagnostics = compileHandlerConsumer(consumer.source)
      checkHandlerAdmission(consumer.candidates, diagnostics)
      for (const candidate of consumer.candidates)
        reach.reach(
          `${shape.adapter}/${shape.schema ? `schema` : `plain`}/${shape.data}/${candidate.id}`,
        )
    },
    30000,
  )
})

// Controls alter actual compiler observations, not the expected grammar. They
// first establish that the generated neighbor is admitted/rejected correctly.
test.each([
  `missing-rejection`,
  `duplicate-rejection`,
  `setup-error`,
  `reject-void`,
  `unrelated-same-code`,
  `unrelated-promise-in-body`,
] as const)(
  `rejects wrong handler compiler observation: %s`,
  (fault) => {
    const consumer = handlerConsumer(typeShapes[0]!)
    const diagnostics = [...compileHandlerConsumer(consumer.source)]
    checkHandlerAdmission(consumer.candidates, diagnostics)
    if (fault === `missing-rejection`) {
      const line = diagnostics[0]!.file!.getLineAndCharacterOfPosition(
        diagnostics[0]!.start!,
      ).line
      for (let i = diagnostics.length - 1; i >= 0; i--)
        if (
          diagnostics[i]!.file!.getLineAndCharacterOfPosition(
            diagnostics[i]!.start!,
          ).line === line
        )
          diagnostics.splice(i, 1)
    }
    if (fault === `duplicate-rejection`) diagnostics.push(diagnostics[0]!)
    if (fault === `setup-error`)
      diagnostics[0] = { ...diagnostics[0]!, code: 2307 }
    if (fault === `unrelated-same-code`)
      diagnostics[0] = {
        ...diagnostics[0]!,
        code: 2322,
        messageText: `Type 'number' is not assignable to type 'string'.`,
      }
    if (fault === `unrelated-promise-in-body`) {
      const candidate = consumer.candidates.find(
        (entry) =>
          entry.line ===
          diagnostics[0]!.file!.getLineAndCharacterOfPosition(
            diagnostics[0]!.start!,
          ).line +
            1,
      )!
      diagnostics[0] = {
        ...diagnostics[0]!,
        start: candidate.handlerEnd + 3,
        length: 1,
      }
    }
    if (fault === `reject-void`) {
      const admitted = consumer.candidates.find(
        (candidate) => candidate.admitted,
      )!
      diagnostics.push({
        ...diagnostics[0]!,
        start: admitted.handlerStart,
        length: admitted.handlerEnd - admitted.handlerStart,
      })
    }
    expect(() =>
      checkHandlerAdmission(consumer.candidates, diagnostics),
    ).toThrow()
  },
  30000,
)

declareOracle({
  check: [checkHandlerAdmission],
  model: [admitsHandler],
  grammar: [handlerConsumer, typeShapes, results],
})
