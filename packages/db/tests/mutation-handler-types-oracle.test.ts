/**
 * Query and Electric handlers return Promise<void>. A thrown handler is legal;
 * coordination objects and ordinary values are not. Undefined is a void result,
 * but a synchronous void handler does not supply the required Promise.
 * Authority: the approved RC handler migration and the two public Config types.
 *
 * The finite grammar crosses adapter, key/scalar domain, CRUD handler, direct
 * Config annotation/factory call, schema presence, Query row/envelope selection,
 * Promise construction and return-value shape.
 * An independent output/transport rule predicts admission. Each type shape
 * resolves to a generated consumer program, one candidate declaration per line;
 * the driver is the real TypeScript compiler, which records each diagnostic.
 * Diagnostics must match exactly the rejected candidate lines; missing imports
 * or unrelated compiler failures never count as rejection evidence. Built
 * declarations, npm resolution, and actual application migrations remain
 * separate receivers (the coverage map's O22 boundary).
 */
import { relative, resolve } from 'node:path'
import ts from 'typescript'
import { oracleProperty, pass, violation } from './oracle-property'
import type { Observation } from './oracle-property'

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

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

type Candidate = {
  id: string
  /** The result description the candidate's handler returns. */
  result: string
  line: number
  surface: string
  start: number
  end: number
  handlerStart: number
  handlerEnd: number
}

// ---------------------------------------------------------------------------
// Resolution: a type shape becomes a consumer program
// ---------------------------------------------------------------------------
//
// The plan is the generated source and where each candidate declaration and
// its CRUD property sit in it. It holds no expected admission.

type Plan = { shape: TypeShape; source: string; candidates: Array<Candidate> }

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
          result: result.name,
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

// ---------------------------------------------------------------------------
// Production driver: the TypeScript compiler
// ---------------------------------------------------------------------------

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

// The driver compiles the plan's source and records every diagnostic as
// plain data: its file (the generated consumer, another file by name, or
// none), its line, span, code, and message.
type Diagnostic = {
  file: string
  line: number | undefined
  start: number | undefined
  length: number
  code: number
  message: string
}

function compileDriver(
  plan: Plan,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const diagnostics = compileHandlerConsumer(plan.source).map(
    (diagnostic): Diagnostic => ({
      file:
        diagnostic.file === undefined
          ? `(no file)`
          : diagnostic.file.fileName === filename
            ? `(generated consumer)`
            : relative(packageRoot, diagnostic.file.fileName),
      line:
        diagnostic.file && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
              .line + 1
          : undefined,
      start: diagnostic.start,
      length: diagnostic.length ?? 0,
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ` `),
    }),
  )
  observe(`diagnostics`, diagnostics)
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
//
// Promise<void> accepts fulfilled void/undefined and rejection. A synchronous
// never-returning function is also assignable; a synchronous void one is not.
// This rule uses the declared result description, not production handler
// types. The model owes the set of rejected candidates, and names the states
// each shape reaches.

function admitsHandler(result: ResultDescription): boolean {
  return (
    result.output === `never` ||
    (result.transport !== `sync` && result.output !== `value`)
  )
}

function admissionModel(plan: Plan) {
  const admitted = new Map(
    plan.candidates.map((candidate) => [
      candidate.id,
      admitsHandler(
        results.find((result) => result.name === candidate.result)!,
      ),
    ]),
  )
  const { adapter, schema, data } = plan.shape
  const reached = plan.candidates.map(
    (candidate) =>
      `${adapter}/${schema ? `schema` : `plain`}/${data}/${candidate.id}`,
  )
  return { admitted, reached }
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------
//
// A negative candidate owes a handler-result incompatibility inside its own
// declaration, anchored on its CRUD property; positive neighbors owe none.
// TypeScript may report both schema and handler overload errors for one call.
// Keep those distinct diagnostics, reject duplicates, and compare candidate
// membership rather than multiplicity. The Promise<void> cause prevents
// unrelated same-code errors from substituting for the required rejection.
// The property anchor also rejects an unrelated Promise<void> error inside the
// callback. The laws:
// - `candidate-diagnostics`: every diagnostic is in the generated file, on a
//   candidate's line;
// - `admission`: no admitted candidate has one, and the candidates rejected at
//   their CRUD property are exactly the ones the model rejects;
// - `diagnostic-cause`: a diagnostic has the expected code, lies inside its
//   candidate's declaration, and names Promise<void>;
// - `distinct-diagnostics`: no diagnostic is reported twice.

function checkHandlerAdmission(
  plan: Plan,
  trace: ReadonlyArray<Observation>,
  { admitted }: ReturnType<typeof admissionModel>,
) {
  const recorded = trace.find(({ checkpoint }) => checkpoint === `diagnostics`)
  if (!recorded)
    return violation(
      `diagnostics`,
      `the driver recorded no diagnostics`,
      `trace`,
    )
  const diagnostics = recorded.value as Array<Diagnostic>
  const rejected = new Set<string>()
  for (const diagnostic of diagnostics) {
    const candidate = plan.candidates.find(
      (entry) => entry.line === diagnostic.line,
    )
    if (diagnostic.file !== `(generated consumer)` || !candidate)
      return violation(
        `diagnostics`,
        `unexpected diagnostic in ${diagnostic.file} at line ${diagnostic.line}: TS${diagnostic.code} ${diagnostic.message}`,
        `candidate-diagnostics`,
      )
    if (admitted.get(candidate.id))
      return violation(
        `diagnostics`,
        `admitted handler ${candidate.id} was rejected`,
        `admission`,
      )
    const codes = candidate.surface === `config` ? [2322] : [2322, 2769]
    const end = (diagnostic.start ?? 0) + diagnostic.length
    if (
      !codes.includes(diagnostic.code) ||
      diagnostic.start === undefined ||
      diagnostic.start < candidate.start ||
      end > candidate.end ||
      !diagnostic.message.includes(`Promise<void>`)
    )
      return violation(
        `diagnostics`,
        `${candidate.id}: TS${diagnostic.code} at ${diagnostic.start}..${end} (declaration ${candidate.start}..${candidate.end}): ${diagnostic.message}`,
        `diagnostic-cause`,
      )
    if (
      diagnostic.start === candidate.handlerStart &&
      end === candidate.handlerEnd
    )
      rejected.add(candidate.id)
  }
  const texts = diagnostics.map(
    (diagnostic) =>
      `${diagnostic.start}/${diagnostic.length}/${diagnostic.code}/${diagnostic.message}`,
  )
  const repeated = texts.filter((text, index) => texts.indexOf(text) !== index)
  if (repeated.length > 0)
    return violation(
      `diagnostics`,
      `${repeated.length} of ${texts.length} diagnostics were reported again: ${repeated.join(`; `)}`,
      `distinct-diagnostics`,
    )
  const owed = [...admitted]
    .filter(([, value]) => !value)
    .map(([id]) => id)
    .sort()
  const seen = [...rejected].sort()
  if (JSON.stringify(seen) !== JSON.stringify(owed))
    return violation(
      `diagnostics`,
      `rejected ${JSON.stringify(seen)}, owed ${JSON.stringify(owed)}`,
      `admission`,
      { actual: seen, expected: owed },
    )
  return pass
}

// ---------------------------------------------------------------------------
// Calibrations
// ---------------------------------------------------------------------------
//
// Wrong compiler observations the check must reject: a missing rejection, a
// duplicated one, a setup error in place of a rejection, an admitted handler
// reported as rejected, an unrelated error with the same code, and a
// Promise<void> error inside a callback body instead of at the property.

/** Replaces the recorded diagnostics, or gives undefined when `change` does. */
const corruptDiagnostics =
  (
    change: (
      diagnostics: Array<Diagnostic>,
      plan: Plan,
    ) => Array<Diagnostic> | undefined,
  ) =>
  (trace: ReadonlyArray<Observation>, plan: Plan) => {
    const at = trace.findIndex(({ checkpoint }) => checkpoint === `diagnostics`)
    if (at < 0) return undefined
    const changed = change([...(trace[at]!.value as Array<Diagnostic>)], plan)
    if (!changed) return undefined
    return trace.map((entry, index) =>
      index === at ? { ...entry, value: changed } : entry,
    )
  }

const handlerCalibrations = [
  {
    name: `missing rejection`,
    law: `admission`,
    corrupt: corruptDiagnostics((diagnostics) => {
      const first = diagnostics[0]
      return first
        ? diagnostics.filter((diagnostic) => diagnostic.line !== first.line)
        : undefined
    }),
  },
  {
    name: `duplicate rejection`,
    law: `distinct-diagnostics`,
    corrupt: corruptDiagnostics((diagnostics) =>
      diagnostics[0] ? [...diagnostics, diagnostics[0]] : undefined,
    ),
  },
  {
    name: `setup error`,
    law: `diagnostic-cause`,
    corrupt: corruptDiagnostics((diagnostics) =>
      diagnostics[0]
        ? [{ ...diagnostics[0], code: 2307 }, ...diagnostics.slice(1)]
        : undefined,
    ),
  },
  {
    name: `rejected void`,
    law: `admission`,
    corrupt: corruptDiagnostics((diagnostics, plan) => {
      const model = admissionModel(plan)
      const candidate = plan.candidates.find((entry) =>
        model.admitted.get(entry.id),
      )
      return diagnostics[0] && candidate
        ? [
            ...diagnostics,
            {
              ...diagnostics[0],
              line: candidate.line,
              start: candidate.handlerStart,
              length: candidate.handlerEnd - candidate.handlerStart,
            },
          ]
        : undefined
    }),
  },
  {
    name: `unrelated same code`,
    law: `diagnostic-cause`,
    corrupt: corruptDiagnostics((diagnostics) =>
      diagnostics[0]
        ? [
            {
              ...diagnostics[0],
              code: 2322,
              message: `Type 'number' is not assignable to type 'string'.`,
            },
            ...diagnostics.slice(1),
          ]
        : undefined,
    ),
  },
  {
    name: `Promise<void> error inside the callback body`,
    law: `admission`,
    corrupt: corruptDiagnostics((diagnostics, plan) => {
      const first = diagnostics[0]
      const candidate =
        first && plan.candidates.find((entry) => entry.line === first.line)
      return first && candidate
        ? [
            { ...first, start: candidate.handlerEnd + 3, length: 1 },
            ...diagnostics.slice(1),
          ]
        : undefined
    }),
  },
]

// No owns: the handler types this property judges belong to the Query and
// Electric adapter packages, outside packages/db. The property's own parts
// (the compiler driver and the admission model) are declared by oracleProperty.
oracleProperty({
  id: `adapter.handler-types`,
  law: {
    statement: `Query and Electric handlers admit exactly the results that Promise<void> accepts: a handler that returns a value, or a synchronous handler that returns, is rejected at its CRUD property with a Promise<void> diagnostic, and no other diagnostic appears.`,
    authority: `the approved RC handler migration and the public QueryCollectionConfig and ElectricCollectionConfig types`,
    limits: `Source entries only; built declarations, npm resolution, and application migrations are separate receivers.`,
  },
  histories: typeShapes,
  label: ({ adapter, key, scalar, schema, data }) =>
    `${adapter} ${key} ${scalar} ${schema ? `schema` : `plain`} ${data}`,
  resolve: (shape: TypeShape): Plan => ({ shape, ...handlerConsumer(shape) }),
  model: admissionModel,
  reached: (_plan, _trace, expected) => expected.reached,
  driver: compileDriver,
  check: checkHandlerAdmission,
  calibrations: handlerCalibrations,
})
