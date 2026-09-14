import { Evidence } from './evidence.mjs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  mkdtemp,
  realpath,
  rm,
  mkdir,
  writeFile,
  readFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import fc from 'fast-check'
import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { inspectSchema } from '../../schema-snapshot.mjs'
import { analyzeSqlDependencies } from '../../sql-dependencies.mjs'

// Real registry, JSON envelopes, and client collections; two independent PG
// databases. This is not the compiler/HTTP/browser or publication-event oracle.
const app = resolve(import.meta.dirname, '../..')
const output = resolve(
  process.env.ENDPOINT_ORACLE_OUTPUT ?? 'evidence/sql-effect-rules',
)
const seed = Number(process.env.ENDPOINT_ORACLE_SEED ?? 9142601)
const runs = Number(process.env.ENDPOINT_ORACLE_SCENARIOS ?? 12)
const sequences = Number(process.env.ENDPOINT_ORACLE_SEQUENCES ?? 3)
const mutant = process.env.ENDPOINT_EFFECT_MUTANT ?? null
const legacy = process.env.ENDPOINT_EFFECT_CHECKER === 'legacy'
const candidate = legacy ? null : await import('../../sql-effects.mjs')
const require = createRequire(
  await realpath(join(app, 'node_modules/vite/package.json')),
)
const { build } = require('esbuild')
const dir = await mkdtemp(join(tmpdir(), 'endpoint-effects-'))
const report = {
  ok: false,
  seed,
  runs,
  sequences,
  mutant,
  checker: legacy ? 'legacy' : 'effects',
  histories: 0,
  coldHistories: 0,
  operations: 0,
  comparisons: {},
  writesExecuted: 0,
  envelopesDelivered: 0,
  resultReads: 0,
  backgroundReads: 0,
  readScope:
    'resultReads/skippedReads count mutation refresh decisions; startup and coordinated background reads are separate',
  skippedReads: 0,
  buildCatalogCalls: 0,
  runtimeCatalogCalls: 0,
  cells: {},
  witnesses: {},
  faultEvents: [],
  rejectedShrinkFailures: [],
  cleanupErrors: [],
  node: process.version,
}
const evidence = new Evidence('endpoints.sql-effect-rules')
report.cleanupErrors = evidence.cleanupErrors
let runtime, primary
const id = (i) => JSON.stringify(['app', `t${i}`])
const sqlQueries = [
  'SELECT id,value FROM app.t0 ORDER BY id',
  'SELECT id,app.read_value(value) AS value FROM app.t0 ORDER BY id',
  'SELECT id,value FROM app.t1 ORDER BY id',
  'SELECT id,value FROM app.t2 ORDER BY id',
  'SELECT id,app.pure(value) AS value FROM app.t0 ORDER BY id',
]
// Independent relational description: no calls into the analyzer or SUT
// routines, and no rows copied from the client to construct an expectation.
const referenceQueries = [...sqlQueries]
referenceQueries[1] =
  "SELECT a.id,a.value+b.value AS value FROM app.t0 a CROSS JOIN app.t1 b WHERE b.id='row' ORDER BY a.id"
referenceQueries[4] = 'SELECT id,value+1 AS value FROM app.t0 ORDER BY id'
const sources = [[0], [0, 1], [1], [2], [0]]
const mutationSql = (step) =>
  step.kind === 'function'
    ? 'SELECT app.write_value($1)'
    : step.kind === 'read-write'
      ? "UPDATE app.t0 SET value=(SELECT value FROM app.t2 WHERE id='row')+$1 WHERE id='row'"
      : step.kind === 'noop'
        ? 'SELECT app.pure($1)'
        : "UPDATE app.t0 SET value=$1 WHERE id='row'"

function compare(law, checkpoint, actual, expected, detail = {}) {
  const key = `${law}/${checkpoint}`
  report.comparisons[key] = (report.comparisons[key] ?? 0) + 1
  const witness = `${detail.cell ?? 'campaign'}/${
    detail.step?.kind ?? 'initial'
  }/${key}`
  report.witnesses[witness] = (report.witnesses[witness] ?? 0) + 1
  evidence.check(law, actual, expected, {
    checkpoint,
    operation: detail.step?.kind,
    ...detail,
  })
}
async function release(name, fn) {
  await evidence.cleanup(name, fn)
}

async function run(program, histories) {
  const sut = new PGlite(),
    reference = new PGlite()
  let core,
    phase = 'setup'
  const query = (sql, args) => {
    if (/pg_catalog\./.test(sql))
      report[phase === 'build' ? 'buildCatalogCalls' : 'runtimeCatalogCalls']++
    return sut.query(sql, args)
  }
  try {
    const ddl =
      'CREATE SCHEMA app;' +
      [0, 1, 2]
        .map(
          (i) =>
            `CREATE TABLE app.t${i}(id text PRIMARY KEY,value integer NOT NULL,meta jsonb); INSERT INTO app.t${i} VALUES ('row',${
              i + 1
            },'{}')`,
        )
        .join(';')
    await sut.exec(ddl)
    await reference.exec(ddl)
    await sut.exec(`
      CREATE FUNCTION app.pure(integer) RETURNS integer LANGUAGE sql ${program.volatility} AS 'SELECT $1+1';
      CREATE FUNCTION app.read_leaf(integer) RETURNS integer LANGUAGE sql STABLE AS $$SELECT value+$1 FROM app.t1 WHERE id='row'$$;
      CREATE FUNCTION app.write_value(integer) RETURNS integer LANGUAGE sql VOLATILE AS $$UPDATE app.t1 SET value=$1 WHERE id='row'; SELECT $1$$`)
    let callee = 'read_leaf'
    for (let i = 0; i < program.depth; i++) {
      await sut.exec(
        `CREATE FUNCTION app.read_${i}(integer) RETURNS integer LANGUAGE sql STABLE AS 'SELECT app.${callee}($1)'`,
      )
      callee = `read_${i}`
    }
    await sut.exec(
      `CREATE FUNCTION app.read_value(integer) RETURNS integer LANGUAGE sql STABLE AS 'SELECT app.${callee}($1)'`,
    )
    if (program.index === 'expression')
      await sut.exec('CREATE UNIQUE INDEX extra ON app.t0(lower(id))')
    if (program.index === 'partial')
      await sut.exec('CREATE INDEX extra ON app.t0(value) WHERE value>0')
    if (program.index === 'gin')
      await sut.exec('CREATE INDEX extra ON app.t0 USING gin(meta)')
    phase = 'build'
    const snapshot = await (
      legacy ? inspectSchema : candidate.inspectSqlEffects
    )(query, 'oracle')
    const analyze = (sql) =>
      legacy
        ? analyzeSqlDependencies(sql, snapshot)
        : candidate.analyzeSqlEffects(sql, snapshot)
    const summaries = sqlQueries.map(analyze)
    let changedFootprint = false
    const footprints = summaries.map((summary, i) => {
      const reads = legacy
        ? summary.reads
        : candidate.queryDependencies(summary)
      if (mutant === 'omit-body-read' && i === 1 && reads?.includes(id(1))) {
        changedFootprint = true
        return reads.filter((x) => x !== id(1))
      }
      return reads
    })
    const cell = `${program.index}/${program.volatility}/depth-${program.depth}/cold-${!!program.cold}`
    report.cells[cell] = (report.cells[cell] ?? 0) + 1
    for (const steps of histories) {
      for (let i = 0; i < 3; i++) {
        await sut.query(`UPDATE app.t${i} SET value=$1`, [i + 1])
        await reference.query(`UPDATE app.t${i} SET value=$1`, [i + 1])
      }
      phase = 'runtime'
      evidence.phase = 'execution'
      evidence.at({ cell })
      core = new runtime.DbClient({ endpointScope: 'oracle' })
      const client = runtime.endpointRuntime(core),
        counts = [0, 0, 0, 0, 0],
        mutationReads = [0, 0, 0, 0, 0],
        registry = {}
      const baselines = sqlQueries.map((_, i) => !(program.cold && i === 3))
      const factories = sqlQueries.map((sql, i) => {
        const read = async () => {
          counts[i]++
          const rows = (await query(sql)).rows
          return rows
        }
        registry[`q${i}`] = runtime.registerQuery(
          'v1',
          `q${i}`,
          (x) => x,
          async () => {
            mutationReads[i]++
            return read()
          },
          undefined,
          footprints[i],
        )
        return () =>
          client.bindQuery(
            `q${i}`,
            read,
            {
              relation: `opaque:q${i}`,
              membership: { kind: 'all' },
              order: [],
            },
            {},
            'v1',
            runtime.z.object({
              id: runtime.z.string(),
              value: runtime.z.number(),
            }),
          )
      })
      const collections = factories.map((bind, i) =>
        baselines[i] ? bind() : undefined,
      )
      const actual = () =>
        collections.map((c) =>
          [...c.values()].map(({ id, value }) => ({ id, value })),
        )
      const expectedRows = () =>
        Promise.all(
          referenceQueries.map(
            async (sql) => (await reference.query(sql)).rows,
          ),
        )
      await Promise.all(collections.filter(Boolean).map((c) => c.preload()))
      let expected = (await expectedRows()).map((rows, i) =>
        baselines[i] ? rows : [],
      )
      if (program.cold) {
        // Register the cold peer only after the warm peers have established their
        // baselines. Invoke the mutation in this same turn, before initial demand.
        collections[3] = factories[3]()
        if (process.env.ENDPOINT_ORACLE_TEST_FAULT === 'preload-cold') {
          evidence.fault('preload-cold')
          await collections[3].preload()
        }
        compare('cold-baseline', 'before-mutation', actual()[3], [], { cell })
        report.coldHistories++
      }
      compare('values', 'baseline', actual(), expected, { cell })
      report.histories++
      for (const [stepIndex, step] of steps.entries()) {
        evidence.at({ operation: step.kind, step: stepIndex, cell })
        evidence.record({ type: 'operation', step, baselines })
        const sql = mutationSql(step),
          summary = analyze(sql)
        let writes = legacy
          ? summary.writes
          : candidate.mutationDependencies(summary)
        let faultApplied = changedFootprint
        if (mutant === 'omit-write' && writes?.length) {
          writes = []
          faultApplied = true
        }
        if (mutant === 'needless-index-fallback' && program.index !== 'none') {
          writes = null
          faultApplied = true
        }
        const target = baselines[step.optimistic]
          ? step.optimistic
          : (step.optimistic + 1) % collections.length
        const guessed = structuredClone(expected)
        const optimistic = guessed[target][0].value !== step.value
        guessed[target][0].value = step.value
        const changed =
          step.kind === 'noop' ? [] : step.kind === 'function' ? [1] : [0]
        const selected = sources.map(
          (tables, i) =>
            !baselines[i] ||
            (i === target && optimistic) ||
            tables.some((t) => changed.includes(t)),
        )
        if (!legacy) {
          compare(
            'independence',
            'compiled-judgment',
            summaries.map(
              (query, i) =>
                candidate.canSkipRefetch(query, summary, {
                  hasBaseline: baselines[i],
                  optimistic: i === target && optimistic,
                  needsRepair: false,
                }).verdict,
            ),
            selected.map((refresh) => (refresh ? 'refresh' : 'skip')),
            { cell, step },
          )
          for (const authority of [
            { hasBaseline: false, optimistic: false, needsRepair: false },
            { hasBaseline: true, optimistic: false, needsRepair: true },
          ]) {
            compare(
              'authority',
              'compiled-judgment',
              summaries.map(
                (query) =>
                  candidate.canSkipRefetch(query, summary, authority).verdict,
              ),
              summaries.map(() => 'refresh'),
              { cell, step, authority },
            )
          }
        }
        const before = [...mutationReads]
        const action = client.bindMutation(
          'write',
          async ({ data }) => {
            if (program.cold && !baselines[3])
              compare(
                'cold-request',
                'mutation-dispatch',
                data.reads.find((read) => read.id === 'q3')?.hasBaseline,
                false,
                { cell, step },
              )
            const response = await runtime.refreshRegisteredMutation(
              data.reads,
              registry,
              async () => {
                report.writesExecuted++
                await query(sql, [step.value])
              },
              { scope: data.scope },
              () => {
                if (faultApplied) {
                  evidence.fault(mutant, { cell, step })
                  report.faultEvents.push({ mutant, cell, step })
                }
                return writes
              },
            )
            report.envelopesDelivered++
            return JSON.parse(JSON.stringify(response))
          },
          () =>
            collections[target].update('row', (draft) => {
              draft.value = step.value
            }),
        )
        const tx = action({})
        compare('values', 'same-turn-optimism', actual(), guessed, {
          cell,
          step,
        })
        if (step.kind === 'function')
          await reference.query('UPDATE app.t1 SET value=$1', [step.value])
        else if (step.kind !== 'noop') {
          const peer =
            step.kind === 'read-write'
              ? (await reference.query('SELECT value FROM app.t2')).rows[0]
                  .value
              : 0
          await reference.query('UPDATE app.t0 SET value=$1', [
            peer + step.value,
          ])
        }
        await tx.isPersisted.promise
        expected = await expectedRows()
        compare('values', 'settled', actual(), expected, {
          cell,
          step,
          summaries,
          summary,
        })
        compare(
          'read-obligation',
          'settled',
          mutationReads.map((n, i) => n - before[i]),
          selected.map(Number),
          { cell, step, summaries, summary },
        )
        baselines.fill(true)
        report.operations++
        report.resultReads += selected.filter(Boolean).length
        report.skippedReads += selected.filter((x) => !x).length
      }
      await release('client', () => core.cleanup())
      report.backgroundReads += counts.reduce(
        (sum, count, i) => sum + count - mutationReads[i],
        0,
      )
      core = undefined
    }
  } finally {
    if (core) await release('client', () => core.cleanup())
    await release('sut-pg', () => sut.close())
    await release('reference-pg', () => reference.close())
  }
}

async function check(program, histories) {
  return evidence.run({ program, histories }, () => run(program, histories))
}
const step = fc.record({
  kind: fc.constantFrom('direct', 'function', 'read-write', 'noop'),
  value: fc.integer({ min: -9, max: 9 }),
  optimistic: fc.integer({ min: 0, max: 4 }),
})
try {
  await mkdir(output, { recursive: true })
  report.sources = Object.fromEntries(
    await Promise.all(
      [
        'sql-effects.mjs',
        'sql-dependencies.mjs',
        'src/runtime.ts',
        'src/registry.server.ts',
        'tests/oracles/sql-effect-rules.mjs',
      ].map(async (path) => [
        path,
        createHash('sha256')
          .update(await readFile(join(app, path)))
          .digest('hex'),
      ]),
    ),
  )
  report.versions = Object.fromEntries(
    await Promise.all(
      ['fast-check', '@electric-sql/pglite'].map(async (name) => [
        name,
        JSON.parse(
          await readFile(
            join(app, 'node_modules', name, 'package.json'),
            'utf8',
          ),
        ).version,
      ]),
    ),
  )
  const bundle = join(dir, 'runtime.mjs')
  await build({
    stdin: {
      contents: `export {DbClient} from '@tanstack/db';export {z} from 'zod';export {endpointRuntime} from './src/runtime';export {registerQuery,refreshRegisteredMutation} from './src/registry.server';`,
      resolveDir: app,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    tsconfig: join(app, 'tsconfig.json'),
    outfile: bundle,
    logLevel: 'silent',
  })
  evidence.artifact('runtime-bundle', await readFile(bundle))
  runtime = await import(pathToFileURL(bundle).href)
  const replayPath = process.argv.indexOf('--replay')
  if (replayPath !== -1) {
    const replay = JSON.parse(
      await readFile(process.argv[replayPath + 1], 'utf8'),
    )
    const normalize = (record) =>
      record &&
      (record.input
        ? record
        : {
            input: { program: record.program, histories: record.histories },
            failure: record.failure,
          })
    await evidence.replay(
      {
        ...replay,
        original: normalize(replay.original),
        reduced: normalize(replay.reduced),
      },
      (input) => check(input.program, input.histories),
    )
  } else {
    const history = [
      { kind: 'direct', value: 7, optimistic: 0 },
      { kind: 'function', value: -3, optimistic: 3 },
      { kind: 'read-write', value: 4, optimistic: 2 },
      { kind: 'noop', value: 8, optimistic: 1 },
    ]
    if (!process.argv.includes('--generated-only'))
      for (const index of ['none', 'expression', 'partial', 'gin'])
        await check(
          { index, volatility: 'VOLATILE', depth: 2, cold: index === 'none' },
          [history],
        )
    const result = await fc.check(
      fc.asyncProperty(
        fc.record({
          index: fc.constantFrom('none', 'expression', 'partial', 'gin'),
          volatility: fc.constantFrom('IMMUTABLE', 'STABLE', 'VOLATILE'),
          depth: fc.integer({ min: 0, max: 3 }),
          cold: fc.boolean(),
        }),
        fc.array(fc.array(step, { minLength: 2, maxLength: 5 }), {
          minLength: sequences,
          maxLength: sequences,
        }),
        check,
      ),
      { seed, numRuns: runs },
    )
    report.fastCheck = {
      runs: result.numRuns,
      shrinks: result.numShrinks,
      seed: result.seed,
      path: result.counterexamplePath,
    }
    evidence.property(result)
  }
  compare(
    'reach',
    'campaign',
    report.operations > 0 &&
      report.writesExecuted >= report.operations &&
      report.envelopesDelivered >= report.operations,
    true,
  )
  compare('catalog-boundary', 'campaign', report.runtimeCatalogCalls, 0)
  report.ok = true
} catch (error) {
  primary = error
  report.error = String(error.stack ?? error)
} finally {
  await release('bundle', () => rm(dir, { recursive: true, force: true }))
  if (report.cleanupErrors.length) report.ok = false
  await evidence.finish(report, output)
}
console.log(
  JSON.stringify({
    ...report,
    rejectedShrinkFailures: evidence.rejectedShrinks.length,
    witnesses: Object.keys(report.witnesses).length,
    faultEvents: report.faultEvents.length,
    sources: undefined,
    evidence: undefined,
    error: report.error?.split('\n')[0],
    cells: Object.keys(report.cells).length,
  }),
)
if (primary || !report.ok) process.exitCode = 1
