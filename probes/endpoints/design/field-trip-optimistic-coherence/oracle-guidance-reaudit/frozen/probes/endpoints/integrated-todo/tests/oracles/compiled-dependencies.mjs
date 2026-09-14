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
import { inspectSchema } from '../../schema-snapshot.mjs'
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
const plain = (rows) =>
  rows
    .map(({ id, value }) => ({ id, value }))
    .sort((a, b) => a.id.localeCompare(b.id))

async function scenario(program, histories) {
  return evidence.run({ program, histories }, () => execute(program, histories))
}
async function execute(program, histories) {
  program = { helpers: false, helperFanout: false, ...program }
  const dir = await mkdtemp(join(tmpdir(), 'compiled-dependency-oracle-'))
  const pg = new PGlite()
  let compiled, loaded
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
      for (const table of snapshot.tables) table.writable = true
    }
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
      compiled.code = compiled.code.replace(
        /,\{scope:data.scope\},\(\)=>(\[[^\n]*?\])\)/g,
        (_, json) =>
          `,{scope:data.scope},()=>${JSON.stringify(
            JSON.parse(json).slice(0, 1),
          )})`,
      )
    }
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
    const module = await import(pathToFileURL(bundle).href)
    loaded = module
    // The real bundled database module owns the SUT PGlite instance. Export it
    // through a second entry in the same bundle to avoid a second database.
    report.compilations++
    for (const history of histories) {
      const core = new module.DbClient({ endpointScope: 'oracle' })
      try {
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
            async (_, i) =>
              (
                await pg.query(
                  `SELECT id,value FROM ${tableName(i)} ORDER BY id`,
                )
              ).rows,
          ),
        )
        evidence.phase = 'execution'
        evidence.check(
          'reference-baseline',
          app.collections.map((c) => plain([...c.values()])),
          admitted,
          { checkpoint: 'preload' },
        )
        for (const step of history) {
          const target = step.table % program.count
          const before = structuredClone(admitted)
          const action = app.actions[step.kind + target]
          const start = module.sutTrace.length
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
              program.helpers &&
              !program.inlineSql &&
              program.helperFanout &&
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
          const reads = trace.filter((statement) =>
            /^select /i.test(statement),
          ).length
          const expectedReads =
            (program.expressionIndex && program.opaqueIndex) ||
            (program.trigger && target === 0)
              ? program.count
              : 1 +
                Number(
                  (program.foreignKey &&
                    step.kind === 'delete' &&
                    target === 0) ||
                    (program.helpers &&
                      !program.inlineSql &&
                      program.helperFanout &&
                      step.kind === 'update' &&
                      target === 0),
                )
          for (let i = 0; i < program.count; i++) {
            const expected = (
              await pg.query(`SELECT id,value FROM ${tableName(i)} ORDER BY id`)
            ).rows
            evidence.check(
              'settled-rows',
              plain([...app.collections[i].values()]),
              expected,
              { checkpoint: 'settled', operation: step.kind, collection: i },
            )
            admitted[i] = structuredClone(expected)
            report.authorityChecks++
          }
          assert.equal(
            reads,
            expectedReads,
            `compiled read count ${JSON.stringify({ program, step })}`,
          )
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
  kind: fc.constantFrom('update', 'insert', 'delete'),
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
