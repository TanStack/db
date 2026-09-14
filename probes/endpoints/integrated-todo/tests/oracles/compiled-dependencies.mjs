import { Evidence } from './evidence.mjs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  realpath,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from '@babel/parser'
import fc from 'fast-check'
import { PGlite } from '@electric-sql/pglite'
import { inspectSqlEffects as inspectSchema } from '../../sql-effects.mjs'
import { transformBoundEndpoints } from '../../bound-transform.mjs'
import {
  ddl,
  tableName,
  databaseSource,
  endpointSource,
  serviceSource,
} from './compiled-program.mjs'

const base = resolve(import.meta.dirname, '../..')
const require = createRequire(
  await realpath(join(base, 'node_modules/vite/package.json')),
)
const { build } = require('esbuild')
const seed = Number(process.env.ENDPOINT_ORACLE_SEED ?? 9122602)
const sequences = Number(process.env.ENDPOINT_ORACLE_SEQUENCES ?? 3)
const scenarios = Number(process.env.ENDPOINT_ORACLE_SCENARIOS ?? 20)
const output = resolve(
  process.env.ENDPOINT_ORACLE_OUTPUT ?? 'evidence/compiled-dependencies',
)
const evidence = new Evidence('endpoints.compiled-dependencies')
const report = {
  ok: false,
  seed,
  scenarios,
  sequences,
  compilations: 0,
  operations: 0,
  authorityChecks: 0,
  resultReads: 0,
  skippedReads: 0,
  runtimeCatalogQueries: 0,
}
// Independent expected query: expand the routine mathematically rather than
// reusing its body or asking the compiler which relations it reads.
const referenceRead = (program, i) =>
  program.pgFunctions && i === 0
    ? `SELECT a.id,a.value + coalesce((SELECT b.value FROM ${tableName(
        1,
      )} b WHERE b.id='row'),0) AS value FROM ${tableName(0)} a ORDER BY a.id`
    : `SELECT id,value FROM ${tableName(i)} ORDER BY id`
const plain = (rows) =>
  rows
    .map(({ id, value }) => ({ id, value }))
    .sort((a, b) => a.id.localeCompare(b.id))

async function scenario(program, histories) {
  return evidence.run({ program, histories }, () => execute(program, histories))
}
async function execute(program, histories) {
  program = { helpers: false, helperFanout: false, ...program }
  if (program.pgFunctions)
    program = { ...program, helpers: false, inlineSql: false }
  const dir = await mkdtemp(join(tmpdir(), 'compiled-dependency-oracle-'))
  const pg = new PGlite()
  let compiled,
    loaded,
    alteredTrigger = false,
    alteredHelper = false,
    alteredRoutine = false
  try {
    await mkdir(join(dir, 'src'))
    await symlink(join(base, 'node_modules'), join(dir, 'node_modules'), 'dir')
    await symlink(join(base, 'src/runtime.ts'), join(dir, 'src/runtime.ts'))
    await symlink(
      join(base, 'src/registry.server.ts'),
      join(dir, 'src/registry.server.ts'),
    )
    const database = join(dir, 'src/database.server.ts')
    await writeFile(database, databaseSource(program))
    await writeFile(join(dir, 'src/service.server.ts'), serviceSource(program))
    await writeFile(
      join(dir, 'src/guard.server.ts'),
      `export async function authorize(req) { if (req.scope !== 'oracle') throw Error('Unauthorized'); return new URL('https://example.test').hostname }`,
    )
    await pg.exec(ddl(program))
    const snapshot = await inspectSchema(
      (statement) => pg.query(statement),
      'src/database.server.ts',
    )
    if (process.env.ENDPOINT_COMPILED_MUTANT === 'ignore-triggers') {
      for (const table of snapshot.tables) {
        if (table.triggers.length) alteredTrigger = true
        table.triggers = []
      }
      if (alteredTrigger)
        evidence.fault('ignore-triggers', { stage: 'applied' })
    }
    if (
      process.env.ENDPOINT_COMPILED_MUTANT === 'omit-routine-body' &&
      program.pgFunctions
    ) {
      for (const fn of snapshot.routines)
        if (
          fn.schema === 'alpha' &&
          ['read_value', 'write_value'].includes(fn.name)
        ) {
          fn.body = 'SELECT $1'
          alteredRoutine = true
        }
      if (alteredRoutine)
        evidence.fault('omit-routine-body', { stage: 'applied' })
    }
    evidence.artifact('schema:' + report.compilations, JSON.stringify(snapshot))
    const code = endpointSource(program)
    compiled = transformBoundEndpoints(
      code,
      join(dir, 'src/endpoint.tsx'),
      parse(code, { sourceType: 'module' }),
      { root: dir, snapshot },
    )
    if (
      process.env.ENDPOINT_FUNCTION_MUTANT === 'omit-helper' &&
      program.helperFanout
    ) {
      const before = compiled.code
      compiled.code = compiled.code.replace(
        /,\{scope:data.scope\},\(\)=>(\[[^\n]*?\])\)/g,
        (_, json) =>
          `,{scope:data.scope},()=>${JSON.stringify(
            JSON.parse(json).slice(0, 1),
          )})`,
      )
      alteredHelper = compiled.code !== before
    }
    if (alteredHelper) evidence.fault('omit-helper', { stage: 'applied' })
    assert.doesNotMatch(
      compiled.code + compiled.registryCode,
      /pg_catalog|LOCK TABLE|inspectSchema/,
    )
    const bundle = join(dir, 'bundle.mjs')
    await build({
      stdin: {
        contents:
          compiled.code +
          "\nexport {DbClient} from '@tanstack/db';export {pg as sutPg,trace as sutTrace} from './database.server';",
        resolveDir: join(dir, 'src'),
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      tsconfig: join(base, 'tsconfig.json'),
      outfile: bundle,
      logLevel: 'silent',
      plugins: [
        {
          name: 'oracle-server-transport',
          setup(build) {
            build.onResolve({ filter: /^@tanstack\/react-start$/ }, () => ({
              path: 'start',
              namespace: 'oracle',
            }))
            build.onResolve(
              { filter: /^virtual:endpoints-registry.server.ts$/ },
              () => ({ path: 'registry', namespace: 'oracle' }),
            )
            build.onLoad({ filter: /.*/, namespace: 'oracle' }, ({ path }) => ({
              contents:
                path === 'registry'
                  ? compiled.registryCode +
                    '\nexport const registry=definitions;'
                  : `export function createServerFn(){return {inputValidator(schema){return {handler(fn){return async({data})=>{const result=await fn({data:schema.parse(data)});return JSON.parse(JSON.stringify(result))}}}}}}`,
              loader: 'ts',
              resolveDir: join(dir, 'src'),
            }))
          },
        },
      ],
    })
    evidence.artifact(
      'compiled-bundle:' + report.compilations,
      await readFile(bundle),
    )
    const module = await import(pathToFileURL(bundle).href)
    loaded = module
    // The real bundled database module owns the SUT PGlite instance. Export it
    // through a second entry in the same bundle to avoid a second database.
    report.compilations++
    for (const history of histories) {
      const core = new module.DbClient({ endpointScope: 'oracle' })
      try {
        evidence.at({})
        const app = module.App(core)
        await Promise.all(app.collections.map((c) => c.preload()))
        if (process.env.ENDPOINT_ORACLE_TEST_FAULT === 'bad-baseline') {
          app.collections[0].utils.writeUpsert({ id: 'row', value: 101 })
          report.testFaults = (report.testFaults ?? 0) + 1
          evidence.fault('bad-baseline', { collection: 0 })
        }
        let admitted = await Promise.all(
          Array.from(
            { length: program.count },
            async (_, i) => (await pg.query(referenceRead(program, i))).rows,
          ),
        )
        evidence.phase = 'execution'
        evidence.check(
          'reference-baseline',
          app.collections.map((c) => plain([...c.values()])),
          admitted,
          { checkpoint: 'preload' },
        )
        for (const [stepIndex, step] of history.entries()) {
          evidence.at({ operation: step.kind, step: stepIndex })
          evidence.record({ type: 'operation', step })
          const target = step.table % program.count
          const before = structuredClone(admitted)
          const action =
            app.actions[
              (step.kind === 'invalid' ? 'update' : step.kind) + target
            ]
          const start = module.sutTrace.length
          if (step.kind === 'invalid') {
            // A fractional number is valid collection data but invalid endpoint
            // input. No statement should reach either database for this step.
            const tx = action({ value: step.value + 0.5 })
            evidence.check(
              'invalid-input-optimism',
              app.collections.map((c) => plain([...c.values()])),
              before.map((rows, i) =>
                i === target
                  ? rows.map((row) => ({ ...row, value: step.value + 0.5 }))
                  : rows,
              ),
              { checkpoint: 'same-turn' },
            )
            await assert.rejects(tx.isPersisted.promise, (error) => {
              evidence.check(
                'validation-error-code',
                error.code,
                'INVALID_INPUT',
              )
              evidence.check('validation-error-path', error.issues[0].path, [
                'input',
                'value',
              ])
              return true
            })
            evidence.check(
              'validation-no-sql',
              module.sutTrace.slice(start),
              [],
            )
            evidence.check(
              'validation-rollback',
              app.collections.map((c) => plain([...c.values()])),
              before,
            )
            report.operations++
            continue
          }
          // An independent PG database executes separately rendered statements.
          let rejected = false
          try {
            const table = tableName(target)
            if (step.kind === 'delete')
              await pg.exec(`DELETE FROM ${table} WHERE id='row'`)
            else if (step.kind === 'insert')
              await pg.query(
                `INSERT INTO ${table}(id,value) VALUES ('row',$1)`,
                [step.value],
              )
            else
              await pg.query(`UPDATE ${table} SET value=$1 WHERE id='row'`, [
                step.value,
              ])
            if (
              (program.pgFunctions ||
                (program.helpers &&
                  !program.inlineSql &&
                  program.helperFanout)) &&
              target === 0 &&
              step.kind === 'update'
            )
              await pg.query(
                `UPDATE ${tableName(1)} SET value=$1 WHERE id='row'`,
                [step.value + 1],
              )
          } catch {
            rejected = true
          }
          if (alteredTrigger && target === 0 && program.trigger)
            evidence.fault('ignore-triggers', { operation: step.kind })
          if (alteredRoutine)
            evidence.fault('omit-routine-body', { operation: step.kind })
          if (alteredHelper && target === 0 && step.kind === 'update')
            evidence.fault('omit-helper', { operation: step.kind })
          const tx = action(step.kind === 'delete' ? {} : { value: step.value })
          const expectedOptimism = before.map((rows, i) =>
            i !== target
              ? rows
              : step.kind === 'delete'
                ? []
                : step.kind === 'insert' && rows.length === 0
                  ? [{ id: 'row', value: step.value }]
                  : step.kind === 'update'
                    ? rows.map((row) => ({ ...row, value: step.value }))
                    : rows,
          )
          evidence.check(
            'optimistic-rows',
            app.collections.map((c) => plain([...c.values()])),
            expectedOptimism,
            { checkpoint: 'same-turn', operation: step.kind },
          )
          if (rejected) await assert.rejects(tx.isPersisted.promise)
          else await tx.isPersisted.promise
          const trace = module.sutTrace.slice(start)
          assert.ok(
            trace.every(
              (statement) => !/pg_catalog|lock table/i.test(statement),
            ),
            'requests contain no schema proof queries or proof transactions',
          )
          const reads =
            trace.filter((statement) => /^select /i.test(statement)).length -
            Number(
              !!program.pgFunctions && target === 0 && step.kind === 'update',
            )
          // The reference law uses the generated semantics, never compiler output.
          const changed = new Set([target])
          if (
            target === 0 &&
            ((program.foreignKey && step.kind === 'delete') ||
              (step.kind === 'update' &&
                (program.pgFunctions ||
                  (program.helpers &&
                    !program.inlineSql &&
                    program.helperFanout))))
          )
            changed.add(1)
          const expectedReads =
            program.trigger && target === 0 && step.kind === 'update'
              ? program.count
              : Array.from(
                  { length: program.count },
                  (_, i) =>
                    i === target ||
                    changed.has(i) ||
                    (program.pgFunctions && i === 0 && changed.has(1)),
                ).filter(Boolean).length
          for (let i = 0; i < program.count; i++) {
            const expected = (await pg.query(referenceRead(program, i))).rows
            evidence.check(
              'settled-rows',
              plain([...app.collections[i].values()]),
              expected,
              { checkpoint: 'settled', operation: step.kind, collection: i },
            )
            admitted[i] = structuredClone(expected)
            report.authorityChecks++
          }
          evidence.check('read-obligation', reads, expectedReads, {
            checkpoint: 'settled',
          })
          report.resultReads += reads
          report.skippedReads += program.count - reads
          report.operations++
        }
      } finally {
        await evidence.cleanup('client', () => core.cleanup())
      }
      // Histories continue from the previous PG state on both sides; each new
      // client establishes a fresh baseline before generated actions resume.
    }
  } finally {
    await evidence.cleanup('sut-pg', () => loaded?.sutPg.close())
    await evidence.cleanup('reference-pg', () => pg.close())
    await evidence.cleanup('directory', () =>
      rm(dir, { recursive: true, force: true }),
    )
  }
}

const step = fc.record({
  table: fc.nat(20),
  kind: fc.constantFrom('update', 'insert', 'delete', 'invalid'),
  value: fc.integer({ min: -20, max: 20 }),
})
try {
  const replay = process.argv.indexOf('--replay')
  if (replay !== -1)
    await evidence.replay(
      JSON.parse(await readFile(process.argv[replay + 1], 'utf8')),
      (value) => scenario(value.program, value.histories),
    )
  else {
    await scenario({ count: 2 }, [
      [
        { kind: 'invalid', table: 0, value: 3 },
        { kind: 'update', table: 0, value: 4 },
        { kind: 'delete', table: 0, value: 0 },
        { kind: 'invalid', table: 0, value: 5 },
        { kind: 'insert', table: 0, value: 6 },
      ],
    ])
    await scenario({ count: 3, pgFunctions: true }, [
      [
        { kind: 'update', table: 0, value: 7 },
        { kind: 'update', table: 1, value: 9 },
      ],
    ])
    await scenario({ count: 3, expressionIndex: true, opaqueIndex: true }, [
      [{ kind: 'update', table: 0, value: 7 }],
    ])
    await scenario(
      {
        inlineSql: true,
        nativeDefaults: true,
        expressionIndex: true,
        count: 3,
        trigger: false,
        foreignKey: false,
      },
      [[{ kind: 'update', table: 0, value: 7 }]],
    )
    await scenario(
      {
        helpers: true,
        helperFanout: true,
        count: 3,
        trigger: false,
        foreignKey: false,
      },
      [[{ kind: 'update', table: 0, value: 7 }]],
    )
    await scenario({ count: 3, trigger: true, foreignKey: false }, [
      [{ kind: 'update', table: 0, value: 7 }],
    ])
    if (!process.argv.includes('--controls-only'))
      evidence.property(
        await fc.check(
          fc.asyncProperty(
            fc.record({
              pgFunctions: fc.boolean(),
              opaqueIndex: fc.boolean(),
              expressionIndex: fc.boolean(),
              nativeDefaults: fc.boolean(),
              inlineSql: fc.boolean(),
              helpers: fc.boolean(),
              helperFanout: fc.boolean(),
              count: fc.integer({ min: 2, max: 4 }),
              trigger: fc.boolean(),
              foreignKey: fc.boolean(),
            }),
            fc.array(fc.array(step, { minLength: 2, maxLength: 8 }), {
              minLength: sequences,
              maxLength: sequences,
            }),
            scenario,
          ),
          {
            seed,
            numRuns: scenarios,
            ...(process.env.ENDPOINT_ORACLE_PATH
              ? { path: process.env.ENDPOINT_ORACLE_PATH }
              : {}),
          },
        ),
      )
  }
  report.ok = true
} catch (error) {
  report.error = String(error.stack ?? error)
  process.exitCode = 1
}
await evidence.finish(report, output)
console.log(
  JSON.stringify({
    ok: report.ok,
    outcome: report.outcome,
    operations: report.operations,
  }),
)
