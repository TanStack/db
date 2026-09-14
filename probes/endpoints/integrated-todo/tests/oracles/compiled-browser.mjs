import { mutationInput, expectedInput } from './compiled-input.mjs'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { Driver } from './driver.mjs'
import { inspectSqlEffects as inspectSchema } from '../../sql-effects.mjs'
import {
  ddl,
  endpointSource,
  databaseSource,
  tableName,
  serviceSource,
} from './compiled-program.mjs'

const pg = new PGlite()
let snapshot
const driver = new Driver({
  renderProgram: (p) => endpointSource(p, true),
  renderDatabase: databaseSource,
  schemaSnapshot: () => snapshot,
  extraModules: (p) => ({
    'service.server.ts': serviceSource(p),
    'db.client.ts': `import {DbClient} from '@tanstack/db';export const dbClient=new DbClient({endpointScope:()=> 'oracle'});`,
  }),
})
const output = resolve(
  process.env.ENDPOINT_ORACLE_OUTPUT ?? 'evidence/compiled-dependency-browser',
)
const report = {
  ok: false,
  programs: 0,
  operations: 0,
  comparisons: 0,
  reads: 0,
  skippedReads: 0,
  runtimeCatalogQueries: 0,
}
const evidence = driver.evidence
const input = {
  programs: [
    {
      count: 3,
      peerQuery: true,
      queryStyle: 'full',
      queryBinding: 'local',
      moduleLevel: true,
    },
    {
      count: 3,
      peerQuery: true,
      queryStyle: 'projected',
      queryBinding: 'direct',
    },
    { helpers: true, count: 3, trigger: false, foreignKey: true },
    { helpers: true, count: 3, trigger: true, foreignKey: false },
    { count: 3, pgFunctions: true, expressionIndex: true, opaqueIndex: true },
    ...[false, true].flatMap((moduleLevel) =>
      ['strip', 'passthrough', 'strict'].map((unknown) => ({
        moduleLevel,
        count: 3,
        inputContract: {
          unknown,
          offset: 3,
          defaultWeight: 7,
          extraKey: 'user_id',
        },
      })),
    ),
  ],
  operations: [
    { kind: 'invalid', table: 0, value: 0.5 },
    { kind: 'update', table: 0, value: 7, extraAt: 'root' },
    { kind: 'update', table: 0, value: 8, extraAt: 'object' },
    { kind: 'update', table: 0, value: 9, extraAt: 'array' },
    { kind: 'update', table: 0, value: 10, labels: ['valid', '  '] },
    { kind: 'update', table: 2, value: 9 },
    { kind: 'delete', table: 0 },
  ],
}
async function referenceRows(program) {
  return Promise.all(
    Array.from({ length: program.count }, (_, i) =>
      pg
        .query(
          program.pgFunctions && i === 0
            ? `SELECT a.id,a.value + coalesce((SELECT b.value FROM ${tableName(
                1,
              )} b WHERE b.id='row'),0) AS value FROM ${tableName(
                0,
              )} a ORDER BY a.id`
            : `SELECT id,value FROM ${tableName(program.peerQuery && i === program.count - 1 ? 0 : i)} ORDER BY id`,
        )
        .then((r) => r.rows),
    ),
  )
}
async function recordFaults(page) {
  for (const point of await page.evaluate(() =>
    window.compiledFaults.splice(0),
  ))
    evidence.fault(point, { checkpoint: 'compiled-browser' })
}
async function execute(input) {
  return evidence.run(input, async () => {
    await driver.init()
    for (const program of input.programs) {
      evidence.at({ program })
      await pg.exec(
        'DROP SCHEMA IF EXISTS alpha CASCADE;DROP SCHEMA IF EXISTS beta CASCADE',
      )
      await pg.exec(ddl(program))
      snapshot = await inspectSchema(
        (statement) => pg.query(statement),
        'src/database.server.ts',
      )
      await driver.prepare(program)
      report.programs++
      const page = await driver.browser.newPage()
      await page.addInitScript(() => {
        window.compiledFaults = []
        globalThis.__endpointOracleFault = (point) =>
          window.compiledFaults.push(point)
      })
      const errors = []
      page.on('pageerror', (error) => errors.push(String(error)))
      try {
        await page.goto(driver.url)
        await page.waitForFunction(() => !!window.compiledOracle)
        const baseline = await page.evaluate(async (moduleLevel) => {
          const collections = window.compiledOracle.collections
          await Promise.all(
            (moduleLevel ? collections.slice(0, 1) : collections).map((c) =>
              c.preload(),
            ),
          )
          return collections.map((c) =>
            [...c.values()].map(({ id, value }) => ({ id, value })),
          )
        }, !!program.moduleLevel)
        evidence.phase = 'execution'
        await recordFaults(page)
        evidence.check(
          'retained-baseline-after-demand',
          baseline,
          await referenceRows(program),
          { checkpoint: 'initial-demand' },
        )
        for (const [step, original] of input.operations.entries()) {
          const operation = {
            ...original,
            table: program.peerQuery
              ? original.table % (program.count - 1)
              : original.table,
          }
          evidence.phase = 'execution'
          evidence.at({ program, operation: operation.kind, step })
          evidence.record({ type: 'operation', operation })
          await driver.control({ command: 'clearTrace' })
          const before = await referenceRows(program)
          // Browser replay values are the literal caller values (including
          // fractional invalid inputs), unlike generated integer step seeds.
          const payload = mutationInput(program, {
            ...operation,
            kind: operation.kind === 'invalid' ? 'update' : operation.kind,
          })
          const parsed = expectedInput(program, payload)
          const actual = await page.evaluate(
            async ({ operation, payload }) => {
              const app = window.compiledOracle
              const rows = () =>
                app.collections.map((c) =>
                  [...c.values()].map(({ id, value }) => ({ id, value })),
                )
              const before = rows()
              const tx =
                app.actions[
                  (operation.kind === 'invalid' ? 'update' : operation.kind) +
                    operation.table
                ](payload)
              const optimistic = rows()
              let error
              try {
                await tx.isPersisted.promise
              } catch (failure) {
                error = { code: failure.code, issues: failure.issues }
              }
              return { before, optimistic, settled: rows(), error }
            },
            { operation, payload },
          )
          evidence.check('reference-baseline', actual.before, before, {
            checkpoint: 'pre-action',
          })
          const optimistic = before.map((rows, i) =>
            i !== operation.table &&
            !(
              program.peerQuery &&
              operation.table === 0 &&
              i === program.count - 1
            )
              ? rows
              : operation.kind === 'delete'
                ? []
                : rows.map((row) => ({ ...row, value: payload.value })),
          )
          await recordFaults(page)
          evidence.check('optimistic-rows', actual.optimistic, optimistic, {
            checkpoint: 'same-turn',
          })
          const observed = await driver.control({})
          if (!parsed.valid) {
            evidence.check(
              'validation-error-code',
              actual.error?.code,
              'INVALID_INPUT',
            )
            evidence.check(
              'validation-error-path',
              actual.error?.issues[0].path,
              parsed.path,
            )
            evidence.check('validation-rollback', actual.settled, before)
            evidence.check('validation-no-sql', observed.trace, [])
            report.operations++
            continue
          }
          evidence.check('handler-success', actual.error, undefined)
          if (operation.kind === 'delete')
            await pg.exec(
              `DELETE FROM ${tableName(operation.table)} WHERE id='row'`,
            )
          else
            await pg.query(
              `UPDATE ${tableName(
                operation.table,
              )} SET value=$1 WHERE id='row'`,
              [parsed.value.value],
            )
          if (
            program.pgFunctions &&
            operation.kind === 'update' &&
            operation.table === 0
          )
            await pg.query(
              `UPDATE ${tableName(1)} SET value=$1 WHERE id='row'`,
              [parsed.value.value + 1],
            )
          const expected = await referenceRows(program)
          if (
            process.env.ENDPOINT_ORACLE_TEST_FAULT === 'compiled-row' &&
            actual.settled[0]?.length
          ) {
            actual.settled[0][0].value++
            evidence.fault('compiled-row')
          }
          evidence.check('settled-rows', actual.settled, expected, {
            checkpoint: 'settled',
          })
          const { trace } = await driver.control({})
          assert.ok(
            trace.every(
              (statement) => !/pg_catalog|lock table|^begin/i.test(statement),
            ),
          )
          const reads =
            trace.filter((statement) => /^select /i.test(statement)).length -
            Number(
              !!program.pgFunctions &&
                operation.kind === 'update' &&
                operation.table === 0,
            )
          const wanted =
            program.peerQuery && operation.table === 0
              ? 2
              : program.trigger &&
                  operation.table === 0 &&
                  operation.kind === 'update'
                ? 3
                : program.foreignKey &&
                    operation.kind === 'delete' &&
                    operation.table === 0
                  ? 2
                  : program.pgFunctions &&
                      operation.kind === 'update' &&
                      operation.table === 0
                    ? 2
                    : 1
          evidence.check('read-obligation', reads, wanted, {
            checkpoint: 'settled',
          })
          report.operations++
          report.comparisons += actual.settled.length
          report.reads += reads
          report.skippedReads += actual.settled.length - reads
        }
        assert.deepEqual(errors, [])
      } finally {
        await evidence.cleanup('fault-observations', async () => {
          for (const point of await page.evaluate(
            () => window.compiledFaults?.splice(0) ?? [],
          ))
            evidence.fault(point, { checkpoint: 'compiled-browser' })
        })
        await driver.evidence.cleanup('page', () => page.close())
      }
    }
  })
}
try {
  const replay = process.argv.indexOf('--replay')
  if (replay >= 0)
    await evidence.replay(
      JSON.parse(await readFile(process.argv[replay + 1], 'utf8')),
      execute,
    )
  else await execute(input)
  report.ok = true
} catch (error) {
  report.error = String(error.stack ?? error)
  report.serverLog = driver.serverLog?.slice(-5000)
  process.exitCode = 1
} finally {
  report.clientArtifacts = driver.counts.clientArtifacts
  await driver.close()
  await driver.evidence.cleanup('reference-pg', () => pg.close())
  await driver.evidence.finish(report, output)
  console.log(JSON.stringify(report, null, 2))
}
