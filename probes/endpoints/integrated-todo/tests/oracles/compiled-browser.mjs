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
  extraModules: (p) => ({ 'service.server.ts': serviceSource(p) }),
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
    { helpers: true, count: 3, trigger: false, foreignKey: true },
    { helpers: true, count: 3, trigger: true, foreignKey: false },
    { count: 3, pgFunctions: true, expressionIndex: true, opaqueIndex: true },
  ],
  operations: [
    { kind: 'invalid', table: 0, value: 0.5 },
    { kind: 'update', table: 0, value: 7 },
    { kind: 'update', table: 2, value: 9 },
    { kind: 'delete', table: 0 },
  ],
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
      const errors = []
      page.on('pageerror', (error) => errors.push(String(error)))
      try {
        await page.goto(driver.url)
        await page.waitForFunction(() => !!window.compiledOracle)
        await page.evaluate(() =>
          Promise.all(
            window.compiledOracle.collections.map((c) => c.preload()),
          ),
        )
        for (const [step, operation] of input.operations.entries()) {
          evidence.phase = 'execution'
          evidence.at({ program, operation: operation.kind, step })
          evidence.record({ type: 'operation', operation })
          await driver.control({ command: 'clearTrace' })
          if (operation.kind === 'invalid') {
            const actual = await page.evaluate(async (operation) => {
              const app = window.compiledOracle
              const rows = () =>
                app.collections.map((c) =>
                  [...c.values()].map(({ id, value }) => ({ id, value })),
                )
              const before = rows()
              const tx = app.actions['update' + operation.table]({
                value: operation.value,
              })
              const optimistic = rows()
              let error
              try {
                await tx.isPersisted.promise
              } catch (failure) {
                error = { code: failure.code, issues: failure.issues }
              }
              return { before, optimistic, settled: rows(), error }
            }, operation)
            evidence.check(
              'validation-error-code',
              actual.error?.code,
              'INVALID_INPUT',
            )
            evidence.check(
              'validation-error-path',
              actual.error?.issues[0].path,
              ['input', 'value'],
            )
            evidence.check(
              'validation-optimism',
              actual.optimistic[operation.table][0].value,
              operation.value,
            )
            evidence.check('validation-rollback', actual.settled, actual.before)
            evidence.check(
              'validation-no-sql',
              (await driver.control({})).trace,
              [],
            )
            report.operations++
            continue
          }
          if (operation.kind === 'delete')
            await pg.exec(
              `DELETE FROM ${tableName(operation.table)} WHERE id='row'`,
            )
          else
            await pg.query(
              `UPDATE ${tableName(
                operation.table,
              )} SET value=$1 WHERE id='row'`,
              [operation.value],
            )
          if (
            program.pgFunctions &&
            operation.kind === 'update' &&
            operation.table === 0
          )
            await pg.query(
              `UPDATE ${tableName(1)} SET value=$1 WHERE id='row'`,
              [operation.value + 1],
            )
          const actual = await page.evaluate(async (operation) => {
            const app = window.compiledOracle
            const tx = app.actions[operation.kind + operation.table](
              operation.kind === 'delete' ? {} : { value: operation.value },
            )
            await tx.isPersisted.promise
            return app.collections.map((c) =>
              [...c.values()].map(({ id, value }) => ({ id, value })),
            )
          }, operation)
          const expected = await Promise.all(
            Array.from({ length: program.count }, (_, i) =>
              pg
                .query(
                  program.pgFunctions && i === 0
                    ? `SELECT a.id,a.value + coalesce((SELECT b.value FROM ${tableName(
                        1,
                      )} b WHERE b.id='row'),0) AS value FROM ${tableName(
                        0,
                      )} a ORDER BY a.id`
                    : `SELECT id,value FROM ${tableName(i)} ORDER BY id`,
                )
                .then((r) => r.rows),
            ),
          )
          if (
            process.env.ENDPOINT_ORACLE_TEST_FAULT === 'compiled-row' &&
            actual[0]?.length
          ) {
            actual[0][0].value++
            evidence.fault('compiled-row')
          }
          evidence.check('settled-rows', actual, expected, {
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
            program.trigger &&
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
          report.comparisons += actual.length
          report.reads += reads
          report.skippedReads += actual.length - reads
        }
        assert.deepEqual(errors, [])
      } finally {
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
